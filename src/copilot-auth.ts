import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execa } from 'execa';
import { proxyFetch, formatFetchError } from './net.js';

const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const TOKEN_DIR = join(homedir(), '.mini-chris');
const OAUTH_TOKEN_PATH = join(TOKEN_DIR, 'copilot-oauth.json');

const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
};

interface OAuthToken {
  access_token: string;
  token_type: string;
  scope: string;
}

interface CopilotSession {
  token: string;
  expiresAt: number;
}

let cachedSession: CopilotSession | null = null;

function loadCachedOAuthToken(): string | null {
  try {
    if (!existsSync(OAUTH_TOKEN_PATH)) return null;
    const data = JSON.parse(readFileSync(OAUTH_TOKEN_PATH, 'utf-8')) as OAuthToken;
    return data.access_token || null;
  } catch {
    return null;
  }
}

function saveCachedOAuthToken(token: OAuthToken): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

/**
 * OAuth device flow using Copilot's client_id (same as VS Code).
 * Prompts user to authorize in browser, polls until complete.
 */
async function deviceFlowAuth(): Promise<string> {
  const cached = loadCachedOAuthToken();
  if (cached) {
    const valid = await testOAuthToken(cached);
    if (valid) return cached;
  }

  console.error('\n[copilot] Starting device flow authentication...');

  const codeResponse = await proxyFetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${COPILOT_CLIENT_ID}&scope=copilot`,
  });

  if (!codeResponse.ok) {
    throw new Error(`Device flow initiation failed (${codeResponse.status}): ${await codeResponse.text()}`);
  }

  const codeData = await codeResponse.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  console.error(`\n  Open this URL in your browser: ${codeData.verification_uri}`);
  console.error(`  Enter code: ${codeData.user_code}\n`);
  console.error('  Waiting for authorization...');

  // Try to open browser automatically
  try {
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    await execa(openCmd, [codeData.verification_uri], { reject: false });
  } catch { /* ignore — user can open manually */ }

  const deadline = Date.now() + codeData.expires_in * 1000;
  const interval = Math.max(codeData.interval || 5, 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval));

    const tokenResponse = await proxyFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${COPILOT_CLIENT_ID}&device_code=${codeData.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
    });

    const tokenData = await tokenResponse.json() as Record<string, string>;

    if (tokenData.access_token) {
      saveCachedOAuthToken(tokenData as unknown as OAuthToken);
      console.error('  Authorized!\n');
      return tokenData.access_token;
    }

    if (tokenData.error === 'authorization_pending') continue;
    if (tokenData.error === 'slow_down') {
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    throw new Error(`Device flow failed: ${tokenData.error_description || tokenData.error}`);
  }

  throw new Error('Device flow timed out. Please try again.');
}

async function testOAuthToken(token: string): Promise<boolean> {
  try {
    const r = await proxyFetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/json' },
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Get a GitHub OAuth/PAT token based on auth method.
 */
export async function getGitHubToken(auth: 'gh' | 'token' | 'device', configToken?: string): Promise<string> {
  if (auth === 'device') {
    return deviceFlowAuth();
  }

  if (auth === 'token') {
    if (!configToken) throw new Error('copilot.token is required when auth is "token"');
    return configToken;
  }

  // auth === 'gh': env vars then gh CLI
  for (const envVar of ['COPILOT_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    const val = process.env[envVar];
    if (val) return val;
  }

  const result = await execa('gh', ['auth', 'token'], { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to get GitHub token. Set GITHUB_TOKEN env var or run 'gh auth login'. Error: ${result.stderr}`,
    );
  }
  return (result.stdout as string).trim();
}

/**
 * Exchange a GitHub token for a short-lived Copilot session token.
 * Caches the session token until near expiry.
 */
export async function getCopilotSessionToken(auth: 'gh' | 'token' | 'device', configToken?: string): Promise<string> {
  if (cachedSession && Date.now() / 1000 < cachedSession.expiresAt - 60) {
    return cachedSession.token;
  }

  const githubToken = await getGitHubToken(auth, configToken);

  const endpoints = [
    'https://api.github.com/copilot_internal/v2/token',
    'https://api.github.com/copilot_internal/token',
  ];

  let lastStatus = 0;
  let lastBody = '';

  for (const endpoint of endpoints) {
    let response: Response;
    try {
      response = await proxyFetch(endpoint, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/json',
          ...COPILOT_HEADERS,
        },
      });
    } catch (err) {
      throw new Error(
        `Failed to reach GitHub API for Copilot token exchange: ${formatFetchError(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }

    if (response.ok) {
      const data = await response.json() as { token: string; expires_at: number };
      cachedSession = { token: data.token, expiresAt: data.expires_at };
      return data.token;
    }

    lastStatus = response.status;
    lastBody = await response.text().catch(() => '');

    // If the cached OAuth token was rejected, clear it and re-auth
    if (auth === 'device' && (lastStatus === 401 || lastStatus === 404)) {
      try { if (existsSync(OAUTH_TOKEN_PATH)) writeFileSync(OAUTH_TOKEN_PATH, '{}'); } catch { /* ignore */ }
      const freshToken = await deviceFlowAuth();
      const retryResponse = await proxyFetch(endpoints[0], {
        headers: {
          'Authorization': `token ${freshToken}`,
          'Accept': 'application/json',
          ...COPILOT_HEADERS,
        },
      });
      if (retryResponse.ok) {
        const data = await retryResponse.json() as { token: string; expires_at: number };
        cachedSession = { token: data.token, expiresAt: data.expires_at };
        return data.token;
      }
      lastStatus = retryResponse.status;
      lastBody = await retryResponse.text().catch(() => '');
    }

    if (lastStatus !== 404) break;
  }

  const hints: string[] = [];
  if (lastStatus === 404) {
    hints.push(
      'Token exchange failed. Try: copilot.auth: device in config.yaml',
      'This uses the same OAuth flow as VS Code Copilot.',
    );
  } else if (lastStatus === 401) {
    hints.push('Token is invalid or expired. Re-run mini-chris to re-authenticate.');
  } else if (lastStatus === 403) {
    hints.push('Access denied. Ensure your GitHub account has an active Copilot subscription.');
  }

  throw new Error(
    `Copilot token exchange failed (HTTP ${lastStatus}): ${lastBody}\n` +
    (hints.length > 0 ? hints.join('\n') : 'Ensure your account has Copilot access.'),
  );
}

export { COPILOT_HEADERS };
