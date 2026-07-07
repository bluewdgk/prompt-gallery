#!/usr/bin/env node
/**
 * Claude 웹 채팅 export (JSON) → data/prompts/*.json 변환
 *
 * Usage:
 *   node scripts/convert-web-chat.mjs <export.json> [options]
 *
 * Options:
 *   --output <dir>          저장 경로 (기본: data/prompts)
 *   --tags <t1,t2>          추가 태그
 *   --all                   목록 표시 없이 전체 변환
 *   --filter-ids-dir <dir>  해당 디렉토리 기존 web-*.json ID만 재생성 (비대화형)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

// ── CLI 인수 파싱 ────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log(
    'Usage: node scripts/convert-web-chat.mjs <export.json> [--output dir] [--tags t1,t2] [--all] [--filter-ids-dir dir]'
  );
  process.exit(0);
}

const inputFile = resolve(args[0]);
let outputDir = resolve('data/prompts');
let extraTags = [];
let convertAll = false;
let filterIdsDir = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) outputDir = resolve(args[++i]);
  if (args[i] === '--tags' && args[i + 1]) extraTags = args[++i].split(',').map(s => s.trim());
  if (args[i] === '--all') convertAll = true;
  if (args[i] === '--filter-ids-dir' && args[i + 1]) filterIdsDir = resolve(args[++i]);
}

// ── 데이터 로드 ───────────────────────────────────────────────────
const raw = readFileSync(inputFile, 'utf-8');
const data = JSON.parse(raw);

let conversations = [];
if (Array.isArray(data?.conversations)) conversations = data.conversations;
else if (Array.isArray(data)) conversations = data;
else if (data?.chat_messages) conversations = [data];
else { console.error('지원하지 않는 포맷입니다.'); process.exit(1); }

// ── 텍스트 추출 (thinking / tool_result 제거) ─────────────────────
function extractText(content, text) {
  // content 블록 배열이 있으면 우선 처리
  if (Array.isArray(content) && content.length > 0) {
    const parts = [];
    for (const block of content) {
      if (block.type === 'text') {
        const t = (block.text ?? '').trim();
        if (t) parts.push(t);
      } else if (block.type === 'tool_use') {
        // 도구 호출 → placeholder
        parts.push(`[도구 사용: ${block.name ?? 'unknown'}]`);
      }
      // thinking, tool_result, image, document → 무시
    }
    const result = parts.join('\n\n').trim();
    if (result) return result;
    // content에 text 블록이 없을 때만(예: tool_result만 있는 메시지) text 필드 시도하지 않음
    return '';
  }
  // content가 빈 배열이거나 없을 때 text 필드 폴백 (구형 포맷)
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (typeof content === 'string') return content.trim();
  return '';
}

// ── 제목 추출 ─────────────────────────────────────────────────────
function extractTitle(conv, firstHumanText) {
  if (conv.name && conv.name.trim() && conv.name !== 'New conversation')
    return conv.name.trim().slice(0, 80);
  return (
    firstHumanText
      ?.split('\n')
      .find(l => l.trim())
      ?.replace(/^#+\s*/, '')
      .slice(0, 60) ?? '(제목 없음)'
  );
}

function generateId(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 8);
}

// ── 대화 → 메시지 배열 변환 ───────────────────────────────────────
function buildMessages(conv) {
  return (conv.chat_messages ?? conv.messages ?? [])
    .map(m => ({
      role: m.sender ?? m.role ?? '',
      content: extractText(m.content, m.text),
    }))
    .filter(m => (m.role === 'human' || m.role === 'assistant') && m.content);
}

