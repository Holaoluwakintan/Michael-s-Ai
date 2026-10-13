// v9.3: trained knowledge (teach packs + Tab notes), relevance-picked facts, skills rules, reply drafts, knowledge view, wider image asks
import fs from 'node:fs';
process.env.WA_TOKEN = process.env.WA_TOKEN || 'x'; process.env.WA_PHONE_ID = process.env.WA_PHONE_ID || '1';
const V93 = await import('./api/_v93.js');
const X = await import('./api/_extras.js');
const BR = await import('./api/_brain.js');
const R8 = await import('./api/_remind8.js');
const W = await import('./api/whatsapp.js');
let n = 0; const ok = (name, c) => { if (!c) { console.log('✘ ' + name); process.exit(1); } n++; console.log('✔ ' + name); };
const facts = JSON.parse(fs.readFileSync('/home/user/tab/files/michael-ai/train-v93/facts-import.json', 'utf8'));
const src = r => r.facts.map(f => f.src);
// import file
ok('95 facts to import (84 pack items, 1 merged with a Tab update, + 11 Tab notes), each ≤600 chars, tagged', facts.length === 95 && facts.every(f => f.t.length <= 600 && f.tag && f.src));
ok('pack counts 12/10/15/15/11/10/11', ['P1.', 'P2.', 'P3A.', 'P3B.', 'P4.', 'P5.', 'P6.'].map(p => facts.filter(f => f.src.startsWith('pack:' + p)).length).join() === '12,10,15,15,11,10,11');
ok('no secrets in the facts', !facts.some(f => /(AIza[0-9A-Za-z_-]{20}|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20}|ghp_[A-Za-z0-9]{20}|(password|passcode|pin)\s*(is|:|=)\s*\S)/i.test(f.t)));
ok('4 pinned standing facts (short replies, Akure/WAT, December goals, Facebook million goal)', facts.filter(f => f.pin).length === 4);
// picking
const total = facts.reduce((a, f) => a + f.t.length, 0);
ok('all facts overflow the lean budget (so picking matters)', total > V93.LEAN_BUDGET);
let r = V93.pickFacts(facts, "what's my growth goal", V93.LEAN_BUDGET);
ok('growth goal: the million goal + P3A growth facts are in, within budget', r.facts.some(f => /million/.test(f.t)) && r.facts.filter(f => f.tag === 'growth').length >= 10 && r.facts.reduce((a, f) => a + f.t.length + 3, 0) <= V93.LEAN_BUDGET);
r = V93.pickFacts(facts, 'what is Bible Arena', V93.LEAN_BUDGET);
ok('Bible Arena: both Bible Arena facts are in', r.facts.filter(f => /Bible Arena/.test(f.t)).length >= 2 && r.facts.some(f => /beta test starts 11 Oct/.test(f.t)));
r = V93.pickFacts(facts, 'write a post in my voice about faith', V93.FULL_BUDGET, { voice: true });
ok('voice + faith: all 10 voice and all 10 faith facts are in', r.facts.filter(f => f.tag === 'voice').length === 10 && r.facts.filter(f => f.tag === 'faith').length === 10);
r = V93.pickFacts(facts, 'how do I deploy my app on vercel', V93.LEAN_BUDGET);
ok('tech question: the P6 tech facts are in', r.facts.filter(f => f.tag === 'tech').length >= 8);
r = V93.pickFacts(facts, 'hi', V93.LEAN_BUDGET);
ok('small talk: pinned + newest only, order kept (oldest first)', r.facts.filter(f => f.pin).length === 4 && r.picked.every((v, i, a) => !i || a[i - 1] < v));
ok('small fact lists go in whole', V93.pickFacts(facts.slice(0, 5), 'hi').facts.length === 5);
ok('legacy plain-string facts still work', V93.pickFacts(['a', 'b'], 'x').facts.length === 2);
// system prompt
const sys = W.systemText(facts.map(f => ({ t: f.t, tag: f.tag, pin: f.pin })), { lean: true, query: 'what is Bible Arena' });
ok('system prompt: skills block, Bible Arena beta fact, omitted note, Akure pinned', sys.includes('# SKILLS (v9.3)') && sys.includes('beta test starts 11 Oct 2026') && /other taught facts not shown/.test(sys) && sys.includes('Akure, Ondo State'));
const sysAll = W.systemText(facts.slice(0, 4), {});
ok('no query (nudges/jobs): every fact goes in', facts.slice(0, 4).every(f => sysAll.includes(f.t.slice(0, 60))));
// skills
ok('skills rules: honest video, 3 reply tones, code blocks, image command', /cannot cut or edit footage/.test(V93.SKILLS_RULES) && /\*Warm\*, \*Short\* and \*Professional\*/.test(V93.SKILLS_RULES) && /```/.test(V93.SKILLS_RULES) && /image: …/.test(V93.SKILLS_RULES));
ok('reply ask detected', V93.replyAsk({ type: 'text' }, 'how do I reply this? "Hi, how much for a logo?"') === 'asked' && V93.replyAsk({ type: 'text' }, 'help me reply to this client') === 'asked');
ok('forwarded message detected', V93.replyAsk({ type: 'text', context: { forwarded: true } }, 'Good evening sir, is the website ready?') === 'forwarded');
ok('ordinary chat is not a reply ask', V93.replyAsk({ type: 'text' }, 'what is Bible Arena') === null && V93.replyAsk({ type: 'text' }, 'answer me quickly, what time is it') === null);
ok('reply extra asks for exactly 3 labelled replies', /exactly 3 replies/.test(V93.REPLY_EXTRA('asked')) && /FORWARDED/.test(V93.REPLY_EXTRA('forwarded')));
// knowledge view
const kv = V93.knowledgeView(facts);
ok('knowledge view: summary by topic, fits one WhatsApp message', kv.includes('95 facts') && kv.includes('Growth & Facebook') && kv.length < 3500);
ok('knowledge faith lists the 10 faith facts with their global numbers', (V93.knowledgeView(facts, 'faith', { max: 99999 }).match(/^\d+\. /gm) || []).length === 10 && /^64\. /m.test(V93.knowledgeView(facts, 'faith', { max: 99999 })));
ok('knowledge all lists all 95', (V93.knowledgeView(facts, 'all').match(/^\d+\. /gm) || []).length === 95);
// images
let im = X.detectImage('make a bible verse graphic for Psalm 23 in status size');
ok('verse graphic -> image, status size, kind kept in the prompt', im && im.height === 1920 && /verse graphic for Psalm 23/.test(im.prompt));
im = X.detectImage('design my church flyer for youth night on Friday');
ok('flyer -> image, poster look + faith look', im && /church flyer/.test(im.prompt) && /empty space at the top/.test(X.brandStyle(im.prompt)) && /reverent/.test(X.brandStyle(im.prompt)));
im = X.detectImage('create a youtube thumbnail of a man praying in the rain');
ok('thumbnail -> landscape + thumbnail look', im && im.width === 1920 && /title/.test(X.brandStyle(im.prompt)));
ok('plain "make an image of" unchanged', X.detectImage('make an image of a lamb at sunrise').prompt === 'a lamb at sunrise');
ok('not images: website / app / video', !X.detectImage('make a website for my bakery') && !X.detectImage('make an app for my church') && !X.detectImage('create a video of my church'));
ok('Blossom brand look', /dusty-rose/.test(X.brandStyle('poster about Blossom AI class')));
// retrieval trigger + label
ok('know-how questions trigger a lookup', BR.wantsRetrieval('how do I check my BVN') && BR.wantsRetrieval('what does vercel hobby allow') && !BR.wantsRetrieval('hi there'));
ok('reference bank rows are labelled as dated know-how', /reference bank/.test(BR.brainBlock([{ src: 'knowhow:tech', title: 'Vercel basics', body: 'x' }])));
// reminder honesty (v8 fix still holds)
ok('"the three time" counts as an answer to a reminder question', R8.looksLikeAnswer('The three time'));
ok('a claimed reminder is caught', R8.claimsAction("I've set reminders for 7pm, 8pm and 9pm")?.kind === 'reminder');
const hk = JSON.parse(fs.readFileSync('/home/user/tab/files/michael-ai/train-v93/knowhow.json', 'utf8'));
ok('know-how bank: 33 dated entries, each tagged knowhow:*', hk.length === 33 && hk.every(x => /^knowhow:/.test(x.src) && /checked 10 Oct 2026/.test(x.body)));
ok('no time said -> ask (hasWhen false); times/days/after-church count as a time', !V93.hasWhen('Remind me to message Mr John to give me his VPS database') && !V93.hasWhen('Set a reminder for my meeting with Pastor') && V93.hasWhen('remind me after church to call pastor') && V93.hasWhen('remind me tonight to pray') && V93.hasWhen('remind me on friday to send the invoice'));
ok('reminders block lists real reminders and forbids unlisted claims', /- .*: call mum/.test(V93.remindersBlock([{ due: Date.now() + 3600e3, text: 'call mum' }])) && /never claim one that is not listed/.test(V93.remindersBlock([{ due: 1, text: 'x' }])) && /None right now/.test(V93.remindersBlock([])));
ok('reply drafts never invent dates: [blank] placeholders', /\[blank\]/.test(V93.REPLY_EXTRA('asked')));
console.log(`${n} checks passed`);
