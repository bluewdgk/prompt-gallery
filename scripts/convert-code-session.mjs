#!/usr/bin/env node
/**
 * Claude Code 세션 (.jsonl) → data/prompts/*.json 변환 스크립트
 *
 * Usage:
 *   node scripts/convert-code-session.mjs <session.jsonl> [--output data/prompts] [--tags tag1,tag2]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node scripts/convert-code-session.mjs <session.jsonl> [--output dir] [--tags tag1,tag2]');
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
const lines = raw.split('\n').filter(Boolean);

const messages = [];
for (const line of lines) {
  try {
    const entry = JSON.parse(line);
    // Claude Code JSONL format: {type, message: {role, content}}
    const role = entry.type === 'user' ? 'user'
      : entry.type === 'assistant' ? 'assistant'
      : entry.message?.role ?? null;
    if (!role) continue;

    let text = '';
    if (typeof entry.message?.content === 'string') {
      text = entry.message.content;
    } else if (Array.isArray(entry.message?.content)) {
      text = entry.message.content
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n');
    } else if (typeof entry.content === 'string') {
      text = entry.content;
    }

    if (text.trim()) messages.push({ role, text: text.trim() });
  } catch {
    // skip malformed lines
  }
}

if (messages.length === 0) {
  console.error('파싱 가능한 메시지가 없습니다.');
  process.exit(1);
}

const firstUser = messages.find(m => m.role === 'user');
const firstAssistant = messages.find(m => m.role === 'assistant');

if (!firstUser) {
  console.error('user 메시지를 찾을 수 없습니다.');
  process.exit(1);
}

function extractTitle(text) {
  const firstLine = text.split('\n').find(l => l.trim());
  if (!firstLine) return '(제목 없음)';
  return firstLine.replace(/^#+\s*/, '').slice(0, 60) + (firstLine.length > 60 ? '...' : '');
}

function extractDate(filePath) {
  const m = basename(filePath).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
}

function generateId(text) {
  return createHash('md5').update(text).digest('hex').slice(0, 8);
}

const id = `code-${generateId(firstUser.text)}-${Date.now().toString(36)}`;
const title = extractTitle(firstUser.text);
const date = extractDate(inputFile);

const result = {
  id,
  title,
  source: 'code',
  date,
  tags: ['Claude Code', ...extraTags],
  summary: firstUser.text.replace(/\n+/g, ' ').replace(/#+\s*/g, '').slice(0, 120).trim(),
  prompt: firstUser.text,
  ...(firstAssistant ? { response: firstAssistant.text } : {}),
  sessionRef: basename(inputFile),
};

mkdirSync(outputDir, { recursive: true });
const outPath = join(outputDir, `${id}.json`);
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`✓ 저장: ${outPath}`);
console.log(`  title: ${title}`);
console.log(`  date:  ${date}`);
