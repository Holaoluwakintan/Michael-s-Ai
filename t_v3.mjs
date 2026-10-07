// Local unit tests for v3 (multi-teach + KB_LIMIT 60k). Gemini is mocked (no quota used); WhatsApp sends are captured (test ctx);
// state lives in the real Blob store under wa-test/ (cleaned up at the end).
import assert from 'node:assert/strict';
const realFetch = globalThis.fetch;
const calls = [];
let geminiMode = 'ok';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('generativelanguage')) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    calls.push({ model, sys: body.systemInstruction.parts[0].text, user: JSON.stringify(body.contents.at(-1)) });
    const ok = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    if (geminiMode === 'all429') return new Response('{"error":{"message":"Quota exceeded for metric generate_content_free_tier_requests, limit: 20 GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (geminiMode === 'flash429' && !model.includes('lite')) return new Response('{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (geminiMode === 'voiceteach') return ok('TEACH: my ebook price is ₦2,000');
    const last = calls.at(-1).user;
    if (last.includes('Write a Facebook post')) return ok('**Ruth stayed.**\n\nWhen everyone left, she stayed.\n\nOlaoluwa Michael');
    if (last.includes('NOT_ABOUT_DRAFT') && last.includes('capital')) return ok('NOT_ABOUT_DRAFT');
    if (last.includes('NOT_ABOUT_DRAFT')) return ok('Ruth stayed. Shorter now.');
    if (last.includes('morning nudge')) return ok("Good morning Michael 🌅\n*Today's focus:*\n• Pitch 3 businesses");
    return ok(`answer from ${model}`);
  }
  return realFetch(url, opts);
};
const m = await import('./api/whatsapp.js');
await (await import('./t_store.mjs')).cleanTest(); // v7 fresh sandbox (the store keeps wa-test records between runs)
const OWNER = '2348148034092';
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let n = 0;
const say = async (text, from = OWNER, c = ctx()) => { const r = await m.processMessage({ from, id: 'wamid.t' + Date.now() + (n++), type: 'text', text: { body: text } }, 'T', c); return { r, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body) }; };
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('✔', name); };


const kb0 = () => ({ facts: [], settings: {} });
// splitTeach / multiTeach (pure)
{ const r = m.splitTeach('📚 PACK 1 · header\n\nteach: one\n\nTEACH: two\ncontinues here\n\n[1.03]\nTeach : three\n- teach: four');
  ok('splitTeach finds 4 items, joins continuation, ignores header', r.items.length === 4 && r.items[1] === 'two continues here' && r.items[2] === 'three' && r.items[3] === 'four' && r.skipped === 1); }
{ const kb = kb0(); const c = m.command('teach: alpha fact\nteach: beta fact\nteach: gamma fact', { history: [] }, kb);
  ok('multi-teach saves 3 separate facts', c.saveKB && kb.facts.length === 3 && kb.facts[1].t === 'beta fact');
  ok('multi-teach reply "✅ Saved 3 facts"', c.reply.startsWith('✅ Saved 3 facts\n')); }
{ const kb = kb0(); const c = m.command('teach: only one line', { history: [] }, kb);
  ok('single teach unchanged', kb.facts.length === 1 && c.reply === "Got it ✅ I'll remember: _only one line_"); }
{ const kb = kb0(); const long = 'x'.repeat(900); m.command(`teach: ${long}\nteach: short`, { history: [] }, kb);
  ok('600-char cap per item', kb.facts[0].t.length === 600 && kb.facts[1].t === 'short'); }
{ const kb = kb0(); m.command('teach: a1\nteach: b1', { history: [] }, kb); const c = m.command('teach: a1\nteach: c1', { history: [] }, kb);
  ok('duplicates skipped in multi', kb.facts.length === 3 && c.reply.startsWith('✅ Saved 1 fact (1 already known, skipped)')); }
{ const kb = kb0(); const c = m.command('teach: me how to pray please', { history: [] }, kb); ok('single "teach:" with colon still a teach (as v2)', c.saveKB); }
ok('teach me (no colon) still not a command', m.command('teach me how to pray', { history: [] }, kb0()) === null);
{ const kb = kb0(); const c = m.command('hello\nI want to teach: something', { history: [] }, kb); ok('teach: mid-line is not multi', c === null && kb.facts.length === 0); }
// real teach pack files
import fs from 'node:fs';
{ const dir = '/home/user/tab/files/michael-ai/teach-packs/'; let total = 0, okAll = true;
  for (const f of fs.readdirSync(dir)) { const txt = fs.readFileSync(dir + f, 'utf8'); const want = (txt.match(/^teach:/gim) || []).length;
    const kb = kb0(); const c = m.command(txt, { history: [] }, kb); total += kb.facts.length;
    if (kb.facts.length !== want || !c.reply.startsWith(`✅ Saved ${want} facts`) || kb.facts.some(x => /^teach:/i.test(x.t) || /📚/.test(x.t))) { okAll = false; console.log('pack mismatch', f, want, kb.facts.length, c.reply); } }
  ok(`all 10 pack files paste cleanly (${total} facts)`, okAll && total === 84); }
{ const txt = fs.readFileSync('/home/user/tab/files/michael-ai/teach-packs.txt', 'utf8'); const kb = kb0(); const c = m.command(txt, { history: [] }, kb);
  ok('whole teach-packs.txt in one message -> 84 facts, labels ignored', kb.facts.length === 84 && c.reply.startsWith('✅ Saved 84 facts') && !kb.facts.some(f => /^\[\d/.test(f.t) || /={5}/.test(f.t))); 
  // KB limit: all 84 fit into the prompt
  const blk = m.knowledgeBlock(kb.facts);
  ok(`knowledgeBlock keeps all 84 pack facts (${blk.length} chars)`, kb.facts.every(f => blk.includes(f.t)) && !blk.includes('left out'));
  ok('old 20k limit would have dropped some', kb.facts.reduce((n, f) => n + f.t.length + 3, 0) > 20000); }
{ const facts = Array.from({ length: 200 }, (_, i) => ({ t: `fact ${String(i).padStart(3, '0')} ` + 'y'.repeat(480) }));
  const blk = m.knowledgeBlock(facts);
  ok(`overflow keeps oldest + newest under 60k (${blk.length} chars)`, blk.length < 61000 && blk.includes('fact 000 ') && blk.includes('fact 199 ') && blk.includes('older taught facts left out') && !blk.includes('fact 100 ')); }
// end to end through processMessage (mock Gemini, sandbox store)
let x = await say('/new');
x = await say('teach: e2e one\nteach: e2e two\n\nteach: e2e three');
ok('e2e multi-teach reply', x.sent[0].startsWith('✅ Saved 3 facts'));
x = await say('/knowledge'); ok('e2e /knowledge lists the 3', x.sent.join('\n').includes('1. e2e one') && x.sent.join('\n').includes('3. e2e three'));
calls.length = 0; x = await say('what do you know?');
ok('e2e facts reach the model', calls[0].sys.includes('- e2e two'));
x = await say('teach: e2e four'); ok('e2e single teach still works', x.sent[0] === "Got it ✅ I'll remember: _e2e four_");
{ const r = await m.GET(new Request('http://x/api/whatsapp?health=1')); const j = await r.json(); ok('health v2 + build v3+ + kb_limit 60000', j.version === 2 && /^v[3-9](\.\d+)?$/.test(j.build) && j.kb_limit === 60000 && j.multi_teach === true); }
console.log(`\n${pass} checks passed`);
const { cleanTest } = await import('./t_store.mjs');
console.log('cleaned', await cleanTest(), 'test records');
