#!/usr/bin/env node
/**
 * 로컬 전용 관리자 서버
 *
 * 실행: npm run admin  (또는 node admin/server.mjs)
 * 접속: http://localhost:3001
 *
 * 이 파일은 Astro 빌드(dist/)에 포함되지 않습니다.
 */

import { createServer } from 'node:http';
import {
  readFileSync, writeFileSync, unlinkSync,
  readdirSync, mkdirSync, existsSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROMPTS_DIR = join(ROOT, 'data', 'prompts');
const PORT = process.env.ADMIN_PORT ?? 3001;
const MAX_BODY = 100 * 1024 * 1024; // 100 MB

// ── 유틸 ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(new Error('요청 크기 초과')); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendErr(res, msg, status = 400) {
  sendJson(res, { error: msg }, status);
}

// ── 카드 목록 ─────────────────────────────────────────────────────
function loadCards() {
  if (!existsSync(PROMPTS_DIR)) return [];
  return readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(PROMPTS_DIR, f), 'utf-8'));
        return {
          id: data.id ?? f.replace(/\.json$/, ''),
          title: data.title ?? '(제목 없음)',
          source: data.source ?? '',
          date: data.date ?? '',
          turns: Array.isArray(data.messages) ? data.messages.length : (data.response ? 2 : 1),
          file: f,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── 대화 파싱 (convert-web-chat.mjs 와 동일 로직) ──────────────────
function extractText(content, text) {
  if (Array.isArray(content) && content.length > 0) {
    const parts = [];
    for (const block of content) {
      if (block.type === 'text') {
        const t = (block.text ?? '').trim();
        if (t) parts.push(t);
      } else if (block.type === 'tool_use') {
        parts.push(`[도구 사용: ${block.name ?? 'unknown'}]`);
      }
    }
    return parts.join('\n\n').trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (typeof content === 'string') return content.trim();
  return '';
}

function extractTitle(conv, firstHumanText) {
  if (conv.name && conv.name.trim() && conv.name !== 'New conversation')
    return conv.name.trim().slice(0, 80);
  return (
    firstHumanText?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 60) ??
    '(제목 없음)'
  );
}

function buildMessages(conv) {
  return (conv.chat_messages ?? conv.messages ?? [])
    .map((m) => ({
      role: m.sender ?? m.role ?? '',
      content: extractText(m.content, m.text),
    }))
    .filter((m) => (m.role === 'human' || m.role === 'assistant') && m.content);
}

function parseConversations(raw, filename) {
  let data;
  if (filename?.toLowerCase().endsWith('.jsonl')) {
    data = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } else {
    data = JSON.parse(raw);
  }

  let convs = [];
  if (Array.isArray(data?.conversations)) convs = data.conversations;
  else if (Array.isArray(data)) convs = data;
  else if (data?.chat_messages) convs = [data];
  else throw new Error('지원하지 않는 포맷입니다 (conversations 배열을 찾지 못함)');

  return convs
    .map((conv) => {
      const uuid =
        conv.uuid ??
        createHash('md5')
          .update(conv.name ?? String(Math.random()))
          .digest('hex');
      const msgs = buildMessages(conv);
      const firstHuman = msgs.find((m) => m.role === 'human');
      return {
        uuid,
        id: `web-${uuid.slice(0, 8)}`,
        title: extractTitle(conv, firstHuman?.content ?? ''),
        date: conv.created_at
          ? new Date(conv.created_at).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        turns: msgs.length,
        messages: msgs,
        firstHuman,
        valid: !!firstHuman,
      };
    })
    .filter((m) => m.valid);
}

function saveConversation(meta) {
  const firstAssistant = meta.messages.find((m) => m.role === 'assistant');
  const result = {
    id: meta.id,
    title: meta.title,
    source: 'web',
    date: meta.date,
    tags: ['웹 채팅'],
    summary: meta.firstHuman.content
      .replace(/\n+/g, ' ')
      .replace(/#+\s*/g, '')
      .slice(0, 120)
      .trim(),
    messages: meta.messages,
    prompt: meta.firstHuman.content,
    ...(firstAssistant ? { response: firstAssistant.content } : {}),
  };
  mkdirSync(PROMPTS_DIR, { recursive: true });
  const outPath = join(PROMPTS_DIR, `${meta.id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  return outPath;
}

// ── HTML UI ───────────────────────────────────────────────────────
const HTML = /* html */ `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prompt Gallery — 관리자</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2d3148;
    --text: #e2e8f0; --muted: #8892a4; --accent: #6366f1;
    --accent-h: #818cf8; --danger: #ef4444; --danger-h: #f87171;
    --success: #22c55e; --warn: #f59e0b;
    --radius: 6px; --font: 'Segoe UI', system-ui, sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; min-height: 100vh; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; font-weight: 600; color: var(--text); }
  header span { font-size: 12px; color: var(--muted); background: var(--bg); border: 1px solid var(--border); padding: 2px 8px; border-radius: 20px; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); background: var(--surface); padding: 0 24px; }
  .tab-btn { background: none; border: none; color: var(--muted); padding: 12px 18px; cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent-h); border-bottom-color: var(--accent); }
  .panel { display: none; padding: 24px; }
  .panel.active { display: block; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .badge { display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 12px; font-weight: 500; }
  .badge-web { background: #1e3a5f; color: #60a5fa; }
  .badge-code { background: #1a3326; color: #4ade80; }
  .badge-exists { background: #3b2a1a; color: var(--warn); }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: var(--radius); border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: background .15s; }
  .btn-danger { background: #2d1515; color: var(--danger); }
  .btn-danger:hover { background: #3d1f1f; color: var(--danger-h); }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-h); }
  .btn-secondary { background: var(--border); color: var(--text); }
  .btn-secondary:hover { background: #3d4260; }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  input[type="file"] { display: none; }
  .file-label { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; font-size: 13px; color: var(--text); transition: border-color .15s; }
  .file-label:hover { border-color: var(--accent); }
  .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .count-badge { font-size: 12px; color: var(--muted); }
  .empty { text-align: center; padding: 60px 0; color: var(--muted); }
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: var(--radius); font-size: 13px; font-weight: 500; z-index: 999; animation: slideIn .2s ease; }
  .toast-ok { background: #14532d; color: var(--success); border: 1px solid #166534; }
  .toast-err { background: #2d0f0f; color: var(--danger); border: 1px solid #7f1d1d; }
  @keyframes slideIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .import-info { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 18px; margin-bottom: 20px; font-size: 13px; color: var(--muted); }
  .import-info strong { color: var(--text); }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .select-all-row { background: rgba(99,102,241,.07); }
  input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
  .title-cell { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .confirm-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; min-width: 340px; }
  .confirm-box h3 { font-size: 16px; margin-bottom: 10px; }
  .confirm-box p { color: var(--muted); font-size: 13px; margin-bottom: 24px; line-height: 1.5; }
  .confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
</style>
</head>
<body>
<header>
  <h1>Prompt Gallery</h1>
  <span>관리자 도구 · 로컬 전용</span>
</header>

<div class="tabs">
  <button class="tab-btn active" onclick="switchTab('cards')">카드 관리</button>
  <button class="tab-btn" onclick="switchTab('import')">대화 가져오기</button>
</div>

<!-- ── 카드 관리 ───────────────────────────────────────── -->
<div id="panel-cards" class="panel active">
  <div class="toolbar">
    <span class="count-badge" id="cards-count">로딩 중…</span>
    <button class="btn btn-secondary" onclick="loadCards()" style="margin-left:auto">새로고침</button>
  </div>
  <div id="cards-table-wrap">
    <div class="empty"><div class="spinner"></div></div>
  </div>
</div>

<!-- ── 대화 가져오기 ──────────────────────────────────── -->
<div id="panel-import" class="panel">
  <div class="toolbar">
    <label class="file-label" for="import-file">
      📂 파일 선택 (.json / .jsonl)
    </label>
    <input type="file" id="import-file" accept=".json,.jsonl" onchange="onFileChange(this)">
    <span class="count-badge" id="import-status">파일을 선택하면 대화 목록이 표시됩니다</span>
    <button id="import-btn" class="btn btn-primary" style="margin-left:auto" disabled onclick="importSelected()">선택한 대화 가져오기</button>
  </div>
  <div id="import-info" class="import-info" style="display:none"></div>
  <div id="import-table-wrap"></div>
</div>

<!-- ── 삭제 확인 다이얼로그 ──────────────────────────── -->
<div id="confirm-overlay" class="confirm-overlay" style="display:none" onclick="closeConfirm(event)">
  <div class="confirm-box" onclick="event.stopPropagation()">
    <h3>카드 삭제</h3>
    <p id="confirm-msg"></p>
    <div class="confirm-actions">
      <button class="btn btn-secondary" onclick="closeConfirm()">취소</button>
      <button class="btn btn-danger" id="confirm-ok" onclick="confirmDelete()">삭제</button>
    </div>
  </div>
</div>

<script>
// ── 상태 ───────────────────────────────────────
let pendingDeleteId = null;
let importConvs = [];
let importFilename = '';
let importRaw = '';

// ── 탭 전환 ───────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['cards','import'][i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'cards') loadCards();
}

// ── 토스트 ────────────────────────────────────
function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── 카드 관리 ─────────────────────────────────
async function loadCards() {
  document.getElementById('cards-count').textContent = '로딩 중…';
  document.getElementById('cards-table-wrap').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  try {
    const cards = await fetch('/api/cards').then(r => r.json());
    renderCards(cards);
  } catch(e) {
    document.getElementById('cards-table-wrap').innerHTML = '<div class="empty">로드 실패: ' + e.message + '</div>';
  }
}

function renderCards(cards) {
  document.getElementById('cards-count').textContent = cards.length + '개 카드';
  if (cards.length === 0) {
    document.getElementById('cards-table-wrap').innerHTML = '<div class="empty">카드가 없습니다</div>';
    return;
  }
  const rows = cards.map(c => \`
    <tr>
      <td class="title-cell" title="\${esc(c.title)}">\${esc(c.title)}</td>
      <td><span class="badge badge-\${c.source}">\${c.source || '-'}</span></td>
      <td style="white-space:nowrap">\${esc(c.date)}</td>
      <td style="text-align:right">\${c.turns}</td>
      <td><button class="btn btn-danger" data-id="\${esc(c.id)}" data-title="\${esc(c.title)}" onclick="askDelete(this.dataset.id,this.dataset.title)">삭제</button></td>
    </tr>
  \`).join('');
  document.getElementById('cards-table-wrap').innerHTML = \`
    <table>
      <thead><tr>
        <th>제목</th><th>소스</th><th>날짜</th><th style="text-align:right">턴</th><th></th>
      </tr></thead>
      <tbody>\${rows}</tbody>
    </table>
  \`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 삭제 확인 ─────────────────────────────────
function askDelete(id, title) {
  pendingDeleteId = id;
  document.getElementById('confirm-msg').textContent =
    '"' + title + '" 카드를 삭제합니다. 이 작업은 되돌릴 수 없습니다.';
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function closeConfirm(e) {
  if (e && e.target !== document.getElementById('confirm-overlay')) return;
  document.getElementById('confirm-overlay').style.display = 'none';
  pendingDeleteId = null;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  document.getElementById('confirm-overlay').style.display = 'none';
  pendingDeleteId = null;
  try {
    const r = await fetch('/api/cards/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    toast('삭제 완료: ' + id);
    loadCards();
  } catch(e) {
    toast('삭제 실패: ' + e.message, false);
  }
}

// ── 대화 가져오기 ──────────────────────────────
function onFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  importFilename = file.name;
  document.getElementById('import-status').textContent = '분석 중…';
  document.getElementById('import-table-wrap').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  document.getElementById('import-info').style.display = 'none';
  document.getElementById('import-btn').disabled = true;

  const reader = new FileReader();
  reader.onload = async (e) => {
    importRaw = e.target.result;
    try {
      const r = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: importRaw, filename: importFilename }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      importConvs = data.list;
      renderImportList(data.list);
    } catch(err) {
      document.getElementById('import-status').textContent = '파싱 실패';
      document.getElementById('import-table-wrap').innerHTML =
        '<div class="empty" style="color:var(--danger)">' + esc(err.message) + '</div>';
    }
  };
  reader.readAsText(file, 'utf-8');
}

function renderImportList(list) {
  document.getElementById('import-status').textContent = list.length + '개 대화 발견';
  const existsCount = list.filter(c => c.exists).length;

  const info = document.getElementById('import-info');
  info.style.display = 'block';
  info.innerHTML =
    '<strong>' + list.length + '</strong>개 대화 · ' +
    (existsCount > 0
      ? '<span style="color:var(--warn)">' + existsCount + '개는 이미 존재</span> (덮어쓰기됨) · '
      : '') +
    '파일: <strong>' + esc(importFilename) + '</strong>';

  if (list.length === 0) {
    document.getElementById('import-table-wrap').innerHTML = '<div class="empty">유효한 대화가 없습니다</div>';
    return;
  }

  const rows = list.map(c => \`
    <tr>
      <td style="width:40px;text-align:center"><input type="checkbox" class="conv-check" data-idx="\${c.index}" checked></td>
      <td style="width:36px;color:var(--muted);text-align:right">\${c.index + 1}</td>
      <td class="title-cell" title="\${esc(c.title)}">\${esc(c.title)}\${c.exists ? ' <span class="badge badge-exists">중복</span>' : ''}</td>
      <td style="white-space:nowrap">\${esc(c.date)}</td>
      <td style="text-align:right">\${c.turns}턴</td>
    </tr>
  \`).join('');

  document.getElementById('import-table-wrap').innerHTML = \`
    <table>
      <thead><tr class="select-all-row">
        <th style="width:40px;text-align:center"><input type="checkbox" id="check-all" checked onchange="toggleAll(this)"></th>
        <th style="width:36px">#</th>
        <th>제목</th>
        <th>날짜</th>
        <th style="text-align:right">턴수</th>
      </tr></thead>
      <tbody>\${rows}</tbody>
    </table>
  \`;

  updateImportBtn();
  document.querySelectorAll('.conv-check').forEach(cb => cb.addEventListener('change', updateImportBtn));
}

function toggleAll(masterCb) {
  document.querySelectorAll('.conv-check').forEach(cb => { cb.checked = masterCb.checked; });
  updateImportBtn();
}

function updateImportBtn() {
  const checked = document.querySelectorAll('.conv-check:checked').length;
  const btn = document.getElementById('import-btn');
  btn.disabled = checked === 0;
  btn.textContent = checked > 0 ? checked + '개 대화 가져오기' : '선택한 대화 가져오기';
}

async function importSelected() {
  const indices = Array.from(document.querySelectorAll('.conv-check:checked')).map(cb => parseInt(cb.dataset.idx));
  if (indices.length === 0) return;
  const btn = document.getElementById('import-btn');
  btn.disabled = true;
  btn.textContent = '저장 중…';
  try {
    const r = await fetch('/api/import/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices, content: importRaw, filename: importFilename }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    toast(data.saved.length + '개 저장 완료');
    // 저장된 항목 체크박스 해제
    document.querySelectorAll('.conv-check:checked').forEach(cb => { cb.checked = false; });
    document.getElementById('check-all').checked = false;
    updateImportBtn();
  } catch(e) {
    toast('저장 실패: ' + e.message, false);
    btn.disabled = false;
    updateImportBtn();
  }
}

// ── 초기 로드 ─────────────────────────────────
loadCards();
</script>
</body>
</html>`;

// ── HTTP 서버 ─────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    // ── GET / ───────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }

    // ── GET /api/cards ──────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/api/cards') {
      return sendJson(res, loadCards());
    }

    // ── DELETE /api/cards/:id ───────────────────────────────────────
    const delMatch = req.url?.match(/^\/api\/cards\/([^/?]+)$/);
    if (req.method === 'DELETE' && delMatch) {
      const id = decodeURIComponent(delMatch[1]);
      // 경로 순회 방지
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        return sendErr(res, '잘못된 ID', 400);
      }
      const filePath = join(PROMPTS_DIR, `${id}.json`);
      if (!existsSync(filePath)) return sendErr(res, '파일 없음', 404);
      unlinkSync(filePath);
      return sendJson(res, { ok: true });
    }

    // ── POST /api/import/parse ──────────────────────────────────────
    if (req.method === 'POST' && req.url === '/api/import/parse') {
      const body = JSON.parse(await readBody(req));
      const convs = parseConversations(body.content, body.filename);
      const existing = new Set(
        existsSync(PROMPTS_DIR)
          ? readdirSync(PROMPTS_DIR).map((f) => f.replace(/\.json$/, ''))
          : []
      );
      const list = convs.map((c, i) => ({
        index: i,
        id: c.id,
        title: c.title,
        date: c.date,
        turns: c.turns,
        exists: existing.has(c.id),
      }));
      return sendJson(res, { list });
    }

    // ── POST /api/import/save ───────────────────────────────────────
    if (req.method === 'POST' && req.url === '/api/import/save') {
      const body = JSON.parse(await readBody(req));
      const { indices, content, filename } = body;
      const convs = parseConversations(content, filename);
      const saved = [];
      for (const idx of indices) {
        if (convs[idx]) {
          saveConversation(convs[idx]);
          saved.push(convs[idx].id);
        }
      }
      return sendJson(res, { saved });
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    console.error('[admin]', e.message);
    sendErr(res, e.message, 500);
  }
});

server.listen(Number(PORT), '127.0.0.1', () => {
  console.log('');
  console.log('  ✦ Prompt Gallery 관리자 도구');
  console.log(`  → http://localhost:${PORT}`);
  console.log('');
  console.log('  카드 삭제 및 대화 가져오기가 가능합니다.');
  console.log('  Ctrl+C 로 종료\n');
});
