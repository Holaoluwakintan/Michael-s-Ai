(() => {
'use strict';
const $ = s => document.querySelector(s);
const LS = { pass: 'mai.pass', chats: 'mai.chats', cur: 'mai.cur', model: 'mai.model', start: 'mai.start', mem: 'mai.memory', enter: 'mai.enter' };
const MEM_LIMIT = 4000;
const CHIPS = [
  ['FB post', 'Write a Facebook post about '],
  ['Reel caption', 'Write a Reel caption (with hashtags) for a clip about '],
  ['WhatsApp Channel post', 'Write a WhatsApp Channel post (WhatsApp formatting, single *asterisks*) about '],
  ['Monday letter', 'Write this week\'s Monday letter to my readers: a short inspiring word, one Bible verse quoted exactly, and "God\'s promise for you this week:". Theme: '],
  ['Journal intro', 'Write the opening paragraphs for a journal article on my site about '],
  ['Reply to a reader', 'Write a warm reply, as me, to this message from a reader:\n\n"'],
  ['Reel script', 'Write a 30-second Reel script with a shot-by-shot storyboard and CapCut steps about '],
  ['Image prompt', 'Write a detailed image-generation prompt in my Blossom style for '],
  ['Code / build', 'Help me build: '],
];

let pass = localStorage.getItem(LS.pass) || '';
let chats = load(LS.chats, []);
let curId = localStorage.getItem(LS.cur) || null;
let memory = load(LS.mem, []);
let busy = false;
let bank = null;

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function saveChats() {
  chats.sort((a, b) => b.updated - a.updated);
  if (chats.length > 60) chats.length = 60;
  try { localStorage.setItem(LS.chats, JSON.stringify(chats)); }
  catch { chats.length = Math.max(5, chats.length - 10); localStorage.setItem(LS.chats, JSON.stringify(chats)); }
  if (curId) localStorage.setItem(LS.cur, curId); else localStorage.removeItem(LS.cur);
}
function cur() { return chats.find(c => c.id === curId) || null; }
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 1900); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- markdown (small, safe) ---------- */
function inline(t) {
  t = esc(t);
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,!?;:'"])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(>])\*([^*\s][^*\n]*?)\*(?=[\s).,!?:;<]|$)/g, '$1<strong>$2</strong>');
  t = t.replace(/(^|[\s(>])_([^_\s][^_\n]*?)_(?=[\s).,!?:;<]|$)/g, '$1<em>$2</em>');
  t = t.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
  return t;
}
function md(src) {
  const out = []; const lines = String(src).replace(/\r/g, '').split('\n');
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      flush(); const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue;
    }
    if (/^\s*([-*•])\s+/.test(l)) {
      flush(); const items = [];
      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      out.push('<ul>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      flush(); const items = []; const start = parseInt(l, 10) || 1;
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(`<ol start="${start}">` + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>'); continue;
    }
    const h = l.match(/^\s*#{1,6}\s+(.*)/);
    if (h) { flush(); out.push('<h3>' + inline(h[1]) + '</h3>'); i++; continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return out.join('');
}

/* ---------- gate ---------- */
async function checkPass(p) {
  try {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'x-passcode': p } });
    return r.ok ? 'ok' : (r.status === 401 ? 'bad' : 'err');
  } catch { return 'offline'; }
}
function boot() {
  if (pass) { showApp(); checkPass(pass).then(s => { if (s === 'bad') lock(); }); }
  else showGate();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
function showGate() { $('#gate').hidden = false; $('#app').hidden = true; setTimeout(() => $('#gateInput').focus(), 50); }
function showApp() { $('#gate').hidden = true; $('#app').hidden = false; show('chat'); renderChat(); }
function lock() { pass = ''; localStorage.removeItem(LS.pass); closeDrawer(); showGate(); }
$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const p = $('#gateInput').value.trim(); if (!p) return;
  $('#gateErr').textContent = 'Checking…';
  const s = await checkPass(p);
  if (s === 'ok') { pass = p; localStorage.setItem(LS.pass, p); $('#gateErr').textContent = ''; $('#gateInput').value = ''; showApp(); }
  else $('#gateErr').textContent = s === 'bad' ? 'Wrong passcode.' : 'No connection. Try again.';
});

