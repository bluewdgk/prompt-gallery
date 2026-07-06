#!/usr/bin/env node
/**
 * Claude 웹 채팅 export (JSON) → data/prompts/*.json 변환 스크립트
 *
 * Usage:
 *   node scripts/convert-web-chat.mjs <export.json> [--output data/prompts] [--tags tag1,tag2]
 *
 * 지원 포맷:
 *   - Claude 공식 export: { conversations: [{ uuid, name, created_at, chat_messages: [] }] }
 *   - 단일 대화: { uuid, name, created_at, chat_messages: [] }
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node scripts/convert-web-chat.mjs <export.json> [--output dir] [--tags tag1,tag2]');
  process.exit(0);
}

const inputFile = resolve(args[0]);
let outputDir = resolve('data/prompts');
let extraTags = [];

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) outputDir = resolve(args[++i]);
  if (args[i] === '--tags' && args[i + 1]) extraTags = args[++i].split(',').map(s => s.trim());
}

const raw = readFileSync(inputFile, 'utf-8');
const data = JSON.parse(raw);

// Normalize to array of conversations
let conversations = [];
if (Array.isArray(data?.conversations)) {
  conversations = data.conversations;
} else if (Array.isArray(data)) {
  conversations = data;
} else if (data?.chat_messages) {
  conversations = [data];
} else {
  console.error('지원하지 않는 포맷입니다. conversations 배열 또는 단일 대화 객체를 넣어주세요.');
  process.exit(1);
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}

function extractTitle(conv) {
  if (conv.name && conv.name !== 'New conversation') return conv.name.slice(0, 80);
  const firstHuman = conv.chat_messages?.find(m => m.sender === 'human');
  if (!firstHuman) return '(제목 없음)';
  const text = extractText(firstHuman.content ?? firstHuman.text ?? '');
  return text.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 60) ?? '(제목 없음)';
}

function generateId(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 8);
}

mkdirSync(outputDir, { recursive: true });
let savedCount = 0;

for (const conv of conversations) {
  const messages = conv.chat_messages ?? conv.messages ?? [];
  const humanMsg = messages.find(m => m.sender === 'human' || m.role === 'user');
  const assistantMsg = messages.find(m => m.sender === 'assistant' || m.role === 'assistant');
  if (!humanMsg) continue;

  const promptText = extractText(humanMsg.content ?? humanMsg.text ?? '');
  const responseText = assistantMsg
    ? extractText(assistantMsg.content ?? assistantMsg.text ?? '')
    : undefined;

  if (!promptText) continue;

  const uuid = conv.uuid ?? generateId(promptText);
  const id = `web-${uuid.slice(0, 8)}`;
  const title = extractTitle(conv);
  const date = conv.created_at
    ? new Date(conv.created_at).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const result = {
    id,
    title,
    source: 'web',
    date,
    tags: ['웹 채팅', ...extraTags],
    summary: promptText.replace(/\n+/g, ' ').replace(/#+\s*/g, '').slice(0, 120).trim(),
    prompt: promptText,
    ...(responseText ? { response: responseText } : {}),
  };

  const outPath = join(outputDir, `${id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✓ 저장: ${outPath}  (${title})`);
  savedCount++;
}

console.log(`\n총 ${savedCount}개 대화 변환 완료.`);
