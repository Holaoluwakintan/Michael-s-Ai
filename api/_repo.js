// v7: WORK ON HIS GITHUB REPOS. "repo <name> <change>": read the repo (smart file selection under the token limits), let Gemini
// make the change, self-check it, and push to a NEW branch mai/<slug>. Never main/master, never force, never an existing branch.
// The token (GITHUB_TOKEN env, Michael's own fine-grained token) can push to his existing repos but can't open PRs, so the reply
// carries GitHub's "compare & pull request" link.
import * as acorn from 'acorn';
import * as S from './_sites.js';

const GH = 'https://api.github.com';
const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const PROTECTED = () => (process.env.REPO_PROTECTED || 'Blossom-website,Blossom-website.').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export const isProtected = name => { const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return PROTECTED().some(p => p.replace(/[^a-z0-9]/g, '') === n); };
export const repoOn = () => Boolean(process.env.GITHUB_TOKEN);
export const READ_BUDGET = 140000;          // chars of file content sent to the model
export const MAX_FILES = 10, MAX_FILE_CHARS = 60000;
export const G_NEED = { g_load: 30e3, g_pick: 50e3, g_read: 30e3, g_code: 200e3, g_check: 3e3, g_fix: 200e3, g_push: 40e3 };
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.vercel|\.git|vendor|coverage|\.cache|public\/assets|android\/app\/build|ios\/Pods)(\/|$)/;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.min\.(js|css)|\.map)$/i;
const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|html?|css|scss|sass|less|md|mdx|txt|yml|yaml|toml|astro|vue|svelte|py|rb|go|rs|java|kt|php|sql|sh|env\.example|xml|svg|gradle|properties|swift|dart|c|h|cpp|graphql|prisma)$|(^|\/)(Dockerfile|Makefile|Procfile|\.gitignore|README|LICENSE)$/i;
export const isTextPath = p => TEXT_EXT.test(p) && !SKIP_DIR.test(p) && !SKIP_FILE.test(p);
const BLOCKED_WRITE = /(^|\/)(\.github\/workflows\/|\.env($|\.)|.*\.(pem|key|p12|keystore|jks)$)/i;

export const REPOS_RE = /^\s*\/?(?:repos|my\s+repos|github\s+repos|list\s+repos|my\s+github)\s*[?.!]*\s*$/i;
export const REPO_RE = /^\s*\/?(?:repo|github)\s+([\w.-]{1,100})(?:\s*[:：,\-–]\s*|\s+)([\s\S]{4,})$/i;
export const REPO_INFO_RE = /^\s*\/?(?:repo|github)\s+([\w.-]{1,100})\s*[?.!]*\s*$/i;

