import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Message {
  role: 'human' | 'assistant';
  content: string;
}

export interface Prompt {
  id: string;
  title: string;
  source: 'web' | 'code';
  date: string;
  tags: string[];
  summary: string;
  prompt: string;
  response?: string;
  messages?: Message[];
  sessionRef?: string;
}

export function loadPrompts(): Prompt[] {
  const dir = join(process.cwd(), 'data', 'prompts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  const prompts = files.map((file) => {
    const raw = readFileSync(join(dir, file), 'utf-8');
    const data = JSON.parse(raw) as Partial<Prompt>;
    if (!data.id) data.id = file.replace(/\.json$/, '');
    return data as Prompt;
  });

  return prompts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function loadPromptById(id: string): Prompt | undefined {
  return loadPrompts().find((p) => p.id === id);
}

export function getAllTags(prompts: Prompt[]): string[] {
  const set = new Set<string>();
  prompts.forEach((p) => p.tags.forEach((t) => set.add(t)));
  return Array.from(set).sort();
}
