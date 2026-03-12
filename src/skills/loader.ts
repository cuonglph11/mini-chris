import { readFile, mkdir, cp, writeFile, access } from 'fs/promises';
import { join, basename } from 'path';
import { glob } from 'glob';
import { parse as parseYaml } from 'yaml';
import type { SkillMeta } from '../types.js';

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }
  const data = parseYaml(match[1]) as Record<string, unknown>;
  return { data, body: match[2] };
}

export async function scanSkills(workspacePath: string): Promise<SkillMeta[]> {
  const skillsDir = join(workspacePath, 'skills');

  let skillFiles: string[];
  try {
    skillFiles = await glob('*/SKILL.md', { cwd: skillsDir });
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const file of skillFiles) {
    const skillPath = join(skillsDir, file);
    try {
      const content = await readFile(skillPath, 'utf-8');
      const { data } = parseFrontmatter(content);
      const name = typeof data['name'] === 'string' ? data['name'] : '';
      const description = typeof data['description'] === 'string' ? data['description'] : '';
      if (name) {
        skills.push({ name, description, path: skillPath });
      }
    } catch {
      // skip unreadable or invalid skills
    }
  }
  return skills;
}

export function formatAvailableSkills(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map(s => `- name: ${s.name}\n  description: ${s.description}`);
  return `<available_skills>\n${lines.join('\n')}\n</available_skills>`;
}

export async function readSkillContent(skillPath: string): Promise<string> {
  return readFile(skillPath, 'utf-8');
}

export async function installSkill(source: string, workspacePath: string): Promise<void> {
  const skillsDir = join(workspacePath, 'skills');
  await mkdir(skillsDir, { recursive: true });

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill from ${source}: ${response.statusText}`);
    }
    const content = await response.text();
    const { data } = parseFrontmatter(content);
    const name = typeof data['name'] === 'string' ? data['name'] : '';
    if (!name) {
      throw new Error('Invalid skill: SKILL.md must have a name in frontmatter');
    }
    const destDir = join(skillsDir, name);
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
  } else {
    const skillMdPath = join(source, 'SKILL.md');
    try {
      await access(skillMdPath);
    } catch {
      throw new Error(`Invalid skill: SKILL.md not found in ${source}`);
    }
    const skillName = basename(source);
    const destDir = join(skillsDir, skillName);
    await cp(source, destDir, { recursive: true });
  }
}
