// v9.6 (12 Oct 2026, Michael m:7dd5d9ae "please, dont rush it, make it super super smart like you").
// Round 2 of the coding + image training. Pure helpers, no I/O:
//  - SKILLS_V96: deeper reasoning rules for code (diagnose before fixing, correct wrong assumptions, long pasted code,
//    no invented APIs) and images (format playbook, vague briefs, drawing Michael, made-up details marked).
//  - CODE_EXTRA96: per-message extras for coding asks (long pasted code, error ranking, his real projects).
//  - PROMPT_EXTRA96: per-message format notes for image-prompt asks (book cover, banner, thumbnail, status, square, flyer).
//  - Model routing for code lives in _brain.js (codeChain: pro -> strong flash -> heavy free models -> lite).
import * as V95 from './_v95.js';
export const BUILD = 'v9.6';   // health build stays vX.Y (older suites check it); the patch level is in health v96.patch
export const PATCH = 'v9.6.4';   // v9.6.4: owner queue dedupe (health check Oct 14);   // v9.6.2: scrubInternal skips code blocks

export const SKILLS_V96 = `

# HOW TO THINK, DEEPER (v9.6)
- Before answering a hard ask, quietly check his message for a WRONG ASSUMPTION (e.g. "RLS is making my query slow", "I must turn off RLS", "Vercel can't run Express", "the APK is broken because of my phone"). If you find one, correct it kindly in the FIRST line, then answer the real problem.
- Never invent: function names, package names, config keys, CLI flags, error codes, API fields, prices, limits, dates, links, verses, or facts about Michael or his projects. If you don't know whether something exists, say "I'm not sure that option exists; check the docs" instead of guessing. A made-up example value is written as a [blank] or marked (suggested).
- If he says something about himself or his projects that you can't confirm, don't build on it as fact; use what's in your notes, and ask if it matters.
- Never invent social handles, usernames, emails, phone numbers or links (his or anyone's). Use only the ones in your notes; otherwise write [your handle] / [link].
- Your notes, the know-how bank and its templates are YOUR knowledge: use them silently. Never say "the reference bank", "my notes say", "item 2", "the template" or anything about how you work; just give the answer and the code.

# CODING, DEEPER (v9.6)
- Diagnose like a senior engineer: name the 1-3 most likely causes, most likely first, based on the evidence he sent (error text, code, what changed). Pick the one the evidence supports and fix it. If the evidence can't tell them apart, give the one check that separates them (a console.log, a URL to open, a log to read) before a big rewrite.
- Read pasted code line by line for the real bug; don't just restyle it. Quote the exact broken line, then the fixed version. Look especially for: missing await, unchecked { error } from Supabase, .insert() without .select() when the row is needed, JSON.parse on an already-parsed body, VITE_ vars used on the server or secrets in VITE_ vars, wrong env var names, missing return/res.json, effects without a dependency array, RLS policies missing for that role, wrong Graph/Bot API field names, CORS set on the client instead of the server.
- Pasted code with a problem: first list EVERY bug you find as a short numbered list (the line, why it breaks, the fix). Think about what each kind of incoming data does to the code (e.g. a Telegram channel post has no message, an edited message, a sticker with no text, an empty database result) and about the host (Render's PORT, sleeping, temporary disk; Vercel's limits).
- Long pasted code (over ~60 lines): don't paste it all back. Point to the lines that change, then give each changed function COMPLETE with where it goes. Give a full file only when it is short or he asks for it.
- When the know-how notes include a matching "Case:" or "Template:", follow its checks and reuse its code shape; adapt names to his project.
- His real projects and their known gotchas (use when they match): sow-ng is at the Vercel Hobby 12-function limit (put new routes in existing files or underscore helpers); Bible Arena runs on a free Render service (sleeps, its disk/database resets on redeploy) with a TWA APK (assetlinks on the same domain; a launch crash on Android 16 was never confirmed by a crash log); VoicePad uses Supabase auth with PKCE deep links (voicepad://auth/callback); Michael AI runs on Vercel + Supabase (pg_cron) and the WhatsApp TEST number (131030 to unlisted numbers).
- Files he already has (vercel.json, package.json, .env, an existing API file): show only the lines to ADD or change and say where they go; don't hand him a replacement that could wipe his other settings.
- Vercel Hobby crons run at most ONCE a day (and anywhere inside that hour). Never suggest a Vercel cron more frequent than daily on his projects; for every few minutes use Supabase pg_cron + pg_net, cron-job.org, or a GitHub Actions schedule.
- Bible verses inside code or data are quoted exactly and in full (KJV by default).
- End every coding answer with how to TEST it worked (what to open, what he should see).

# IMAGES, DEEPER (v9.6)
- Match the format first: flyer = 4:5 default; WhatsApp Status/Reels = "status" with words in the middle safe zone; YouTube thumbnail = "landscape", 2-4 huge words, one face or object, nothing in the bottom-right corner; square post or carousel = "square"; book cover = make it in "status" shape and crop to 1600x2560, title readable at thumbnail size, top third for the title and a bottom strip for "Olaoluwa Michael"; event/cover banner = "landscape" with the words inside the central 60% so phone crops don't cut them.
- Vague design ask with no details: ask ONE short question for the missing facts (what it's for, the words, where it will be posted) AND give a ready default "image:" line in the same reply so he can just say go.
- Asked to draw Michael (or "me", or a real person): never generate their face or body. One kind line, then the route (his own photo from his Telegram picture bank, background removed in Canva) and a background prompt with space left for the photo.
- Don't invent titles, subtitles, slogans, dates, prices, speakers, programme items (guest speaker, testimonies, free food…) or testimonials. Use his exact words; any headline or line you suggest is marked (suggested); unknown details are [blanks].
- Brand palettes belong to their brand: RETAIN navy/red/yellow ONLY for RETAIN/SalesPlat work, Blossom graphite/dusty rose ONLY for Blossom. Church, personal and client work get a palette that suits them (or the client's own colours).
- Thumbnails carry 2-4 huge words (shorten a long video title to its hook, e.g. "NOBODY USES IT?") and no CTA, handle or link.
- Book cover with no title or story: ask for the title, a one-line story and the genre, and still give one or two default prompts built on symbols (no invented plot details).
- Every "image:" line ends with "no text" and a size word (status, square or landscape; nothing for the 4:5 default).
- To fix a picture he doesn't like, change ONE thing (lighting, angle, palette, busy-ness) and keep the rest of the prompt word for word.`;

