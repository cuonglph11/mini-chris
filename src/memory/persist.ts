import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execa } from 'execa';

function timestamp(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function appendToMemory(workspacePath: string, content: string): Promise<void> {
  const filePath = join(workspacePath, 'MEMORY.md');
  const entry = `\n<!-- ${timestamp()} -->\n${content}\n`;
  await appendFile(filePath, entry, 'utf-8');
}

export async function appendToDailyLog(workspacePath: string, content: string): Promise<void> {
  const memoryDir = join(workspacePath, 'memory');
  await mkdir(memoryDir, { recursive: true });

  const filePath = join(memoryDir, `${todayDate()}.md`);
  const entry = `\n<!-- ${timestamp()} -->\n${content}\n`;
  await appendFile(filePath, entry, 'utf-8');
}

export async function syncMemory(workspacePath: string): Promise<void> {
  const ts = timestamp();
  await execa('git', ['add', '.'], { cwd: workspacePath });
  await execa('git', ['commit', '-m', `memory sync ${ts}`], { cwd: workspacePath });
  await execa('git', ['push'], { cwd: workspacePath });
}
