import { ProxyAgent } from 'undici';

/**
 * Proxy-aware fetch. Node.js's built-in fetch ignores HTTPS_PROXY/HTTP_PROXY,
 * so we use undici's ProxyAgent when a proxy is configured.
 *
 * Corporate environments: set HTTPS_PROXY=http://proxy.company.com:port
 * SSL interception: set NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const proxyUrl =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;

  if (proxyUrl) {
    const dispatcher = new ProxyAgent(proxyUrl);
    // `dispatcher` is supported by Node.js fetch (undici) but not in the TS RequestInit type
    return fetch(url, { ...init, dispatcher } as RequestInit);
  }

  return fetch(url, init);
}

/**
 * Format a fetch error with actionable hints for corporate environments.
 */
export function formatFetchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  const causeMsg = err instanceof Error && err.cause
    ? (err.cause instanceof Error ? err.cause.message : String(err.cause))
    : undefined;

  const detail = causeMsg ? `${message} (${causeMsg})` : message;

  const hints: string[] = [];
  const lc = detail.toLowerCase();
  if (lc.includes('unable_to_verify') || lc.includes('self_signed') || lc.includes('cert') || causeCode === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    hints.push('Corporate SSL inspection detected. Export your company CA cert and set NODE_EXTRA_CA_CERTS=/path/to/ca.pem');
  }
  if (lc.includes('econnrefused') || lc.includes('enotfound') || lc.includes('etimedout') || lc.includes('fetch failed')) {
    hints.push('If behind a corporate proxy, set HTTPS_PROXY=http://proxy.company.com:port');
  }

  return hints.length > 0 ? `${detail}. Hint: ${hints.join('. ')}` : detail;
}