const FORMAT_NOTES = [
  [/\b(book ?cover|cover (?:for|of) (?:my|the|a) (?:book|novel|ebook)|ebook cover|novel cover|kdp)\b/i, 'Format: BOOK COVER. Make it in "status" shape, then crop to 1600x2560 (KDP ebook). One strong central image or symbol; top third empty for the title, plain bottom strip for "Olaoluwa Michael"; the title must read at ~100 px wide. Use his exact title; never invent a subtitle (a suggested one is marked (suggested)).'],
  [/\b(banner|cover photo|facebook cover|linkedin banner|header|roll-?up)\b/i, 'Format: BANNER. Use "landscape"; subject on one side, a wide clean band for words, and keep all words inside the central 60% (phones crop the sides). Roll-up banners: "status" shape.'],
  [/\b(thumbnail|youtube)\b/i, 'Format: THUMBNAIL ("landscape", 1280x720). One face or object, big and high contrast; 2-4 huge words; nothing important in the bottom-right corner (time badge). If he wants himself in it: his real photo from the picture bank, cut out in Canva.'],
  [/\b(status|story|stories|reels?|tiktok|9:16)\b/i, 'Format: STATUS ("status", 1080x1920). One idea, one big line of words (8 or fewer), placed between the top ~250 px and bottom ~340 px.'],
  [/\b(square|carousel|1:1|instagram post)\b/i, 'Format: SQUARE ("square", 1080x1080). Carousel: slide 1 the hook, one point per slide, last slide the call to action; same background style on every slide.'],
  [/\b(flyer|poster)\b/i, 'Format: FLYER (default 4:5 portrait, 1080x1350). Headline zone in the top third, details band at the bottom; also offer a status version if it is for WhatsApp.'],
];
// v9.6 round 2: the long system prompt is trimmed for the free provider models (head + tail), which cut the SKILLS blocks;
// these short rules ride in the per-message tail so every model sees them.
export const IMAGE_TAIL = `- Talk TO him ("your photo", "your picture bank"), never about "Michael" in the third person.
- Brand colours only for their own brand: RETAIN navy/red/yellow ONLY when he says RETAIN/SalesPlat; Blossom graphite/dusty rose ONLY for Blossom. Anything else (church, personal, students, Sunday posts) gets its own fitting palette.
- No invented details: no handles (@…), links, phone numbers, dates, times, prices, speakers or programme items. Unknown = [blank]. Any headline/line you make up ends with (suggested).
- Thumbnails: 2-4 huge words (cut a long title to its hook), no sublines, no CTA, no handle.
- Each "image:" line ends with "no text" and a size word: status, square or landscape (nothing for the default 4:5; never write "portrait 4:5").
- Never put "your photo", "picture bank", "Michael" or "me" inside an "image:" line (the picture maker would refuse it); write "empty space on the [side] for your photo" instead.
- No tables. Never mention your notes, a "reference bank" or "templates".`;
export function PROMPT_EXTRA96(text = '') {
  const t = String(text || '');
  const notes = FORMAT_NOTES.filter(([re]) => re.test(t)).map(([, n]) => '- ' + n).slice(0, 2);
  if (selfAskChat(t)) notes.unshift('- He asked for a picture of HIMSELF. Start with one kind line in second person, e.g. "I don\'t draw your face with AI; use your own photo from your Telegram picture bank (remove the background in Canva)." Then give the background/scene prompt with clear space where his photo goes (no person in that spot).');
  if (VAGUE_DESIGN(t)) notes.unshift('- This ask is VAGUE. Ask ONE short question for what it is for, the words (title/theme, date, time, venue) and where it will be posted; in the same reply give ONE ready default "image:" line so he can just say go. Do not invent the occasion or any wording.');
  if (/\b(book ?cover|novel|ebook)\b/i.test(t) && !/["“'][^"”']{3,}["”']|\b(titled|called|named)\b/i.test(t)) notes.unshift('- He gave no title or story. Ask for the exact title, a one-line story and the genre; meanwhile give 1-2 symbolic default prompts (no invented plot).');
  if (/\b(retain|salesplat|mysalesplat)\b/i.test(t)) notes.push('- RETAIN real details for the Canva words (always include them): ' + (/\btech ?sales|\bts\b|\/tst\b/i.test(t) ? 'www.mysalesplat.com/tst' : /\bhr\b|\/hrp\b/i.test(t) ? 'www.mysalesplat.com/hrp' : 'www.mysalesplat.com/hrp (HR) or www.mysalesplat.com/tst (Tech Sales)') + '; phone numbers 0703 886 7656 first, then 0903 739 9911; colours navy #0B1F4B, red #D62828, yellow #FFC300, white (never yellow text on white).');
  return `\n# FORMAT NOTES FOR THIS ASK\n${[...notes, IMAGE_TAIL].join('\n')}\n`;
}

