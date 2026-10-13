// v9.3 (10 Oct 2026, "train my AI"; Michael m:f765b47e "Then please train my Ai", m:7f3f7cf2 "Image coding video replying to texts.
// Banks of thing to know"). Pure helpers, no I/O:
//  - pickFacts: the taught facts sent to the model per message, chosen by relevance (topic tags + keyword overlap + pinned
//    standing facts + the newest few) within a char budget, instead of everything / oldest first.
//  - SKILLS_RULES: how to answer image, coding, video and reply-to-a-message asks (honest about what the bot can do).
//  - replyAsk: "reply to this" / a forwarded message -> 3 ready-to-copy replies in his voice.
//  - knowledgeView: /knowledge as a short summary by topic once there are many facts ("knowledge all" / "knowledge <topic>").
export const BUILD = 'v9.5';
export const LEAN_BUDGET = 9000;    // everyday chat: chars of taught facts per message
export const FULL_BUDGET = 16000;   // hard questions / writing as him: more room, still relevant-first

// topic tags: words in the QUESTION that make a topic relevant; the same words in a fact give it that topic when it has no tag
export const TOPICS = {
  about:   ['myself', 'who', 'life', 'bio', 'background', 'live', 'living', 'location', 'town', 'city', 'akure', 'ondo', 'timezone', 'family', 'brand'],
  prefs:   ['replies', 'short', 'long', 'prefer', 'preference', 'preferences', 'style', 'tone'],
  goals:   ['goal', 'goals', 'target', 'plan', 'plans', 'dream', 'december', 'year', 'achieve', 'phone', 'laptop', 'house', 'money', 'priority', 'priorities'],
  voice:   ['voice', 'post', 'caption', 'write', 'writing', 'status', 'reel', 'script', 'devotional', 'hook', 'tone', 'letter', 'sound', 'draft', 'signature', 'reply', 'message'],
  growth:  ['facebook', 'fb', 'reel', 'reels', 'views', 'followers', 'follow', 'growth', 'grow', 'audience', 'engagement', 'algorithm', 'viral', 'million', 'reach', 'channel', 'youtube', 'tiktok', 'instagram', 'content', 'monetise', 'monetize', 'earnings'],
  copy:    ['sell', 'selling', 'sales', 'offer', 'offers', 'price', 'pricing', 'client', 'clients', 'pitch', 'copy', 'ad', 'ads', 'package', 'customer', 'customers', 'landing', 'cta', 'business', 'service', 'services', 'money'],
  author:  ['book', 'books', 'novel', 'author', 'chapter', 'selar', 'ebook', 'manga', 'story', 'stories', 'fiction', 'read', 'readers', 'writing', 'twisted', 'golgotha', 'esther', 'gilead', 'algorithm'],
  faith:   ['god', 'jesus', 'christ', 'bible', 'faith', 'pray', 'prayer', 'verse', 'church', 'christian', 'sermon', 'scripture', 'gospel', 'holy', 'spirit', 'worship', 'devotional', 'kjv', 'lord'],
  tech:    ['code', 'coding', 'app', 'apps', 'site', 'website', 'deploy', 'vercel', 'render', 'github', 'apk', 'android', 'bug', 'api', 'supabase', 'host', 'hosting', 'domain', 'server', 'database', 'build', 'pwa'],
  images:  ['image', 'images', 'picture', 'pictures', 'pic', 'flyer', 'flyers', 'poster', 'posters', 'thumbnail', 'thumbnails', 'graphic', 'graphics', 'banner', 'prompt', 'prompts', 'canva', 'colour', 'colours', 'color', 'colors', 'palette', 'photo', 'photos', 'design', 'logo'],
  projects:['bible', 'arena', 'sow', 'blossom', 'clip', 'clips', 'bank', 'telegram', 'newsletter', 'letters', 'royal', 'care', 'beta', 'testers', 'crackit', 'voicepad', 'ranti', 'film', 'films', 'movie', 'movies', 'project', 'projects'],
};
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those i you your we our at by from as what who when where how why which do does did can could should would will just please pls about into than then them they he she his her its not no yes ok okay so if but have has had get got make made tell know want need there their more some any all one also very'.split(' '));
export const stem = w => w.length > 4 ? w.replace(/(ing|ies|ied|es|ed|s)$/, m => (m === 'ies' || m === 'ied') ? 'y' : '') : w;
export const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9₦#@\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
export function topicsOf(text) {
  const ws = new Set(tokens(text)); const out = [];
  for (const [t, list] of Object.entries(TOPICS)) if (list.some(w => ws.has(w))) out.push(t);
  return out;
}
const factText = f => String(f && (f.t ?? f) || '');
// -> { facts, omitted, picked: [indexes] }   facts keep their order (oldest first) so /unteach numbers stay meaningful
export function pickFacts(facts, query, budget = LEAN_BUDGET, { voice = false } = {}) {
  const list = (facts || []).map((f, i) => ({ i, f, t: factText(f) }));
  const total = list.reduce((n, x) => n + Math.min(x.t.length, 600) + 3, 0);
  if (total <= budget) return { facts: facts || [], omitted: 0, picked: list.map(x => x.i) };
  const qTok = tokens(query); const q = new Set(qTok.map(stem)); const qTopics = new Set(topicsOf(query));
  if (voice) qTopics.add('voice');
  const scored = list.map(x => {
    let s = 0;
    const ws = new Set(tokens(x.t).map(stem));
    for (const w of ws) if (q.has(w)) s += w.length > 5 ? 1.5 : 1;          // rarer, longer words count a bit more
    const tag = x.f && x.f.tag;
    if (tag && qTopics.has(tag)) s += 2.5;
    else if (!tag) for (const t of topicsOf(x.t)) if (qTopics.has(t) && t !== 'about' && t !== 'prefs') { s += 1; break; }
    // two-word names in the question ("bible arena", "royal people care") weigh a lot
    const low = x.t.toLowerCase();
    for (let k = 0; k + 1 < qTok.length; k++) if (low.includes(qTok[k] + ' ' + qTok[k + 1])) s += 3;
    return { ...x, s };
  });
  const pick = new Set(); let used = 0;
  const add = x => { const n = Math.min(x.t.length, 600) + 3; if (pick.has(x.i) || used + n > budget) return; pick.add(x.i); used += n; };
  list.filter(x => x.f && x.f.pin).forEach(add);                                  // standing facts: how he likes replies, where he lives, goals
  scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.i - a.i).forEach(add);
  list.slice(-5).forEach(add);                                                    // newest 5 (fresh instructions)
  const picked = [...pick].sort((a, b) => a - b);
  return { facts: picked.map(i => facts[i]), omitted: list.length - picked.length, picked };
}