// ── 대화 메타데이터 ───────────────────────────────────────────────
const convMeta = conversations.map(conv => {
  const uuid = conv.uuid ?? generateId(conv.name ?? String(Math.random()));
  const msgs = buildMessages(conv);
  const firstHuman = msgs.find(m => m.role === 'human');
  return {
    uuid,
    shortId: uuid.slice(0, 8),
    id: `web-${uuid.slice(0, 8)}`,
    title: extractTitle(conv, firstHuman?.content ?? ''),
    date: conv.created_at ? new Date(conv.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    turns: msgs.length,
    messages: msgs,
    firstHuman,
    valid: !!firstHuman,
  };
}).filter(m => m.valid);

// ── 저장 함수 ─────────────────────────────────────────────────────
mkdirSync(outputDir, { recursive: true });

function saveConv(meta) {
  const result = {
    id: meta.id,
    title: meta.title,
    source: 'web',
    date: meta.date,
    tags: ['웹 채팅', ...extraTags],
    summary: meta.firstHuman.content.replace(/\n+/g, ' ').replace(/#+\s*/g, '').slice(0, 120).trim(),
    messages: meta.messages,
    prompt: meta.firstHuman.content,
    ...(meta.messages.find(m => m.role === 'assistant')
      ? { response: meta.messages.find(m => m.role === 'assistant').content }
      : {}),
  };
  const outPath = join(outputDir, `${meta.id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✓ ${meta.id}.json  [${meta.turns}턴]  ${meta.title.slice(0, 44)}`);
}

// ── 재생성 모드 (--filter-ids-dir) ───────────────────────────────
if (filterIdsDir) {
  const existing = readdirSync(filterIdsDir).filter(f => /^web-[0-9a-f]+\.json$/.test(f));
  const filterSet = new Set(existing.map(f => f.replace(/^web-/, '').replace(/\.json$/, '')));
  console.log(`재생성 모드: ${filterSet.size}개 ID 필터`);
  let saved = 0;
  for (const meta of convMeta) {
    if (filterSet.has(meta.shortId)) { saveConv(meta); saved++; }
  }
  console.log(`\n✓ ${saved}개 재생성 완료`);
  process.exit(0);
}

// ── 전체 변환 모드 (--all) ────────────────────────────────────────
if (convertAll) {
  console.log(`전체 변환: ${convMeta.length}개`);
  convMeta.forEach(saveConv);
  console.log(`\n✓ ${convMeta.length}개 저장 완료`);
  process.exit(0);
}

// ── 인터랙티브 모드 ───────────────────────────────────────────────
function padEnd(str, len) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

console.log(`\n파일: ${inputFile}`);
console.log(`유효 대화 ${convMeta.length}개\n`);

const numWidth = String(convMeta.length).length;
const titleWidth = 44;

console.log(
  ' ' + padEnd('No.', numWidth + 2) +
  padEnd('제목', titleWidth + 2) +
  padEnd('날짜', 12) + '턴'
);
console.log('─'.repeat(numWidth + titleWidth + 22));

convMeta.forEach((m, i) => {
  const num = String(i + 1).padStart(numWidth);
  console.log(` [${num}]  ${padEnd(m.title, titleWidth)}  ${m.date}  ${m.turns}턴`);
});

console.log('');
console.log('변환할 번호를 입력하세요.');
console.log('  형식: 1 3 5-10   (공백·쉼표·범위 사용 가능)');
console.log('  전체: all   종료: q\n');

function parseSelection(input, max) {
  if (input.trim().toLowerCase() === 'all')
    return Array.from({ length: max }, (_, i) => i);
  const indices = new Set();
  for (const part of input.split(/[\s,]+/).filter(Boolean)) {
    if (part.toLowerCase() === 'q') return null;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) if (i >= 1 && i <= max) indices.add(i - 1);
    } else {
      const n = Number(part);
      if (!isNaN(n) && n >= 1 && n <= max) indices.add(n - 1);
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('> ', answer => {
  rl.close();
  if (answer.trim().toLowerCase() === 'q') {
    console.log('취소됨.');
    process.exit(0);
  }
  const selected = parseSelection(answer, convMeta.length);
  if (!selected || selected.length === 0) {
    console.log('선택 없음. 종료.');
    process.exit(0);
  }
  console.log(`\n${selected.length}개 변환 시작...\n`);
  for (const idx of selected) saveConv(convMeta[idx]);
  console.log(`\n✓ ${selected.length}개 저장 완료`);
});