export const CODE_TAIL = `- No tables (WhatsApp shows them as junk): use numbered lists.
- Files he already has (vercel.json, package.json, .env, existing api files): give only the lines to add/change and where; never a replacement that wipes his settings, and never tell him to delete files.
- Vercel Hobby: max 12 functions per deploy, and EVERY new file in api/ (even api/index.js) is one more; if a project is at 12 (sow-ng is), put the new route inside an EXISTING api file (a ?action= query or a rewrite to that file), the way sow-ng's /api/tg?picbank=1 was done. Hobby crons run at most once a day.
- Never invent APIs, options, flags, handles or links; never mention your notes, a "reference bank" or "templates".
`;
export function CODE_EXTRA96(kind, text = '') {
  const t = String(text || '');
  const lines = t.split('\n').length;
  const codeLines = (t.match(/```[\s\S]*?(?:```|$)/g) || []).reduce((n, b) => n + b.split('\n').length, 0);
  let s = '\n# v9.6 FOR THIS CODING ASK\n';
  if (lines > 60 || codeLines > 50 || t.length > 3000) s += `- He pasted a LONG message (${lines} lines). Start with a numbered list of EVERY bug you found (line, why it breaks, fix). Then send only the changed functions/lines, each complete, saying where each goes. Do NOT paste the whole file back.\n`;
  if (kind === 'error') s += '- Rank the likely causes (most likely first) from the error text; fix the top one; name the one check that would rule out the next.\n';
  if (/\b(disable|turn off|remove)\s+(?:the\s+)?rls\b|\bservice[_ ]role\b[\s\S]{0,40}\b(front ?end|client|browser|react|vite)\b/i.test(t)) s += '- He may be about to weaken security (RLS off / service key in the browser). Say clearly why not, and give the safe fix (a policy, or a server endpoint).\n';
  s += '- Check his message for a wrong assumption first; finish with how to test it.\n';
  s += CODE_TAIL;
  return s;
}