export const SKILLS_RULES = `

# SKILLS (v9.3): how to handle these asks well
- IMAGES: "image: <idea>" or "make an image/poster/flyer/thumbnail of …" makes a real picture and sends it. In plain chat you cannot make one yourself: tell him to send it as "image: …" and give the exact line to send, with a strong prompt (subject, setting, composition, lighting, style, colours, size: square, status or landscape). Pictures come out without words; give the headline/verse text separately for him to add in Canva.
- CODING: give working code, complete for small files, in \`\`\` blocks under about 60 lines each, with the file name above each block and numbered steps to run or deploy. Explain bugs in one or two plain sentences, then the fix. Prefer JS/TS, Python, Flutter/Dart or plain HTML/CSS as he asks. For a whole site or app, tell him to send "build me a <site/app> …" and the agent builds and deploys it.
- VIDEO: be exact about what exists. You write video scripts, hooks, captions, shot lists, storyboards, edit plans and CapCut/Premiere steps. The bot can turn ONE picture plus an audio file into a simple video ("make video" after sending both). You cannot cut or edit footage, add motion graphics, or render reels; never say you did or will. When asked for an edit, say so in one line, offer what you CAN do right now (an edit plan with timestamps, or the CapCut steps), and for the real edit: "This is a big one, send it to Tab."
- REPLYING TO TEXTS: when he pastes or forwards a message to answer, give 3 short replies he can copy, labelled *Warm*, *Short* and *Professional*, in his voice (his P2 voice rules: warm, plain, faith-friendly where it fits), each its own paragraph with no quotes around it. Answer what they actually asked; never promise prices, dates or facts he hasn't given; if something is missing, leave a [blank] for it.
- FRESHEST FIRST: when he asks about a goal, project or status, lead with the newest dated taught fact (e.g. one marked 10 Oct 2026), then add older detail only if it helps. Keep it short: he prefers short replies.
- KNOW-HOW: facts from the reference bank are dated. Prices, fees, rules and limits change: say "as of <date>" and suggest "search: …" for today's figure.`;