/* ---------- screens ---------- */
function show(name) {
  ['chat', 'memory', 'bank'].forEach(n => $('#' + n + 'View').hidden = n !== name);
  if (name === 'memory') paintMemory();
  if (name === 'bank') showBank();
  if (name !== 'chat') history.pushState({ s: name }, '');
}
window.addEventListener('popstate', () => { if ($('#chatView').hidden) { ['memory', 'bank'].forEach(n => $('#' + n + 'View').hidden = true); $('#chatView').hidden = false; } });
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.length > 1 ? history.back() : show('chat')));

/* ---------- drawer ---------- */
function openDrawer() { paintHistory(); $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; }
$('#menuBtn').addEventListener('click', openDrawer);
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$('#lockBtn').addEventListener('click', lock);
$('#mNew').addEventListener('click', newChat);
$('#mMemory').addEventListener('click', () => { closeDrawer(); show('memory'); });
$('#mBank').addEventListener('click', () => { closeDrawer(); show('bank'); });
$('#modelSel').value = localStorage.getItem(LS.model) || 'flash';
$('#modelSel').addEventListener('change', e => localStorage.setItem(LS.model, e.target.value));
$('#enterSends').checked = localStorage.getItem(LS.enter) !== '0';
$('#enterSends').addEventListener('change', e => localStorage.setItem(LS.enter, e.target.checked ? '1' : '0'));

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
function paintHistory() {
  const ul = $('#histList'); ul.innerHTML = '';
  if (!chats.length) { ul.innerHTML = '<li class="muted small" style="padding:8px 6px">No chats yet.</li>'; return; }
  chats.forEach(c => {
    const li = document.createElement('li'); if (c.id === curId) li.className = 'cur';
    li.innerHTML = `<button class="open">${esc(c.title || 'Chat')}<span class="when">${esc(when(c.updated))}</span></button><button class="del" aria-label="Delete chat">&times;</button>`;
    li.querySelector('.open').addEventListener('click', () => { curId = c.id; saveChats(); renderChat(); closeDrawer(); show('chat'); });
    li.querySelector('.del').addEventListener('click', () => {
      if (!confirm('Delete this chat?')) return;
      chats = chats.filter(x => x.id !== c.id); if (curId === c.id) curId = null; saveChats(); paintHistory(); renderChat();
    });
    ul.appendChild(li);
  });
}

