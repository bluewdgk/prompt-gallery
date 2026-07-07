#!/usr/bin/env node
/**
 * Claude 웹 채팅 export (JSON) → data/prompts/*.json 변환 스크립트
 *
 * Usage:
 *   node scripts/convert-web-chat.mjs <export.json> [options]
 *
 * Options:
 *   --output <dir>           저장 디렉토리 (기본값: data/prompts)
 *   --tags <tag1,tag2>       추가 태그
 *   --filter-ids-dir <dir>   해당 디렉토리에 이미 존재하는 web-*.json ID에 해당하는
 *                            대화만 처리 (재생성 용도)
 *
 * 지원 포맷:
 *   - Claude 공식 export: [{uuid, name, created_at, chat_messages:[]}]
 *   - 래핑된 포맷: {conversations: [{...}]}
 *   - 단일 대화: {uuid, name, created_at, chat_messages:[]}
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log([
    'Usage: node scripts/convert-web-chat.mjs <export.json> [options]',
    '',
    'Options:',
    '  --output <dir>          저장 디렉토리 (기본값: data/prompts)',
    '  --tags <tag1,tag2>      추가 태그',
    '  --filter-ids-dir <dir>  해당 디렉토리의 기존 web-*.json ID만 처리 (재생성 용도)',
  ].join('\n'));
  process.exit(0);
}

const inputFile = resolve(args[0]);
let outputDir = resolve('data/prompts');
let extraTags = [];
let filterIdsDir = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) outputDir = resolve(args[++i]);
  if (args[i] === '--tags' && args[i + 1]) extraTags = args[++i].split(',').map(s => s.trim());
  if (args[i] === '--filter-ids-dir' && args[i + 1]) filterIdsDir = resolve(args[++i]);
}

// 필터 ID 세트 구성 (web-XXXXXXXX → "XXXXXXXX")
let filterShortIds = null;
if (filterIdsDir) {
  const existing = readdirSync(filterIdsDir).filter(f => /^web-[0-9a-f]+\.json$/.test(f));
  filterShortIds = new Set(existing.map(f => f.replace(/^web-/, '').replace(/\.json$/, '')));
  console.log(`필터 모드: ${filterShortIds.size}개 ID만 처리`);
}

const raw = readFileSync(inputFile, 'utf-8');
const data = JSON.parse(raw);

let conversations = [];
if (Array.isArray(data?.conversations)) {
  conversations = data.conversations;
} else if (Array.isArray(data)) {
  conversations = data;
} else if (data?.chat_messages) {
  conversations = [data];
} else {
  console.error('지원하지 않는 포맷입니다.');
  process.exit(1);
}

function extractText(content, text) {
  // text 필드 우선 (이미 평탄화된 문자열)
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}

function extractTitle(conv, firstHumanText) {
  if (conv.name && conv.name.trim() && conv.name !== 'New conversation') {
    return conv.name.trim().slice(0, 80);
  }
  if (!firstHumanText) return '(제목 없음)';
  return (
    firstHumanText
      .split('\n')
      .find(l => l.trim())
      ?.replace(/^#+\s*/, '')
      .slice(0, 60) ?? '(제목 없음)'
  );
}

function generateId(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 8);
}

mkdirSync(outputDir, { recursive: true });
let savedCount = 0;
let skippedCount = 0;

for (const conv of conversations) {
  const uuid = conv.uuid ?? generateId(conv.name ?? String(Math.random()));
  const shortId = uuid.slice(0, 8);

  if (filterShortIds && !filterShortIds.has(shortId)) {
    skippedCount++;
    continue;
  }

  const rawMessages = conv.chat_messages ?? conv.messages ?? [];

  // 전체 턴 추출 (human / assistant)
  const messages = rawMessages
    .map(m => {
      const role = m.sender ?? m.role ?? '';
      const content = extractText(m.content, m.text);
      return { role, content };
    })
    .filter(m => (m.role === 'human' || m.role === 'assistant') && m.content);

  if (messages.length === 0) {
    skippedCount++;
    continue;
  }

  const firstHuman = messages.find(m => m.role === 'human');
  if (!firstHuman) {
    skippedCount++;
    continue;
  }

  const id = `web-${shortId}`;
  const title = extractTitle(conv, firstHuman.content);
  const date = conv.created_at
    ? new Date(conv.created_at).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const result = {
    id,
    title,
    source: 'web',
    date,
    tags: ['웹 채팅', ...extraTags],
    summary: firstHuman.content.replace(/\n+/g, ' ').replace(/#+\s*/g, '').slice(0, 120).trim(),
    // 전체 멀티턴 배열
    messages,
    // 하위 호환: 첫 human/assistant 턴 (검색 인덱스, 변환 스크립트 단순 활용용)
    prompt: firstHuman.content,
    ...(messages.find(m => m.role === 'assistant')
      ? { response: messages.find(m => m.role === 'assistant').content }
      : {}),
  };

  const outPath = join(outputDir, `${id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✓ ${outPath}  [${messages.length}턴]  ${title.slice(0, 40)}`);
  savedCount++;
}

console.log(`\n✓ 저장 ${savedCount}개 / 스킵 ${skippedCount}개`);