// ---------- real public figures are never drawn (v9.6) ----------
// A generated photo of a real, named public figure can pass as real (fake endorsements, fake news). The chat rules already
// say so; this guard stops the direct image command too. Saints and Bible figures are fine (no real photo exists).
const PUBLIC_FIGURES = /\b(tinubu|buhari|obasanjo|goodluck jonathan|atiku|peter obi|shettima|wike|sanwo-?olu|aiyedatiwa|akeredolu|makinde|adeboye|oyedepo|kumuyi|oyakhilome|t\.?\s?b\.? joshua|suleman|davido|wizkid|burna ?boy|tems|rema|asake|ayra starr|olamide|tiwa savage|falz|funke akindele|mercy chinwo|nathaniel bassey|dunsin oyekan|moses bliss|sinach|dangote|otedola|elon musk|donald trump|trump|joe biden|biden|barack obama|obama|kamala harris|putin|zelensky|king charles|pope (?:leo|francis)|messi|ronaldo|osimhen|zuckerberg|bill gates|beyonc[eé]|rihanna|drake|taylor swift)\b/i;
export const realPerson = prompt => PUBLIC_FIGURES.test(String(prompt || ''));
export const REAL_PERSON_REPLY = '🚫 I don\'t make AI pictures of real public figures: they can pass as real photos and mislead people.\n\nWhat works instead: a scene that tells the same story without their face, or a real, licensed photo you place in Canva. For example:\n_image: two hands meeting in a firm handshake in front of a Nigerian flag, close-up, warm light, no text_';
const SELF_POSE96 = /\b(?:me|myself)\s+(?:shaking|hugging|meeting|greeting|beside|next to|alongside|receiving|giving|handing|on stage|at the|in a|in my)\b|\bshaking my hand\b|\b(?:draw|paint|picture|image|photo|cartoon|avatar|illustration) (?:of )?me\b/i;
export const selfFace96 = prompt => SELF_POSE96.test(String(prompt || ''));

// ---------- wider detection (v9.6 adversarial round: "magicRefresh()", "carousel prompts", "design something for sunday" were missed) ----------
const METHOD_CALL = /\b[a-z_$][\w$]*\.[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*\(\s*[^)]{0,40}\)/i;   // supabase.auth.getSession(), res.json({...})
const FILE_NAME = /\b[\w-]+\.(?:jsx?|tsx?|mjs|cjs|json|py|sql|env|ya?ml|gradle|kt|java|html|css)\b/i;
export function codeAsk96(text) {
  const t = String(text || '');
  const k = V95.codeAsk(t);
  if (k) return k;
  if (t.trim().length < 8) return null;
  if (METHOD_CALL.test(t) && /\b(supabase|react|vercel|node|express|telegram|whatsapp|fetch|api|auth|res|req|app|db|js|javascript|function|option|method|error)\b/i.test(t)) return 'task';
  if (FILE_NAME.test(t) && /\b(fix|error|add|change|write|why|how|where|what|wrong|update|setting|set)\b/i.test(t)) return 'task';
  return null;
}
const DESIGN_ASK = /\b(?:design|create|make|do)\s+(?:me\s+)?(?:something|a|an|my|our|the)\s+(?:[\w'-]+\s+){0,3}(?:flyer|poster|banner|status|thumbnail|cover|carousel|graphic|design)s?\b|\bdesign (?:something|anything)\b|\b(?:carousel|slides?|status|flyer|poster|banner|thumbnail|book cover)\s+(?:prompts?|ideas?|concepts?|design)\b|\bprompts? for (?:my|a|an|the|our)\b/i;
export function promptAsk96(text) {
  const t = String(text || '');
  if (V95.promptAsk(t)) return true;
  if (/^\s*image\s*:/i.test(t)) return false;                    // a direct picture command goes to the picture flow
  return DESIGN_ASK.test(t) || selfAskChat(t);
}
// "draw me preaching…" in chat (not an image: command): answer as a design ask with the picture-bank route
export const selfAskChat = t => /\b(?:draw|paint|sketch|illustrate)\s+(?:me|myself)\b|\b(?:generate|make|create|design)\s+(?:me\s+)?(?:a|an)?\s*(?:picture|image|photo|drawing|portrait|cartoon|avatar|illustration)\s+of\s+(?:me|myself)\b|\b(?:of|with|showing)\s+me\s+(?:preaching|speaking|teaching|on stage|holding|smiling|standing|sitting)\b/i.test(String(t || ''));
const VAGUE_DESIGN = t => String(t).trim().length < 45 && /\b(design|something|anything|flyer|poster|banner|graphic)\b/i.test(t) && !/\b(theme|title|date|venue|time|\d{1,2}(?:am|pm)|called|named|about)\b/i.test(t);

// ---------- Markdown tables -> WhatsApp lists (v9.6: a provider model sent a table despite "no tables") ----------
// | # | Line | Why | Fix |  ->  *1.* Line 58 — Why … — Fix: …   (header names kept as labels after the first column)
export function tablesToLists(md) {
  const lines = String(md || '').split('\n'); const out = []; let i = 0;
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  let fence = false;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) fence = !fence;
    if (!fence && isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      while (i < lines.length && isRow(lines[i])) {
        const c = cells(lines[i]);
        const first = c[0] && /^#?\d+$/.test(head[0] || '') || /^#$/.test(head[0] || '') ? `*${c[0].replace(/^#/, '')}.* ` : (c[0] ? `• *${c[0]}*` + (c.length > 1 ? ': ' : '') : '• ');
        const rest = c.slice(1).map((x, k) => (head[k + 1] && !/^(why|what|description|details?|issue|problem|cause)/i.test(head[k + 1]) ? `${head[k + 1]}: ` : '') + x).filter(x => x.trim()).join(' — ');
        out.push(first + rest);
        i++;
      }
      continue;
    }
    out.push(l); i++;
  }
  return out.join('\n');
}

