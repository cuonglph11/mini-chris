import type { SkillMeta } from '../types.js';
import { scanSkills, readSkillContent } from './loader.js';

export function matchSkill(task: string, skills: SkillMeta[]): SkillMeta | null {
  if (skills.length === 0) return null;

  const taskWords = task.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (taskWords.length === 0) return null;

  let bestSkill: SkillMeta | null = null;
  let bestScore = 0;

  for (const skill of skills) {
    const skillWords = `${skill.name} ${skill.description}`
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2);

    let score = 0;
    for (const word of taskWords) {
      if (skillWords.includes(word)) {
        score++;
      }
    }

    if (
      score > bestScore ||
      (score === bestScore && score > 0 && skill.description.length > (bestSkill?.description.length ?? 0))
    ) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  return bestScore > 0 ? bestSkill : null;
}

export async function injectSkill(task: string, workspacePath: string): Promise<string> {
  const skills = await scanSkills(workspacePath);
  const match = matchSkill(task, skills);
  if (!match) return '';
  return readSkillContent(match.path);
}
