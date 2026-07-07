#!/usr/bin/env node
/**
 * 현재 data/prompts/ 등록 목록 확인
 *
 * Usage:
 *   node scripts/list-prompts.mjs [options]
 *
 * Options:
 *   --dir <path>        대상 디렉토리 (기본: data/prompts)
 *   --source web|code   출처 필터
 *   --sort date|title|turns  정렬 기준 (기본: date)
 *   --json              JSON 형식으로 출력
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
let dir = resolve('data/prompts');
let sourceFilter = null;
let sortKey = 'date';
let outputJson = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) dir = resolve(args[++i]);
  if (args[i] === '--source' && args[i + 1]) sourceFilter = args[++i];
  if (args[i] === '--sort' && args[i + 1]) sortKey = args[++i];
  if (args[i] === '--json') outputJson = true;
}

const files = readdirSync(dir).filter(f => f.endsWith('.json'));

let prompts = files.map(f => {
  try {
    return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
  } catch {
    return null;
  }
}).filter(Boolean);

if (sourceFilter) prompts = prompts.filter(p => p.source === sourceFilter);

prompts.sort((a, b) => {
  if (sortKey === 'title') return (a.title ?? '').localeCompare(b.title ?? '', 'ko');
  if (sortKey === 'turns') return (b.messages?.length ?? 0) - (a.messages?.length ?? 0);
  return new Date(b.date).getTime() - new Date(a.date).getTime(); // date (default)
});

if (outputJson) {
  console.log(JSON.stringify(prompts.map(p => ({
    id: p.id, title: p.title, source: p.source,
    date: p.date, tags: p.tags, turns: p.messages?.length ?? null,
  })), null, 2));
  process.exit(0);
}

// ── 표 출력 ──────────────────────────────────────────────────────
function padEnd(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

const sourceLabel = { web: '웹', code: 'Code' };
const header =
  ' ' + padEnd('No.', 4) +
  padEnd('소스', 6) +
  padEnd('날짜', 12) +
  padEnd('턴', 5) +
  '제목';
const sep = '─'.repeat(80);

console.log(`\n등록된 프롬프트: ${prompts.length}개${sourceFilter ? ` (source=${sourceFilter})` : ''}\n`);
console.log(header);
console.log(sep);

prompts.forEach((p, i) => {
  const num = String(i + 1).padStart(3);
  const src = padEnd(sourceLabel[p.source] ?? p.source, 6);
  const date = padEnd(p.date, 12);
  const turns = padEnd(p.messages?.length != null ? `${p.messages.length}턴` : '-', 5);
  const title = (p.title ?? '').slice(0, 42);
  console.log(` [${num}] ${src}${date}${turns}${title}`);
});

console.log(sep);
console.log(`\n사용법: node scripts/convert-web-chat.mjs <file.json>`);
console.log(`        node scripts/convert-code-session.mjs <session.jsonl>\n`);