// "reply to this", "how do I reply", "help me answer him", or a forwarded message with no question
const REPLY_RE = /\b(?:reply|respond|answer)\s+(?:to\s+)?(?:this|her|him|them|it|that|the (?:message|text|chat|client|customer|dm))\b|\bhow (?:do|should|can) i (?:reply|respond|answer)\b|\b(?:draft|write)\s+(?:a\s+|my\s+)?(?:reply|response)\b|\bwhat (?:do|should) i (?:say|reply|tell (?:her|him|them))\b/i;
export function replyAsk(msg, text) {
  const t = String(text || '');
  if (REPLY_RE.test(t)) return 'asked';
  if (msg && msg.context && msg.context.forwarded && msg.type === 'text' && t.length > 8) return 'forwarded';
  return null;
}
export const REPLY_EXTRA = kind => `\n\n# THIS MESSAGE: ${kind === 'forwarded' ? 'he FORWARDED a message someone sent him (the text above is theirs, not his)' : 'he wants a reply drafted for a message'}\nGive exactly 3 replies he can copy and send, labelled *Warm*, *Short* and *Professional*, in his voice, each as its own paragraph. Never invent reasons, new dates, prices or promises: where he must decide something, put a [blank] like [day] or [price]. One line first only if something must be checked. No other commentary.`;

// /knowledge once there are many facts: a summary by topic; "knowledge all" lists everything; "knowledge <topic>" one topic
export const TOPIC_LABEL = { about: 'About me', prefs: 'How I like things', goals: 'Goals', voice: 'My voice', growth: 'Growth & Facebook', copy: 'Copy & offers', author: 'Author & books', faith: 'Faith', tech: 'Tech', images: 'Images & design', projects: 'Projects', other: 'Other' };
export const topicOfFact = f => (f && f.tag) || (topicsOf(factText(f)).find(t => t !== 'about' && t !== 'prefs' && t !== 'voice') || 'other');
export function knowledgeView(facts, arg = '', { max = 3300 } = {}) {
  const list = (facts || []).map((f, i) => ({ n: i + 1, f, topic: topicOfFact(f) }));
  const a = String(arg || '').trim().toLowerCase();
  const line = x => `${x.n}. ${x.f.auto ? '📝 ' : ''}${factText(x.f)}`;
  if (a === 'all') return list.map(line).join('\n');
  const key = Object.keys(TOPIC_LABEL).find(k => k === a || TOPIC_LABEL[k].toLowerCase().includes(a));
  if (a && key) { const xs = list.filter(x => x.topic === key); return xs.length ? `*${TOPIC_LABEL[key]}* (${xs.length})\n` + xs.map(line).join('\n') : `No facts under ${TOPIC_LABEL[key]} yet.`; }
  const counts = {}; for (const x of list) counts[x.topic] = (counts[x.topic] || 0) + 1;
  const sum = Object.entries(counts).sort((p, q) => q[1] - p[1]).map(([k, c]) => `• ${TOPIC_LABEL[k] || k}: ${c}  _(knowledge ${k})_`).join('\n');
  const recent = list.slice(-8).map(x => { const l = line(x); return l.length > 140 ? l.slice(0, 137).replace(/\s+\S*$/, '') + '…' : l; }).join('\n');   // newest, shortened; full text via knowledge all / <topic>
  return (`🧠 *What you've taught me: ${list.length} facts*\n${sum}\n\n*Newest*\n${recent}`).slice(0, max);
}

// v9.3: does a reminder request say WHEN at all? (if not, the bot asks instead of letting the AI guess a time)
const WHEN_RE = /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}[:.]\d{2}|noon|midday|midnight|morning|afternoon|evening|night|tonight|today|tomorrow|tmr|tmrw|tomorow|next|in\s+(?:\d+|an?|one|two|three|few|half)|every|daily|weekly|monthly|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekend|o'?clock|later|soon|after|before|until|dawn|sunrise|sunset|lunch|breakfast|dinner|service|church|\d{1,2}(?:st|nd|rd|th)|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
export const hasWhen = t => WHEN_RE.test(String(t || '').replace(/^\s*(?:please\s+)?remind\s+me\b/i, ''));

// v9.3: the chat model sees the reminders that really exist, so "did you set it?" gets a true answer (not a false yes, not a false no)
export function remindersBlock(active, fmtWhen = d => new Date(d).toISOString()) {
  const list = (active || []).slice().sort((a, b) => a.due - b.due).slice(0, 15);
  if (!list.length) return '\n\n# HIS ACTIVE REMINDERS (real, set by the bot)\nNone right now. If he asks whether a reminder is set, say no and give him the line to send, e.g. "remind me at 7pm to …".\n';
  return '\n\n# HIS ACTIVE REMINDERS (real, set by the bot)\n' + list.map(r => `- ${fmtWhen(r.due)}: ${r.text}${r.rep ? ' (repeats)' : ''}`).join('\n')
    + '\nThese exist. If he asks whether a reminder is set, answer from this list exactly (and say "send *reminders* to manage them"); never claim one that is not listed, and never tell him to resend one that is.\n';
}
