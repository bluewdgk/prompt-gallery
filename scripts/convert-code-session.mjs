#!/usr/bin/env node
/**
 * Claude Code 세션 (.jsonl) → data/prompts/*.json 변환 스크립트
 *
 * Usage:
 *   node scripts/convert-code-session.mjs <session.jsonl> [--output data/prompts] [--tags tag1,tag2]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
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

// ── 콘텐츠 블록 → 텍스트 추출 ────────────────────────────────────
function extractText(content) {
  // 문자열 content (구형 또는 user text)
  if (typeof content === 'string') return content.trim();

  // 배열 content (블록 형태)
  if (Array.isArray(content) && content.length > 0) {
    const parts = [];
    for (const block of content) {
      if (block.type === 'text') {
        const t = (block.text ?? '').trim();
        if (t) parts.push(t);
      } else if (block.type === 'tool_use') {
        parts.push(`[도구 사용: ${block.name ?? 'unknown'}]`);
      }
      // thinking, tool_result, image → 무시
    }
    return parts.join('\n\n').trim();
  }
  return '';
}

// user 메시지가 tool_result 전용인지 (순수 도구 응답 → 대화 턴 제외)
function isToolResultOnly(content) {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(b => b.type === 'tool_result' || b.type === 'tool_use');
}

// ── JSONL 파싱 ────────────────────────────────────────────────────
const messages = [];
for (const line of lines) {
  try {
    const entry = JSON.parse(line);
    const role = entry.type === 'user' ? 'human'
      : entry.type === 'assistant' ? 'assistant'
      : null;
    if (!role) continue;

    const rawContent = entry.message?.content;

    // tool_result만 담긴 user 메시지는 UI 턴이 아니므로 제외
    if (role === 'human' && isToolResultOnly(rawContent)) continue;

    const text = extractText(rawContent);
    if (text) messages.push({ role, content: text });
  } catch {
    // malformed line skip
  }
}

if (messages.length === 0) {
  console.error('파싱 가능한 메시지가 없습니다.');
  process.exit(1);
}

const firstHuman = messages.find(m => m.role === 'human');
if (!firstHuman) {
  console.error('human 메시지를 찾을 수 없습니다.');
  process.exit(1);
}

// ── 메타데이터 추출 ────────────────────────────────────────────────
function extractTitle(text) {
  const firstLine = text.split('\n').find(l => l.trim());
  if (!firstLine) return '(제목 없음)';
  return firstLine.replace(/^#+\s*/, '').slice(0, 60) + (firstLine.replace(/^#+\s*/, '').length > 60 ? '...' : '');
}

function extractDate(filePath) {
  const m = basename(filePath).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
}

function generateId(text) {
  return createHash('md5').update(text).digest('hex').slice(0, 8);
}

const hashId = generateId(firstHuman.content);
const id = `code-${hashId}`;
const title = extractTitle(firstHuman.content);
const date = extractDate(inputFile);
const firstAssistant = messages.find(m => m.role === 'assistant');

// ── 기존 타임스탬프 포함 파일명 정리 ────────────────────────────────
mkdirSync(outputDir, { recursive: true });
const staleFiles = readdirSync(outputDir).filter(f => f.startsWith(`code-${hashId}-`) && f.endsWith('.json'));
for (const f of staleFiles) {
  unlinkSync(join(outputDir, f));
  console.log(`  삭제(구 파일): ${f}`);
}

// ── 저장 ─────────────────────────────────────────────────────────
const result = {
  id,
  title,
  source: 'code',
  date,
  tags: ['Claude Code', ...extraTags],
  summary: firstHuman.content.replace(/\n+/g, ' ').replace(/#+\s*/g, '').slice(0, 120).trim(),
  messages,
  prompt: firstHuman.content,
  ...(firstAssistant ? { response: firstAssistant.content } : {}),
  sessionRef: basename(inputFile),
};

const outPath = join(outputDir, `${id}.json`);
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`✓ 저장: ${outPath}`);
console.log(`  title:  ${title}`);
console.log(`  date:   ${date}`);
console.log(`  turns:  ${messages.length}턴`);
