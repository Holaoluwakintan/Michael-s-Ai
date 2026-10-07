// v7: LONG RESEARCH ("research <topic>"). A multi-tick job: plan -> many keyless searches -> read up to 14 pages -> write a
// structured report with numbered sources -> WhatsApp summary + a PDF report. Far more searching/reading than the 12-step agent loop.
import * as S from './_sites.js';

const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const MAX_QUERIES = 10, MAX_READ = 14, PAGE_CHARS = 6000, NOTES_CHARS = 70000;
export const R_NEED = { r_plan: 50e3, r_search: 40e3, r_read: 45e3, r_write: 200e3, r_deliver: 40e3 };
const JUNK = /(?:facebook|instagram|tiktok|pinterest|x|twitter|youtube|linkedin)\.com|\.pdf(?:$|\?)/i;

export const RESEARCH_RE = /^\s*\/?(?:research|deep\s*research|research\s+report|investigate|study)\s*(?:[:：\-–]\s*|\s+(?:on|about|into)\s+|\s+)([\s\S]{4,})$/i;
export function detectResearch(text) {
  const m = String(text || '').match(RESEARCH_RE);
  if (!m) return null;
  let topic = m[1].trim(); let pdf = true;
  if (/\b(no pdf|without (?:a )?pdf|just text)\b/i.test(topic)) { pdf = false; topic = topic.replace(/[,;]?\s*\b(no pdf|without (?:a )?pdf|just text)\b/i, '').trim(); }
  topic = topic.replace(/[,;]?\s*\b(?:as|with|and send)\s+(?:a\s+)?(?:pdf|document|report)\b\.?$/i, '').trim();
  topic = topic.replace(/[,;]?\s*\(?\b(?:pdf|in pdf|\+\s*pdf|pdf report|pdf please)\b\)?\s*[.!]?$/i, '').trim();
  return topic.length >= 4 ? { topic, pdf } : null;
}