/* ---------- memory ---------- */
function saveMemory() { localStorage.setItem(LS.mem, JSON.stringify(memory)); }
function memChars() { return memory.reduce((n, m) => n + m.text.length + 3, 0); }
function addMemory(text) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (memory.some(m => m.text.toLowerCase() === text.toLowerCase())) return true;
  if (memChars() + text.length + 3 > MEM_LIMIT) { toast('Memory is full. Delete or shorten a note first.'); return false; }
  memory.push({ id: uid(), text, at: Date.now() }); saveMemory(); return true;
}
// "remember that …", "remember: …", "please remember …", "don't forget that …", "note that …"
function rememberCmd(text) {
  const m = text.match(/^\s*(?:hey[,\s]+)?(?:please[,\s]+)?(?:remember|don'?t forget|do not forget|note|keep in mind|take note)(?:\s+(?:that|this))?\s*[,:\-–]?\s+([\s\S]{3,})$/i);
  if (!m) return null;
  if (/^(when|how|what|who|where|the time)\b/i.test(m[1])) return null; // "remember when…" is a question
  let fact = m[1].trim().replace(/^to\s+/i, '').replace(/[\s.!]+$/, '');
  if (!fact) return null;
  return fact.charAt(0).toUpperCase() + fact.slice(1);
}
function paintMemory() {
  const ul = $('#memList'); ul.innerHTML = '';
  $('#memCount').textContent = memory.length;
  const used = memChars();
  $('#memBar').style.width = Math.min(100, used / MEM_LIMIT * 100) + '%';
  $('#memUsage').textContent = `${used} of ${MEM_LIMIT} characters used`;
  if (!memory.length) { ul.innerHTML = '<li class="empty">Nothing yet. Teach me something about you.</li>'; return; }
  memory.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="txt"></div><div class="ctl"><span>${esc(new Date(m.at || Date.now()).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}</span><span><button class="ed">Edit</button><button class="rm">Delete</button></span></div>`;
    li.querySelector('.txt').textContent = m.text;
    li.querySelector('.rm').addEventListener('click', () => { if (!confirm('Delete this memory?')) return; memory = memory.filter(x => x.id !== m.id); saveMemory(); paintMemory(); });
    li.querySelector('.ed').addEventListener('click', () => {
      const ta = document.createElement('textarea'); ta.value = m.text; ta.rows = 3; ta.style.width = '100%';
      li.querySelector('.txt').replaceWith(ta); ta.focus();
      const b = li.querySelector('.ed'); b.textContent = 'Save';
      b.onclick = () => { const v = ta.value.replace(/\s+/g, ' ').trim(); if (v) { m.text = v; m.at = Date.now(); saveMemory(); } else memory = memory.filter(x => x.id !== m.id), saveMemory(); paintMemory(); toast('Memory updated'); };
    });
    ul.appendChild(li);
  });
}
$('#memForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#memInput').value;
  if (addMemory(v)) { $('#memInput').value = ''; paintMemory(); toast('Saved to memory'); }
});
$('#memExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'Michael AI', exported: new Date().toISOString(), memory }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'michael-ai-memory.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#memImportBtn').addEventListener('click', () => $('#memImport').click());
$('#memImport').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const list = Array.isArray(j) ? j : j.memory;
    let n = 0;
    (list || []).forEach(x => { const t = typeof x === 'string' ? x : x && x.text; if (t && addMemory(t)) n++; });
    paintMemory(); toast(`Imported ${n} notes`);
  } catch { toast('That file is not a Michael AI memory file'); }
  e.target.value = '';
});

/* ---------- chat ---------- */
const msgsEl = $('#msgs'), input = $('#input');
CHIPS.forEach(([label, text]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
  b.addEventListener('click', () => { input.value = text; grow(); input.focus(); input.setSelectionRange(text.length, text.length); toggleTools(false); });
  $('#chips').appendChild(b);
});
function toggleTools(on) {
  const t = $('#tools'); on = on ?? t.hidden; t.hidden = !on; $('#toolsBtn').setAttribute('aria-expanded', String(on));
}
$('#toolsBtn').addEventListener('click', () => toggleTools());

function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
input.addEventListener('input', grow);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && $('#enterSends').checked) { e.preventDefault(); $('#composer').requestSubmit(); }
});

const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function timeStr(ts) { return ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }
function dayLabel(ts) {
  const d = new Date(ts), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

function bubble(m, prevRole) {
  const el = document.createElement('div');
  el.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai') + (prevRole !== m.role ? ' first' : '');
  el._m = m;
  let h = '';
  if (m.note) h += `<div class="note">${esc(m.note)}</div>`;
  h += `<div class="content">${m.role === 'user' ? esc(m.text) : md(m.text)}</div>`;
  if (m.src && m.src.length) h += '<div class="sources">' + m.src.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('') + '</div>';
  h += '<span class="meta">';
  if (m.role !== 'user') h += `<button class="mini cp" aria-label="Copy">${ICON_COPY}</button><button class="mini sh" aria-label="Share">${ICON_SHARE}</button>`;
  h += `<span>${esc(timeStr(m.ts))}</span>`;
  if (m.role === 'user') h += '<span class="ticks">✓✓</span>';
  h += '</span><div class="clear"></div>';
  el.innerHTML = h;
  wireBubble(el);
  return el;
}
function wireBubble(el) {
  const cp = el.querySelector('.cp'), sh = el.querySelector('.sh');
  if (cp) cp.addEventListener('click', async () => { await copyText(el._m.text); toast('Copied'); });
  if (sh) sh.addEventListener('click', () => share(el._m.text));
  let t = null, sx = 0, sy = 0;
  const start = e => { const p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; t = setTimeout(() => { t = null; el.classList.add('pressed'); openSheet(el); }, 480); };
  const cancel = () => { if (t) clearTimeout(t); t = null; };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', e => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) + Math.abs(p.clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
  el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); el.classList.add('pressed'); openSheet(el); });
}
let sheetEl = null;
function openSheet(el) { sheetEl = el; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; if (sheetEl) sheetEl.classList.remove('pressed'); sheetEl = null; }
document.querySelectorAll('#sheet [data-close]').forEach(b => b.addEventListener('click', closeSheet));
$('#sCopy').addEventListener('click', async () => { await copyText(sheetEl._m.text); closeSheet(); toast('Copied'); });
$('#sShare').addEventListener('click', () => { const t = sheetEl._m.text; closeSheet(); share(t); });
$('#sWa').addEventListener('click', () => { const t = sheetEl._m.text; closeSheet(); window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank'); });
$('#sMem').addEventListener('click', () => { const t = sheetEl._m.text; closeSheet(); if (addMemory(t.slice(0, 600))) toast('Saved to memory'); });

async function share(text) {
  if (navigator.share) { try { await navigator.share({ text }); } catch {} }
  else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
}

function intro() {
  const f = document.createDocumentFragment();
  const d = document.createElement('div'); d.className = 'day'; d.textContent = 'Today'; f.appendChild(d);
  const n = document.createElement('div'); n.className = 'notice';
  n.textContent = '🔒 Private to you. Ask me anything. To teach me, type "remember that …". Tap ✨ for post-writing tools.';
  f.appendChild(n);
  const b = bubble({ role: 'model', text: 'Hi Michael 👋 What can I help you with?', ts: Date.now() }, null);
  b.querySelector('.meta .cp')?.remove(); b.querySelector('.meta .sh')?.remove();
  f.appendChild(b);
  return f;
}
function renderChat() {
  const c = cur();
  msgsEl.innerHTML = '';
  if (!c || !c.messages.length) { msgsEl.appendChild(intro()); return; }
  let prev = null, lastDay = '';
  c.messages.forEach(m => {
    const dl = dayLabel(m.ts || c.updated);
    if (dl !== lastDay) { const d = document.createElement('div'); d.className = 'day'; d.textContent = dl; msgsEl.appendChild(d); lastDay = dl; prev = null; }
    msgsEl.appendChild(bubble(m, prev));
    if (m.saved) msgsEl.appendChild(savedNote(m.saved));
    prev = m.role === 'user' ? 'user' : 'model';
  });
  scrollEnd();
}
function savedNote(text) {
  const s = document.createElement('div'); s.className = 'saved';
  s.textContent = '🧠 Saved to memory'; s.title = text; return s;
}
function scrollEnd() { msgsEl.scrollTop = msgsEl.scrollHeight; }
function setStatus(typing) { const s = $('#status'); s.textContent = typing ? 'typing…' : 'online'; s.classList.toggle('typing', !!typing); }
function newChat() { curId = null; saveChats(); renderChat(); closeDrawer(); show('chat'); input.focus(); }
$('#newBtn').addEventListener('click', newChat);

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || busy) return;
  let c = cur();
  if (!c) { c = { id: uid(), title: text.slice(0, 60), updated: Date.now(), messages: [] }; chats.unshift(c); curId = c.id; msgsEl.innerHTML = ''; const d = document.createElement('div'); d.className = 'day'; d.textContent = 'Today'; msgsEl.appendChild(d); }
  const prev = c.messages.length ? (c.messages[c.messages.length - 1].role === 'user' ? 'user' : 'model') : null;
  const um = { role: 'user', text, ts: Date.now() };
  const fact = rememberCmd(text);
  if (fact && addMemory(fact)) um.saved = fact;
  c.messages.push(um); c.updated = Date.now(); saveChats();
  input.value = ''; grow(); toggleTools(false);
  msgsEl.appendChild(bubble(um, prev));
  if (um.saved) msgsEl.appendChild(savedNote(um.saved));
  scrollEnd();
  await ask(c);
});

async function ask(c) {
  busy = true; $('#sendBtn').disabled = true; setStatus(true);
  const am = { role: 'model', text: '', ts: Date.now() };
  const el = document.createElement('div'); el.className = 'msg ai first';
  el.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msgsEl.appendChild(el); scrollEnd();
  let failed = '';
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-passcode': pass },
      body: JSON.stringify({ messages: c.messages.map(m => ({ role: m.role, text: m.text })), model: $('#modelSel').value, memory: memory.map(m => m.text) }),
    });
    if (r.status === 401) { el.remove(); busy = false; $('#sendBtn').disabled = false; setStatus(false); lock(); return; }
    if (!r.body) throw new Error('no body');
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    let paintQ = false, ended = false;
    const paint = () => {
      if (paintQ) return; paintQ = true;
      requestAnimationFrame(() => {
        paintQ = false;
        const nearEnd = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
        el.innerHTML = (am.note ? `<div class="note">${esc(am.note)}</div>` : '') + `<div class="content cursor">${md(am.text)}</div>`;
        if (nearEnd) scrollEnd();
      });
    };
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.t === 'meta') { am.model = o.model; if (o.note) am.note = o.note; }
        else if (o.t === 'd') { am.text += o.v; paint(); }
        else if (o.t === 'src') am.src = o.v;
        else if (o.t === 'fin' && o.v === 'MAX_TOKENS') am.text += '\n\n_(cut off: answer was too long. Say "continue".)_';
        else if (o.t === 'err') failed = o.v;
        else if (o.t === 'end') ended = true;
      }
    }
    if (!ended && am.text.trim() && !failed) failed = 'The answer was cut off. Say "continue" or try again.';
  } catch { failed = failed || 'No connection. Check your data and try again.'; }
  if (!am.text.trim()) {
    el.innerHTML = `<div class="content">${esc(failed || 'No answer came back. Try again.')}</div>`;
    const rb = document.createElement('button'); rb.className = 'retry'; rb.textContent = 'Try again';
    rb.addEventListener('click', () => { el.remove(); ask(c); });
    el.appendChild(rb);
  } else {
    if (failed) am.text += `\n\n_(${failed})_`;
    c.messages.push(am); c.updated = Date.now(); saveChats();
    const nb = bubble(am, 'user'); el.replaceWith(nb);
  }
  busy = false; $('#sendBtn').disabled = false; setStatus(false); scrollEnd();
}

/* ---------- content bank ---------- */
const DAY = 86400000;
function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startDay() { let s = +localStorage.getItem(LS.start); if (!s) { s = today0(); localStorage.setItem(LS.start, s); } return s; }
function realDay() { return Math.floor((today0() - startDay()) / DAY) + 1; }
let viewDay = null;
function act(label, fn) { const b = document.createElement('button'); b.className = 'act'; b.textContent = label; b.addEventListener('click', fn); return b; }
async function showBank() {
  if (!bank) {
    $('#bankList').innerHTML = '<p class="muted">Loading…</p>';
    try { bank = await (await fetch('/bank.json')).json(); } catch { $('#bankList').innerHTML = '<p class="err">Could not load the bank. Check your data.</p>'; return; }
  }
  if (viewDay == null) viewDay = realDay();
  paintBank();
}
function paintBank() {
  const max = Math.max(...bank.map(p => p.day));
  const rd = realDay();
  const d = ((Math.max(1, viewDay) - 1) % max) + 1;
  $('#dayNum').textContent = d; $('#dayInput').value = d;
  $('#dayNote').textContent = viewDay === rd ? (rd > max ? `You're past day ${max}, so the bank is going round again.` : 'Today\'s 2 posts. Times are Lagos time.') : `Previewing day ${d}. Your today is day ${((rd - 1) % max) + 1}.`;
  const list = $('#bankList'); list.innerHTML = '';
  bank.filter(p => p.day === d).forEach(p => {
    const full = p.caption + (p.hashtags ? '\n\n' + p.hashtags : '');
    const card = document.createElement('article'); card.className = 'post';
    card.innerHTML = `<div class="post-meta"><span class="tag rose">${esc(p.slot)} · ${esc(p.time_lagos)}</span><span class="tag">${esc(p.pillar)}</span><span class="tag">${esc(p.platform)} · ${esc(p.format)}</span></div>
      <div class="cap">${esc(full)}</div>
      <div class="asset">Attach: <strong>${esc(p.asset)}</strong></div><div class="actions"></div>`;
    const a = card.querySelector('.actions');
    a.appendChild(act('Copy', async () => { await copyText(full); toast('Copied'); }));
    a.appendChild(act('Share', () => share(full)));
    a.appendChild(act('Copy asset name', async () => { await copyText(p.asset.split('›').pop().trim()); toast('Asset name copied'); }));
    list.appendChild(card);
  });
}
$('#dayPrev').addEventListener('click', () => { viewDay = Math.max(1, viewDay - 1); paintBank(); });
$('#dayNext').addEventListener('click', () => { viewDay = viewDay + 1; paintBank(); });
$('#dayInput').addEventListener('change', e => { const v = parseInt(e.target.value, 10); if (v >= 1) { viewDay = v; paintBank(); } });
$('#daySet').addEventListener('click', () => {
  const v = parseInt($('#dayInput').value, 10) || 1;
  localStorage.setItem(LS.start, today0() - (v - 1) * DAY); viewDay = v; paintBank(); toast(`Today is now day ${v}`);
});

boot();
})();