// ---------- brand notes only when the ask is about that brand (v9.6 round 3: RETAIN/Blossom colours leaked into church posts) ----------
const BRAND_HIT = /\b(brand palettes?|brand work|RETAIN|SalesPlat|Blossom)\b/i;
export function filterBrandHits(hits, text) {
  const t = String(text || '');
  const wants = /\b(retain|salesplat|mysalesplat|blossom|brand|my colou?rs|hrp|tst)\b/i.test(t);
  return wants ? hits : (hits || []).filter(h => !BRAND_HIT.test(String(h.title || '')));
}

// ---------- tidy "image:" lines in design answers (v9.6 prod sandbox: "(your picture bank)" inside a prompt, "no text status") ----------
// v9.6.3 (prod sandbox "draw me preaching on stage in a white agbada"): the model said it won't draw his face, then wrote
// "you standing at the podium…" inside the image: lines. On a self ask, clauses that put him (or a stand-in person) in the
// picture are dropped, so the scene stays empty where his real photo goes.
const SELF_CLAUSE = /\b(?:you|yourself|him|himself|michael|me|myself|preacher|pastor|minister|speaker|man|woman|person|figure|silhouette|someone)\b|\b(?:agbada|wearing|dressed|outfit|suit|kaftan)\b/i;
const KEEP_CLAUSE = /\b(?:for|where)\s+your\s+(?:photo|picture|headline|title|words)\b|\bempty space\b|\bno text\b/i;
export function dropSelfClauses(line) {
  const m = String(line).match(/^(.*?\bimage:\**\s*)(.*)$/i);
  if (!m) return line;
  const kept = m[2].split(/,\s*/).filter(c => KEEP_CLAUSE.test(c) || !SELF_CLAUSE.test(c));
  return m[1] + kept.join(', ');
}
export function fixImageLines(text, self = false) {
  return String(text || '').split('\n').map(l => {
    if (!/\bimage:/i.test(l)) return l;
    let s = l.replace(/\s*\((?:[^()]*\b(?:picture bank|your (?:own )?photo|michael)\b[^()]*)\)/ig, '');
    s = s.replace(/\bno text\s+(status|square|landscape)\b/ig, 'no text, $1');
    if (self) s = dropSelfClauses(s);
    return s;
  }).join('\n');
}

// ---------- never talk about the plumbing (v9.6.1 prod sandbox: "The pattern from the reference bank:") ----------
const INTERNAL = /\s*\(?\b(?:from|in|per|according to|using|based on)\s+(?:the|my|your)\s+(?:reference bank|know-?how(?: bank| notes)?|retrieved notes|notes|templates?(?: in my notes)?)\b\)?/gi;
export function scrubInternal(text) {
  return String(text || '').split(/(```[\s\S]*?(?:```|$))/).map((part, i) => i % 2 ? part : part   // code blocks untouched
    .replace(/\bThe reference bank has\b/gi, 'There are')
    .replace(INTERNAL, '')
    .replace(/\b(?:the\s+)?reference bank\b/gi, 'my notes')).join('');
}