export const PLAN_SYS = 'You are a meticulous research lead. You break a topic into the questions that matter and the web searches that will answer them. Output only JSON.';
export function planPrompt(topic, today = new Date().toISOString().slice(0, 10)) {
  return `Research topic from Michael (a Nigerian creator, author and developer): """${topic}"""
Today: ${today}. Unless the topic says otherwise, include the Nigerian angle where it matters.
Return JSON: {"title": "report title (max 70 chars)", "questions": ["5-7 key questions the report must answer"], "queries": ["8-10 distinct web search queries (short, specific, different angles: facts, latest news ${today.slice(0, 4)}, numbers/prices, how-to, comparisons, expert/official sources, Nigeria-specific)"]}`;
}
export function cleanResearchPlan(j, topic) {
  const t = String(topic).slice(0, 120);
  const q = (Array.isArray(j?.queries) ? j.queries : []).map(x => String(x).trim()).filter(Boolean);
  const base = [t, `${t} ${new Date().getFullYear()}`, `${t} Nigeria`, `${t} latest news`, `${t} statistics`, `${t} guide`, `${t} pros and cons`, `best ${t}`];
  const queries = [...new Set([...q, ...base].map(x => x.slice(0, 140)))].slice(0, MAX_QUERIES);
  return { title: trim(j?.title || t.replace(/\b\w/g, c => c.toUpperCase()), 80), questions: (Array.isArray(j?.questions) ? j.questions : []).map(String).slice(0, 7), queries };
}
// rank candidates: relevance to the topic words, one or two per domain, skip social/PDF links
export function pickPages(cands, topic, n = MAX_READ) {
  const words = String(topic).toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const scored = cands.filter(c => /^https?:\/\//.test(c.url) && !JUNK.test(c.url)).map(c => {
    const text = `${c.title} ${c.snippet}`.toLowerCase();
    return { ...c, host: host(c.url), score: words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0) + (c.rank === 0 ? 1.5 : c.rank === 1 ? 0.8 : 0) + (/\.(gov|edu)(\.|$)|\.gov\.ng|wikipedia\.org/.test(c.url) ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const perHost = {}, out = [];
  for (const c of scored) { if ((perHost[c.host] || 0) >= 2) continue; perHost[c.host] = (perHost[c.host] || 0) + 1; out.push(c); if (out.length >= n) break; }
  return out;
}
export const WRITE_SYS = 'You are an expert analyst who writes clear, accurate, well-structured research reports from web sources. You never invent facts, numbers or links: everything comes from the numbered sources, cited like [3]. If sources disagree or are thin, you say so.';
export function writePrompt(plan, topic, sources, today = new Date().toISOString().slice(0, 10)) {
  const src = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`).join('\n\n---\n\n');
  return `Topic: """${topic}"""   Today: ${today}
Questions to answer:\n${plan.questions.map((q, i) => `${i + 1}. ${q}`).join('\n') || '(cover the topic fully)'}

SOURCES (numbered; cite them like [2] after each fact):
${src}

Write TWO parts, exactly in this format:
===WHATSAPP===
A WhatsApp summary for Michael, max 1400 characters: a one-line answer first, then 5-8 bullets with "• " that carry the key facts/numbers with [n] citations, then one line "*My take:* ..." with a practical recommendation. WhatsApp formatting only (*bold*, _italic_), no # headings, no links (the sources go separately).
===REPORT===
The full report in Markdown: "# ${plan.title}", then "## Summary" (3-5 sentences), then 4-7 "## " sections answering the questions (paragraphs and "- " bullets, facts with [n]), a "## Key numbers" section if there are numbers, "## What it means for Michael" (practical steps), and "## Gaps & caveats" (what the sources didn't settle). 900-1800 words. No sources list at the end (it is added automatically).`;
}
export function splitParts(text) {
  const t = String(text || '');
  const w = t.split(/===\s*WHATSAPP\s*===/i)[1];
  const parts = (w || t).split(/===\s*REPORT\s*===/i);
  return { whatsapp: (parts[0] || '').trim(), report: (parts[1] || '').trim() };
}
// only keep citations that point at a real source; renumber to the order they're cited
export function citedSources(texts, sources) {
  const order = [];
  for (const t of texts) for (const m of String(t).matchAll(/\[(\d{1,2})\]/g)) { const n = +m[1]; if (n >= 1 && n <= sources.length && !order.includes(n)) order.push(n); }
  return order;
}

// one phase of a research job; returns nothing, mutates st; uses ctx helpers {step, update, finish, deadline, now, deps, send, sendDoc}
export async function phase(st, h) {
  const { step, deps, deadline, now } = h;
  if (st.phase === 'r_plan') {
    const r = await S.gem(planPrompt(st.topic), { system: PLAN_SYS, json: true, maxTokens: 2048, chain: S.PLAN_CHAIN, cool: st.cool, timeoutMs: 40000, deadline, cache: h.rpc });
    st.rplan = cleanResearchPlan(r.ok ? S.parseJson(r.text) : null, st.topic);
    st.cands = []; st.qDone = 0;
    step(`research plan: "${st.rplan.title}", ${st.rplan.queries.length} searches (${r.ok ? r.model : 'fallback'})`);
    st.phase = 'r_search';
    await h.update(`🔎 Researching *${st.rplan.title}*: ${st.rplan.queries.length} searches, then I read the best ${MAX_READ} pages. About 3–6 min ⏳`);
    return;
  }
  if (st.phase === 'r_search') {
    const seen = new Set(st.cands.map(c => c.url));
    while (st.qDone < st.rplan.queries.length && deadline - now() > 25e3) {
      const batch = st.rplan.queries.slice(st.qDone, st.qDone + 3);
      const got = await Promise.all(batch.map(q => deps.webResults(q).catch(() => ({ results: [], news: [] }))));
      got.forEach((g, bi) => {
        const list = [...(g.results || []).slice(0, 6).map((x, i) => ({ ...x, rank: i })), ...(g.news || []).slice(0, 2).map(x => ({ ...x, rank: 3, news: true }))];
        for (const x of list) if (x.url && !seen.has(x.url)) { seen.add(x.url); st.cands.push({ title: trim(x.title, 140), url: x.url, snippet: trim(x.snippet, 300), rank: x.rank, q: batch[bi] }); }
      });
      st.qDone += batch.length;
    }
    step(`searched ${st.qDone}/${st.rplan.queries.length}: ${st.cands.length} unique results`);
    if (st.qDone >= st.rplan.queries.length) {
      if (!st.cands.length) { st.phase = 'fail'; st.error = 'the search engines returned nothing (try again in a few minutes)'; return; }
      st.toRead = pickPages(st.cands, st.topic + ' ' + st.rplan.title).map(c => ({ title: c.title, url: c.url, snippet: c.snippet }));
      st.pages = []; st.readIdx = 0; st.phase = 'r_read';
    }
    return;
  }
  if (st.phase === 'r_read') {
    while (st.readIdx < st.toRead.length && deadline - now() > 30e3 && st.pages.reduce((n, p) => n + p.text.length, 0) < NOTES_CHARS) {
      const batch = st.toRead.slice(st.readIdx, st.readIdx + 4);
      const got = await Promise.all(batch.map(async c => {
        try {
          const pg = await deps.fetchPage(c.url).catch(() => null);
          let text = pg?.ok && pg.text && pg.text.length > 300 ? pg.text : null;
          if (!text && deps.jinaRead) text = await deps.jinaRead(c.url).catch(() => null);
          return text ? { title: trim(pg?.title || c.title, 140), url: c.url, text: trim(text.replace(/\n{3,}/g, '\n\n'), PAGE_CHARS) } : null;
        } catch { return null; }
      }));
      for (const g of got) if (g) st.pages.push(g);
      st.readIdx += batch.length;
    }
    step(`read ${st.pages.length} pages (${st.readIdx}/${st.toRead.length} tried, ${Math.round(st.pages.reduce((n, p) => n + p.text.length, 0) / 1000)}k chars)`);
    if (st.readIdx >= st.toRead.length || st.pages.reduce((n, p) => n + p.text.length, 0) >= NOTES_CHARS) {
      // pages that couldn't be read still count through their search snippets
      const unread = st.cands.filter(c => !st.pages.some(p => p.url === c.url)).slice(0, 12).map(c => ({ title: c.title, url: c.url, text: `(search snippet) ${c.snippet}` }));
      st.sources = [...st.pages, ...unread].slice(0, 24);
      delete st.toRead; st.cands = st.cands.slice(0, 40);
      st.phase = 'r_write';
      if (st.pages.length >= 4) await h.update(`📚 Read ${st.pages.length} sources. Writing your report now…`);
    }
    return;
  }
  if (st.phase === 'r_write') {
    const r = await S.gem(writePrompt(st.rplan, st.topic, st.sources), { system: WRITE_SYS, maxTokens: 12000, chain: S.CODE_CHAIN, cool: st.cool, timeoutMs: 170000, deadline, temperature: 0.4 });
    st.writeTries = (st.writeTries || 0) + 1;
    const parts = r.ok ? splitParts(r.text) : null;
    if (!parts || parts.whatsapp.length < 200) {
      step(`write: no usable report (${r.ok ? 'format' : r.tried?.join(' ')}) try ${st.writeTries}`);
      if (st.writeTries >= 3) { st.phase = 'fail'; st.error = r.quota ? 'today\'s free AI quota is used up (it resets 8–9am Nigeria time)' : 'the AI couldn\'t write the report'; }
      return;
    }
    st.out = parts; st.writer = r.model;
    step(`write: ${r.model} wrote ${parts.whatsapp.length} + ${parts.report.length} chars`);
    st.phase = 'r_deliver';
    return;
  }
  if (st.phase === 'r_deliver') {
    const cited = citedSources([st.out.whatsapp, st.out.report], st.sources);
    const used = (cited.length ? cited : st.sources.map((_, i) => i + 1).slice(0, 8)).map(n => st.sources[n - 1]);
    const remap = Object.fromEntries((cited.length ? cited : []).map((n, i) => [n, i + 1]));
    const fix = t => String(t).replace(/\[(\d{1,2})\]/g, (m, n) => remap[+n] ? `[${remap[+n]}]` : (cited.length ? '' : m));
    const wa = fix(st.out.whatsapp).replace(/^#+\s*/gm, '*').replace(/\*\*(.+?)\*\*/g, '*$1*');
    const srcLines = used.slice(0, 8).map((s, i) => `[${i + 1}] ${trim(s.title, 70)}\n${s.url}`).join('\n');
    const msg = `📑 *${st.rplan.title}*\n\n${wa}\n\n🔗 *Sources*\n${srcLines}${used.length > 8 ? `\n…and ${used.length - 8} more in the PDF` : ''}`;
    let pdfNote = '';
    if (st.pdf !== false && st.out.report.length > 400) {
      try {
        const { makePdf } = await import('./_pdf.js');
        const buf = await makePdf({ title: st.rplan.title, subtitle: `Research by Michael AI · ${new Date().toISOString().slice(0, 10)} · ${st.pages.length} pages read, ${used.length} sources cited`, body: fix(st.out.report).replace(/^#\s+.*\n/, ''), sources: used });
        const name = `${(st.rplan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'research').slice(0, 50)}.pdf`;
        const d = await h.sendDoc(buf, 'application/pdf', name, `📄 Full report: ${st.rplan.title}`);
        st.pdfBytes = buf.length; pdfNote = d.ok ? '' : `\n\n_(The PDF didn't go through: ${trim(d.detail || '', 80)})_`;
        step(`pdf: ${Math.round(buf.length / 1024)} KB ${d.ok ? 'sent' : 'NOT sent'}`);
      } catch (e) { step(`pdf failed: ${trim(e.message, 120)}`); }
    }
    await h.finish(msg + pdfNote, { title: st.rplan.title, sources: used.length, pages: st.pages.length, pdf: !!st.pdfBytes });
    delete st.sources; delete st.pages; delete st.cands;
    return;
  }
}
