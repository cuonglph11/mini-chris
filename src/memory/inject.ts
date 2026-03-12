import { readFile } from 'fs/promises';
import { join } from 'path';

const WORKSPACE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
];

const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export async function injectWorkspaceContext(
  workspacePath: string,
  maxContextBytes: number = DEFAULT_MAX_BYTES
): Promise<string> {
  const sections: string[] = [];

  for (const filename of WORKSPACE_FILES) {
    const filePath = join(workspacePath, filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      sections.push(`## ${filename}\n${content}\n`);
    } catch {
      // Skip missing files gracefully
    }
  }

  const combined = sections.join('\n');
  const byteLength = Buffer.byteLength(combined, 'utf-8');

  if (byteLength > maxContextBytes) {
    process.stderr.write(
      `Warning: workspace context size (${byteLength} bytes) exceeds limit (${maxContextBytes} bytes)\n`
    );
  }

  return combined;
}