function headers(extra = {}) { return { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'michael-ai-bot', ...extra }; }
export async function gh(path, { method = 'GET', body = null, ms = 15000, raw = false } = {}) {
  const r = await fetch(path.startsWith('http') ? path : GH + path, { method, headers: headers(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  if (raw) return r;
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { message: t.slice(0, 200) }; }
  if (!r.ok) { const e = new Error(`GitHub ${method} ${path.replace(GH, '')}: ${r.status} ${trim(j?.message, 160)}`); e.status = r.status; throw e; }
  return j;
}
export async function me() { return gh('/user'); }
export async function listRepos() {
  const list = await gh('/user/repos?per_page=100&sort=pushed&affiliation=owner');
  return list.map(r => ({ name: r.name, full: r.full_name, private: r.private, desc: r.description || '', lang: r.language || '', pushed: r.pushed_at, branch: r.default_branch, size: r.size, url: r.html_url }));
}
export function findRepo(repos, name) {
  const n = String(name || '').toLowerCase().replace(/\.git$/, '');
  return repos.find(r => r.name.toLowerCase() === n) || repos.find(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === n.replace(/[^a-z0-9]/g, '')) || repos.find(r => r.name.toLowerCase().includes(n) && n.length >= 3) || null;
}
const ago = t => { const d = (Date.now() - Date.parse(t)) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)} days ago`; };
export function reposText(repos) {
  if (!repos.length) return 'No GitHub repos found on your account.';
  const lines = ['🐙 *Your GitHub repos*'];
  repos.slice(0, 15).forEach((r, i) => lines.push(`${i + 1}. *${r.name}*${r.private ? ' 🔒' : ''}${r.lang ? ` · ${r.lang}` : ''} · ${ago(r.pushed)}${isProtected(r.name) ? ' · _hands off (live site)_' : ''}${r.desc ? `\n   _${trim(r.desc, 70)}_` : ''}`));
  lines.push('', 'Change one: *repo voicepad add a dark mode toggle*', 'I push to a new branch *mai/…* and send you the link. I never touch main.');
  return lines.join('\n');
}
export function branchSlug(change) {
  const s = String(change || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(w => !['the', 'a', 'an', 'to', 'and', 'of', 'please', 'pls', 'my', 'in', 'on', 'for', 'it'].includes(w)).slice(0, 6).join('-');
  return (s || 'change').slice(0, 40).replace(/-+$/, '');
}
export function safeBranch(name) { return /^mai\/[a-z0-9][a-z0-9._-]{0,60}$/.test(name) && !/\.\.|\.lock$|\/$/.test(name); }

// ---------- file selection ----------
export function treeList(tree) {
  return (tree || []).filter(x => x.type === 'blob' && isTextPath(x.path) && (x.size || 0) < 400000).map(x => ({ path: x.path, size: x.size || 0 }));
}
export const PICK_SYS = 'You are a senior engineer. Given a repository file list and a change request, you choose the smallest set of files that must be read and edited to make the change well. Output only JSON.';
export function pickPrompt(repo, files, readme, change) {
  const list = files.slice(0, 1500).map(f => `${f.path} (${f.size}b)`).join('\n');
  return `Repository: ${repo.full} (${repo.lang || 'unknown language'})${repo.desc ? ` — ${repo.desc}` : ''}
Change request from the owner: """${change}"""
${readme ? `README (start):\n${trim(readme, 2500)}\n` : ''}
FILES:
${list}

Return JSON: {"read": ["up to ${MAX_FILES} existing paths to read (the files to edit first, then the closest context like the entry file, package.json, related components)"], "create": ["new file paths you plan to add, if any"], "plan": "2-4 sentences: what you'll change and where"}`;
}
export function heuristicPick(files, change) {
  const words = String(change).toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const score = f => { const p = f.path.toLowerCase(); let s = words.reduce((n, w) => n + (p.includes(w) ? 3 : 0), 0); if (/(^|\/)(index|main|app)\.(html|jsx?|tsx?|astro|vue)$/.test(p)) s += 2; if (/^(src\/)?(pages|components|app)\//.test(p)) s += 1; if (/package\.json$/.test(p) && !p.includes('/')) s += 1; if (/\.(md|txt)$/.test(p)) s -= 1; return s; };
  return files.map(f => ({ ...f, s: score(f) })).sort((a, b) => b.s - a.s || a.size - b.size).slice(0, 6).map(f => f.path);
}
export function chooseFiles(files, picked, budget = READ_BUDGET) {
  const byPath = new Map(files.map(f => [f.path, f]));
  const out = []; let used = 0;
  for (const p of picked) {
    const f = byPath.get(String(p).replace(/^\.?\//, ''));
    if (!f || out.includes(f.path) || f.size > MAX_FILE_CHARS) continue;
    if (used + f.size > budget) continue;
    out.push(f.path); used += f.size;
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

// ---------- code ----------
export const CODE_SYS = `You are a careful senior engineer making a focused change to an existing codebase. Match the project's style, language and framework. Change only what the request needs; keep everything else exactly as it was. Never invent secrets, API keys or credentials (use environment variables / placeholders the project already uses). Never edit CI workflows or .env files.
Output format, exactly:
=== FILE: path/of/file ===
(the COMPLETE new content of that file, every line, not a diff)
... one block per changed or new file ...
=== SUMMARY ===
3-6 short bullet lines ("- ...") describing what you changed, for the owner on WhatsApp.`;
export function codePrompt(repo, change, files, plan = '', issues = []) {
  const blocks = Object.entries(files).map(([p, c]) => `=== FILE: ${p} ===\n${c}`).join('\n');
  return `Repository: ${repo.full} (default branch ${repo.branch}, ${repo.lang || 'mixed'})
Change request: """${change}"""
${plan ? `Plan: ${plan}\n` : ''}${issues.length ? `\nYOUR PREVIOUS ATTEMPT FAILED THESE CHECKS; fix them:\n${issues.map(x => '- ' + x).join('\n')}\n` : ''}
CURRENT FILES:
${blocks}

Return only the files you change or add, each in full, then the SUMMARY.`;
}
export function parseChange(text) {
  const t = String(text || '');
  const [filesPart, summary = ''] = t.split(/^\s*={3,}\s*SUMMARY\s*={3,}\s*$/m);
  const files = S.parseFiles(filesPart);
  return { files, summary: summary.trim().split('\n').map(l => l.trim()).filter(l => /^[-•*]/.test(l)).slice(0, 6).join('\n') };
}

// ---------- self-check ----------
function jsCheck(code, path) {
  if (/\.(ts|tsx|jsx)$/.test(path)) return [];          // acorn can't parse TS/JSX; GitHub/Vercel CI will
  for (const sourceType of ['module', 'script']) { try { acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: sourceType === 'script' }); return []; } catch (e) { if (sourceType === 'script') return [`${path}: JavaScript syntax error: ${e.message}`]; } }
  return [];
}
export function checkChange(changed, original) {
  const issues = [];
  for (const [p, c] of Object.entries(changed)) {
    if (BLOCKED_WRITE.test(p)) { issues.push(`${p}: not allowed to edit this file (CI/secrets)`); continue; }
    if (/\.(js|mjs|cjs|jsx|ts|tsx)$/.test(p)) issues.push(...jsCheck(c, p));
    if (/\.json$/.test(p)) { try { JSON.parse(c); } catch (e) { issues.push(`${p}: invalid JSON (${e.message})`); } }
    if (/\.html?$/.test(p)) for (const [tag, n] of S.tagBalance(c)) if (['html', 'body', 'head', 'script', 'style', 'main'].includes(tag)) issues.push(`${p}: unbalanced <${tag}> (${n})`);
    if (/\.(css|scss)$/.test(p)) { let d = 0; for (const ch of c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '')) { if (ch === '{') d++; else if (ch === '}') d--; } if (d !== 0) issues.push(`${p}: unbalanced { } braces`); }
    const old = original[p];
    if (old && old.length > 800 && c.length < old.length * 0.4) issues.push(`${p}: the new version is much shorter than the old one (${c.length} vs ${old.length} chars): return the COMPLETE file, not a fragment`);
    if (/\.\.\.\s*(rest of|existing|unchanged|same as before)|\/\/\s*\.\.\.\s*(existing|rest)|<!--\s*\.\.\.\s*-->/i.test(c)) issues.push(`${p}: contains an elision like "... rest of the code": write the full file`);
    if (/(sk_live_|sk_test_|ghp_[A-Za-z0-9]{20}|github_pat_|AIza[0-9A-Za-z_-]{30}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(c) && !(old && /(sk_live_|sk_test_|ghp_|github_pat_|AIza|PRIVATE KEY)/.test(old))) issues.push(`${p}: looks like it contains a secret key: remove it`);
  }
  if (!Object.keys(changed).length) issues.push('no files were returned');
  return issues;
}
// +added / -removed line counts (multiset diff: cheap and close enough for a summary)
export function lineDiff(oldT, newT) {
  const a = String(oldT || '').split('\n'), b = String(newT || '').split('\n');
  const m = new Map(); for (const l of a) m.set(l, (m.get(l) || 0) + 1);
  let same = 0; for (const l of b) { const n = m.get(l) || 0; if (n > 0) { m.set(l, n - 1); same++; } }
  return { added: b.length - same, removed: oldT == null ? 0 : a.length - same };
}
export function diffSummary(changed, original) {
  return Object.entries(changed).map(([p, c]) => { const d = lineDiff(original[p], c); return { path: p, ...d, isNew: original[p] == null }; });
}

// ---------- push (Git Data API: blobs -> tree on the base commit -> commit -> NEW ref) ----------
export async function pushBranch(repo, baseSha, changed, branch, message) {
  if (!safeBranch(branch)) throw new Error('refusing branch name ' + branch);
  const full = repo.full;
  const base = await gh(`/repos/${full}/git/commits/${baseSha}`);
  const tree = [];
  for (const [path, content] of Object.entries(changed)) {
    if (BLOCKED_WRITE.test(path)) throw new Error('refusing to write ' + path);
    const b = await gh(`/repos/${full}/git/blobs`, { method: 'POST', body: { content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' } });
    tree.push({ path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const t = await gh(`/repos/${full}/git/trees`, { method: 'POST', body: { base_tree: base.tree.sha, tree } });
  const c = await gh(`/repos/${full}/git/commits`, { method: 'POST', body: { message, tree: t.sha, parents: [baseSha] } });
  let name = branch;
  for (let i = 2; i < 20; i++) {
    try {
      await gh(`/repos/${full}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name}`, sha: c.sha } });   // create only; never PATCH an existing ref
      return { branch: name, commit: c.sha };
    } catch (e) { if (e.status !== 422) throw e; name = `${branch}-${i}`; if (!safeBranch(name)) throw e; }
  }
  throw new Error('could not find a free branch name');
}
export async function deleteBranch(full, branch) {
  if (!safeBranch(branch)) throw new Error('only mai/ branches can be deleted here');
  const r = await gh(`/repos/${full}/git/refs/heads/${branch}`, { method: 'DELETE', raw: true });
  return r.status;
}
export function compareUrl(repo, branch) { return `https://github.com/${repo.full}/compare/${repo.branch}...${branch.split('/').map(encodeURIComponent).join('/')}?expand=1`; }
export function doneText(repo, branch, diffs, summary, { tests = '', warn = '' } = {}) {
  const tot = diffs.reduce((n, d) => ({ a: n.a + d.added, r: n.r + d.removed }), { a: 0, r: 0 });
  const lines = [`✅ *${repo.name}*: change pushed to branch *${branch}* (main untouched)`, '', summary || '', '', `📁 ${diffs.length} file${diffs.length === 1 ? '' : 's'} · +${tot.a} −${tot.r} lines`,
    ...diffs.slice(0, 8).map(d => `• ${d.path}${d.isNew ? ' (new)' : ''}: +${d.added} −${d.removed}`), '',
    `🔀 Review & merge (tap *Create pull request*):\n${compareUrl(repo, branch)}`, `🌿 Branch: https://github.com/${repo.full}/tree/${branch}`];
  if (tests) lines.push('', tests);
  if (warn) lines.push('', `_${warn}_`);
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

// ---------- one phase of a repo job ----------
export async function phase(st, h) {
  const { step, deadline } = h;
  if (st.phase === 'g_load') {
    if (!repoOn()) { st.phase = 'fail'; st.error = 'GitHub isn\'t connected to the bot yet'; return; }
    const repos = await listRepos();
    const repo = findRepo(repos, st.repoName);
    if (!repo) { st.phase = 'fail'; st.error = `I can't find a repo called "${st.repoName}" (send *repos* to see them)`; return; }
    if (isProtected(repo.name)) { st.phase = 'fail'; st.error = `${repo.name} runs your live site, so I keep my hands off it`; return; }
    const ref = await gh(`/repos/${repo.full}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
    const tr = await gh(`/repos/${repo.full}/git/trees/${ref.object.sha}?recursive=1`, { ms: 25000 });
    st.repo = repo; st.baseSha = ref.object.sha;
    st.files = treeList(tr.tree);
    st.truncatedTree = !!tr.truncated;
    let readme = '';
    const rm = st.files.find(f => /^readme\.md$/i.test(f.path));
    if (rm) { try { readme = await rawFile(repo.full, rm.path, st.baseSha); } catch {} }
    st.readme = trim(readme, 3000);
    st.tests = st.files.some(f => /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.(js|ts|mjs|jsx|tsx)$/.test(f.path));
    step(`repo ${repo.full}@${repo.branch} ${st.baseSha.slice(0, 7)}: ${st.files.length} text files${st.truncatedTree ? ' (tree truncated)' : ''}${st.tests ? ', has tests' : ''}`);
    if (!st.files.length) { st.phase = 'fail'; st.error = 'that repo has no code files I can edit'; return; }
    st.phase = 'g_pick';
    return;
  }
  if (st.phase === 'g_pick') {
    let picked = [], plan = '', create = [];
    if (st.files.length <= 6 && st.files.reduce((n, f) => n + f.size, 0) < READ_BUDGET) picked = st.files.map(f => f.path);
    else {
      const r = await S.gem(pickPrompt(st.repo, st.files, st.readme, st.change), { system: PICK_SYS, json: true, maxTokens: 2048, chain: S.PLAN_CHAIN, cool: st.cool, timeoutMs: 45000, deadline });
      const j = r.ok ? S.parseJson(r.text) : null;
      picked = Array.isArray(j?.read) ? j.read : [];
      plan = String(j?.plan || ''); create = Array.isArray(j?.create) ? j.create.map(String).slice(0, 5) : [];
      step(`pick: ${r.ok ? r.model : 'heuristic'} chose ${picked.length} files`);
    }
    st.read = chooseFiles(st.files, picked.length ? picked : heuristicPick(st.files, st.change));
    if (!st.read.length) st.read = chooseFiles(st.files, heuristicPick(st.files, st.change));
    st.plan = plan; st.create = create;
    step(`reading: ${st.read.join(', ')}`);
    st.phase = 'g_read';
    return;
  }
  if (st.phase === 'g_read') {
    st.orig = {};
    const got = await Promise.all(st.read.map(p => rawFile(st.repo.full, p, st.baseSha).then(t => [p, t]).catch(() => [p, null])));
    for (const [p, t] of got) if (t != null) st.orig[p] = t;
    step(`read ${Object.keys(st.orig).length} files (${Math.round(Object.values(st.orig).join('').length / 1000)}k chars)`);
    st.phase = 'g_code';
    await h.update(`🐙 Reading *${st.repo.name}* (${Object.keys(st.orig).length} files). Making the change now, 2–4 min ⏳`);
    return;
  }
  if (st.phase === 'g_code' || st.phase === 'g_fix') {
    const r = await S.gem(codePrompt(st.repo, st.change, st.orig, st.plan, st.phase === 'g_fix' ? st.issues : []), { system: CODE_SYS, maxTokens: 32000, chain: S.CODE_CHAIN, cool: st.cool, timeoutMs: 170000, deadline, temperature: 0.3 });
    st.codeTries = (st.codeTries || 0) + 1;
    const out = r.ok ? parseChange(r.text) : { files: {} };
    // drop files identical to the original
    for (const [p, c] of Object.entries(out.files)) if (st.orig[p] != null && st.orig[p].replace(/\s+$/, '') === c.replace(/\s+$/, '')) delete out.files[p];
    if (!Object.keys(out.files).length) {
      step(`code: no changed files (${r.ok ? 'finish ' + r.finish : r.tried?.join(' ')}) try ${st.codeTries}`);
      if (st.codeTries >= 3) { st.phase = 'fail'; st.error = r.quota ? 'today\'s free AI quota is used up' : 'the AI didn\'t produce a usable change'; }
      return;
    }
    st.changed = out.files; st.summary = out.summary || st.summary || '';
    step(`code: ${r.model} changed ${Object.keys(out.files).join(', ')}`);
    st.phase = 'g_check';
    return;
  }
  if (st.phase === 'g_check') {
    st.issues = checkChange(st.changed, st.orig);
    step(`check: ${st.issues.length ? st.issues.join(' | ').slice(0, 400) : 'clean'}`);
    if (st.issues.length && (st.fixes || 0) < 1) { st.fixes = (st.fixes || 0) + 1; st.phase = 'g_fix'; return; }
    if (st.issues.some(x => /not allowed|secret|syntax error|invalid JSON|COMPLETE file|elision/.test(x))) { st.phase = 'fail'; st.error = 'my change didn\'t pass its own checks (' + trim(st.issues[0], 120) + '), so I pushed nothing'; return; }
    st.phase = 'g_push';
    return;
  }
  if (st.phase === 'g_push') {
    const msg = `${trim(st.change.replace(/\s+/g, ' '), 68)}\n\nMade by Michael AI from WhatsApp.\n${st.summary || ''}`.trim();
    const res = await pushBranch(st.repo, st.baseSha, st.changed, `mai/${branchSlug(st.change)}`, msg);
    st.branch = res.branch; st.commit = res.commit;
    const diffs = diffSummary(st.changed, st.orig);
    step(`pushed ${res.branch} ${res.commit.slice(0, 7)} (${diffs.map(d => `${d.path} +${d.added}/-${d.removed}`).join(', ')})`);
    const tests = st.tests ? '🧪 The repo has tests. I checked syntax only (I can\'t run npm here), so run the tests before merging.' : '';
    const warn = st.issues?.length ? 'My checker still flagged: ' + trim(st.issues.join('; '), 160) : '';
    await h.finish(doneText(st.repo, res.branch, diffs, st.summary, { tests, warn }), { repo: st.repo.full, branch: res.branch, commit: res.commit, compare: compareUrl(st.repo, res.branch), files: diffs });
    delete st.orig; delete st.changed; delete st.files; delete st.readme;
    return;
  }
}
export async function rawFile(full, path, ref) {
  const r = await gh(`/repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, { raw: true, ms: 15000 });
  if (!r.ok) throw new Error(`read ${path}: ${r.status}`);
  const j = await r.json();
  if (j.encoding === 'base64' && j.content != null) return Buffer.from(j.content, 'base64').toString('utf8');
  if (j.download_url) { const d = await fetch(j.download_url, { headers: headers(), signal: AbortSignal.timeout(15000) }); return d.text(); }
  throw new Error('read ' + path + ': no content');
}
