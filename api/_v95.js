// v9.5 (12 Oct 2026, Michael m:7b382ab1 "just train for now… especially when the time comes for coding and image generation").
// Pure helpers, no I/O:
//  - SKILLS_V95: stronger coding + image-prompt behaviour for every owner prompt (added after the v9.3 skills block).
//  - codeAsk / CODE_EXTRA: a coding message (error, stack trace, code, "fix my…") gets a focused checklist + more output room.
//  - promptAsk / PROMPT_EXTRA: "write me an image prompt / design idea" gets the prompt-craft format (ready "image: …" lines).
//  - imageFeedback: "again" / "brighter" / "make it more …" right after a picture -> redraw with the change.
//  - selfFace: an image ask that would draw MICHAEL himself -> never generated (his photos come from his Telegram picture bank).
//  - peopleNote: generated people are AI-made; the caption says so.
//  - splitFenced: WhatsApp message splitting that never breaks a ``` code block.
export const BUILD = 'v9.5';

export const SKILLS_V95 = `

# HOW TO THINK (v9.5)
- Hard asks (code, debugging, plans, numbers, designs): work it out privately step by step first: what does he really need, what are the facts, what could go wrong. Then check your answer once before sending: code read like a compiler, numbers twice, links and phone numbers exactly as you know them.
- Truly ambiguous AND the answer would change a lot (which app? which file? which size?): ask ONE short question, offering 2-3 likely options. Otherwise pick the most sensible reading, say your assumption in one line, and answer.
- Not sure? Say so plainly ("I'm not sure; check X" or "this may have changed, check the current docs"). Never invent links, prices, verses, API options, error codes or facts about people.
- Lead with the answer or the fix. Keep it as short as the job allows, then offer the next step he is likely to want.

# SKILLS v9.5: CODING (his stack: JavaScript/Node, React + Vite, Vercel serverless functions, Supabase SQL/RLS/edge functions, Android TWA/APK, WhatsApp Cloud API, Telegram bots, HTML/CSS/Tailwind, Python, git/GitHub)
- Bug with no error text: before guessing, ask for the exact error message (or a screenshot), the file it points to, and what he changed last. One short question, then stop. If the cause is obvious from what he sent, fix it straight away instead.
- Start with the fix in ONE plain line ("The crash is because data is undefined before the fetch finishes."), then the code, then how to run or deploy it in short numbered steps.
- Give COMPLETE, runnable files he can paste: imports, every function, no "..." or "rest of your code here". Put the file name in bold on its own line above each block, e.g. *api/webhook.js*. If only a few lines change in a big file, show the whole changed function and say exactly where it goes.
- Formatting for WhatsApp: code ONLY inside \`\`\` blocks (no language name after the backticks), short lines, no tables. Keep each block under about 60 lines; split longer code into *Part 1/2*, *Part 2/2*, each a complete block, never cutting a function in half.
- Secrets: never put keys or tokens in frontend code; use environment variables (Vercel env, Supabase secrets) and remind him to redeploy after changing them. Never ask him to paste a secret key in chat; if he does, tell him to rotate it.
- Be truthful about versions: if an API or setting may have changed, say "check the current docs" instead of inventing options. Prefer the simplest fix that works on the free plans he uses.
- Use the reference bank (know-how notes) for his stack's gotchas: Supabase RLS (empty results = missing policy), Vercel env vars + redeploy, Vite VITE_ prefix, WhatsApp webhook verify + reply 200 fast, Telegram getUpdates vs webhook, TWA assetlinks.json.

# SKILLS v9.5: IMAGES AND IMAGE PROMPTS
- When he wants a picture made, give the exact line to send, starting with "image:", written as one strong prompt: subject + action, setting, composition and camera (shot, angle, lens), lighting, style or medium, colours, mood, then the size word (status, square, landscape; portrait 4:5 is the default). Add "no text" and a clear empty area where his headline will go.
- Words, phone numbers, links and logos are added afterwards in Canva (AI pictures misspell words). Give the headline, key points and contact lines separately, ready to copy.
- Sizes: post 1080x1350 (4:5), WhatsApp Status / Reels / TikTok 1080x1920 (9:16, keep words in the middle safe area), square 1080x1080, YouTube thumbnail 1280x720 (16:9, "landscape").
- Nigerian looks: say "Nigerian" with natural dark skin tones and real settings (Lagos street, Akure, market umbrellas, danfo, church hall, ankara, gele), modern and dignified, no poverty stereotypes. Faith looks: reverent, hopeful, warm golden light, open Bible, sunrise; original characters only, no studio cartoon characters or logos.
- RETAIN (his client): colours red, white, yellow, navy blue (never yellow text on white); links www.mysalesplat.com/hrp (HR, never /hrt) and www.mysalesplat.com/tst (Tech Sales); phone numbers always 0703 886 7656 first, then 0903 739 9911. Put these real details on RETAIN flyers instead of blanks. Blossom colours only for Blossom work.
- Flyer words: use only real details (his stated links, numbers in his order, prices he gave); anything unknown is a [blank] for him to fill. Never invent benefits or guarantees for a client.
- Iterating: change one or two things per round and keep the rest of the prompt the same. Right after a picture he can just reply "again", "brighter", "make it more Nigerian", "less busy"… and the bot redraws it with that change.
- Honesty: people in generated pictures are AI-made, never real customers, staff or testimonials. NEVER generate Michael's own face or body: his own photos come only from his Telegram picture bank (he adds them in Canva or sends the photo). Do not generate real public figures.`;

// ---------- coding messages ----------
const CODE_WORDS = /\b(code|coding|debug|bug|bugs|error|errors|stack ?trace|exception|undefined|null pointer|crash(?:es|ed|ing)?|not working|doesn'?t work|won'?t (?:load|deploy|build|start|run)|failed to (?:compile|fetch|load)|javascript|typescript|js|jsx|tsx|node(?:\.?js)?|npm|npx|yarn|react|vite|next\.?js|vercel|supabase|postgres|sql|rls|edge function|webhook|api|endpoint|json|html|css|tailwind|python|pip|flask|django|git|github|commit|push|repo|deploy|deployment|function|component|useeffect|usestate|async|await|promise|fetch|axios|cors|env|\.env|apk|aab|twa|bubblewrap|pwabuilder|assetlinks|gradle|android studio|telegram bot|bot api|graph api|cloud api|regex|localhost|port|terminal|console|row[- ]level security|policy|policies|insert|upsert|query|schema|migration|column|vite\.config|package\.json|vercel\.json|manifest\.json|service worker|cron|getupdates|setwebhook|deletewebhook|play store|play console|url bar|address bar|keystore|fingerprint|sha-?256|signing key|status code|409|500 error|404 error|localhost|white screen|blank page|build failed)\b/i;
const CODE_SHAPE = /```|=>|\bconst\s+\w+\s*=|\bfunction\s+\w+\s*\(|\bimport\s+[\w{*]|\brequire\(|<\/?(div|html|body|script|button)\b|\bdef\s+\w+\(|\bSELECT\b[\s\S]*\bFROM\b|\b(TypeError|ReferenceError|SyntaxError|Uncaught|ERR_[A-Z_]+|ENOENT|ECONNREFUSED|EADDRINUSE|ModuleNotFoundError|IndentationError|Traceback|FUNCTION_INVOCATION_FAILED|status code \d{3}|\b[45]\d\d\b (?:error|bad request|unauthorized|forbidden|not found))\b|at \S+ \(\S+:\d+:\d+\)/;
const CODE_ASK = /\b(fix|write|build|make|create|add|change|explain|convert|refactor|optimi[sz]e|help me with)\b[\s\S]{0,60}\b(code|script|function|component|page|endpoint|api|webhook|bot|query|table|policy|form|app|site|website|landing page|button|navbar|login|signup)\b/i;
const NOT_CODE = /^\s*(build me|make me|create me)\s+(a|an|my)\s+(site|website|app|web app|landing page)\b/i;   // the build agent handles whole sites
export function codeAsk(text) {
  const t = String(text || '');
  if (t.trim().length < 6 || NOT_CODE.test(t)) return null;
  if (/\b(violates|row-level security policy|permission denied for|relation "[^"]+" does not exist|duplicate key value)\b/i.test(t)) return 'error';
  if (CODE_SHAPE.test(t)) return /```|=>|\bconst\s|\bfunction\s|\bimport\s|\bdef\s|<\/?\w/.test(t) && !/(Error|Traceback|Uncaught|ERR_|status code)/.test(t) ? 'code' : 'error';
  const words = (t.match(new RegExp(CODE_WORDS.source, 'gi')) || []).length;
  if (CODE_ASK.test(t) && words >= 1) return 'task';
  if (words >= 2) return 'task';
  if (words === 1 && /\b(error|bug|debug|not working|crash|code|coding|fails?|failed|failing|broken|violates)\b/i.test(t)) return 'task';
  return null;
}
const HAS_ERROR = /(Error|error:|Traceback|Uncaught|ERR_|exception|failed|status(?: code)? \d{3}|\b[45]\d\d\b|```)/;
export function CODE_EXTRA(kind, text = '') {
  const vague = kind === 'task' && /\b(not working|doesn'?t work|error|bug|crash|broken|failed|issue|problem)\b/i.test(text) && !HAS_ERROR.test(text);
  return `\n\n# THIS MESSAGE IS A CODING ASK (${kind === 'error' ? 'he pasted an error' : kind === 'code' ? 'he pasted code' : 'he wants code written or fixed'})\n`
    + (vague
      ? 'He says something is broken but sent no error text. Ask him, in one or two short lines, for the exact error message (copy it or screenshot it), which file or page it happens on, and what he changed last. If you can already see a likely cause, name it in one line too. Do not write a long guess.\n'
      : 'Answer like a senior developer who is also his friend: 1) the cause or the plan in ONE plain line; 2) the complete corrected file(s) in ``` blocks, file name in bold above each, nothing left out; 3) short numbered steps to run, test or deploy; 4) one line on how to check it worked. Read any error from the top line down and point at the exact line that causes it. Use the know-how notes when they match. Before you send, re-read every code block once as a compiler would: brackets and quotes closed, no leftover or duplicated lines, imports match what is used, nothing half-edited.\n')
    + 'Keep every code block under about 60 lines; label longer code *Part 1/2*, *Part 2/2*. No tables, no language names after the backticks.\n';
}

// ---------- image prompt writing ----------
const PROMPT_ASK = /\b(?:image|picture|photo|art|flyer|poster|thumbnail|design|midjourney|dall-?e|flux|ideogram|leonardo|canva ai|ai art|ai image|graphic|banner|status)\s*prompts?\b|\bprompts?\s+(?:for|to make|to generate|to create)\b[\s\S]{0,40}\b(?:image|picture|photo|flyer|poster|thumbnail|graphic|banner|art|design|status)\b|\b(?:write|give|craft|create|make|improve|fix)\s+(?:me\s+)?(?:a|an|the|my|some|\d+)?\s*(?:better\s+|good\s+|strong\s+)?prompts?\b|\b(?:design|flyer|poster|thumbnail) (?:idea|ideas|concept|concepts)\b|\bhow (?:do|can|should) i (?:design|make|create) (?:a|my|the)\s+(?:flyer|poster|thumbnail|banner|graphic)\b|\bhelp me (?:design|make|create|plan)\s+(?:a|an|my|the|our)?\s*(?:[\w'-]+\s+){0,2}(?:flyer|poster|thumbnail|banner|graphic|status graphic|cover)\b/i;
export const promptAsk = text => PROMPT_ASK.test(String(text || ''));
export const PROMPT_EXTRA = `\n\n# THIS MESSAGE: he wants image prompt(s) / a design idea\nGive 2 or 3 ready prompts, each on its own line starting with "image:" so he can copy and send it to make the picture. Each prompt: subject + action, setting, composition/camera, lighting, style, colours (his brand palette if named), mood, empty area for the headline, "no text", and a size word (status / square / landscape; default portrait 4:5). Label them *Option 1*, *Option 2*… with a 3-6 word name. Then, separately, the words to add in Canva (headline ≤7 words, 2-3 key lines, contact/CTA) if it is a flyer, thumbnail or status. Never invent offer details for a client or event (benefits, prices, dates, venues, guarantees): use the facts you have (links, numbers in his stated order, brand colours) and put [blank] placeholders for the rest. Any headline, tagline or subline you make up is marked _(suggested)_; never present a made-up subtitle, slogan or claim as his real one. Never put Michael's own face in a prompt: say his photo comes from his picture bank. Keep the whole answer short.\n`;

// ---------- redraw the last picture with feedback ----------
const FEEDBACK_START = /^\s*(?:ok(?:ay)?[,!.]?\s+|now\s+|pls\s+|please\s+|can you\s+|abeg\s+)?(again|redo|regenerate|another(?: one| version| take)?|one more|try again|new version|same (?:but|with|again)|(?:make|do) (?:it|the (?:picture|image|pic|photo|background|colou?rs?|sky|light(?:ing)?|man|woman|lady|people|person|boy|girl|bible|text area))\s+|(?:more|less)\s+(?:bright|dark|colou?rful|vibrant|nigerian|african|realistic|cartoon(?:y)?|modern|minimal|busy|detail(?:ed)?|contrast|light|space|warm|cool|red|yellow|navy|blue|gold|green|people|dramatic|professional|premium|classic|fun|playful|serious|reverent|joyful|happy|clean|simple|empty space|zoom(?:ed)?)\b|brighter|darker|warmer|cooler|bigger|smaller|wider|closer|simpler|cleaner|busier|happier|change (?:the|it)|add (?:a|an|some|more)\s+\w+|remove (?:the|that)\s+\w+|use (?:red|white|yellow|navy|blue|green|gold|black|purple|pink|orange|brand|retain|blossom|my brand)\b|in (?:status|square|landscape|portrait)(?: size)?\b|as (?:status|square|landscape|portrait)\b)/i;
const NOT_FEEDBACK = /\b(post|caption|reminder|remind|email|letter|reply|newsletter|code|website|site|app)\b/i;
// -> null | { prompt, width, height, shape }  (only within 30 min of a picture, and never while a post draft is waiting)
export function imageFeedback(text, last, { now = Date.now(), pending = false } = {}) {
  const t = String(text || '').trim();
  if (!last || !last.prompt || pending || now - (last.at || 0) > 30 * 60e3) return null;
  if (t.length > 220 || !FEEDBACK_START.test(t) || NOT_FEEDBACK.test(t)) return null;
  let w = last.width || 1080, h = last.height || 1350, shape = last.shape || 'portrait 4:5';
  const low = t.toLowerCase();
  if (/\b(status|story|9:16|reel)\b/.test(low)) { w = 1080; h = 1920; shape = 'status 9:16'; }
  else if (/\b(square|1:1)\b/.test(low)) { w = 1080; h = 1080; shape = 'square'; }
  else if (/\b(landscape|16:9|wide|thumbnail)\b/.test(low)) { w = 1920; h = 1080; shape = 'landscape 16:9'; }
  else if (/\bportrait\b/.test(low)) { w = 1080; h = 1350; shape = 'portrait 4:5'; }
  const change = t.replace(/^\s*(?:ok(?:ay)?[,!.]?\s+|now\s+|pls\s+|please\s+|can you\s+|abeg\s+)/i, '').replace(/^(again|redo|regenerate|try again|one more|new version|another(?: one| version| take)?)\b[\s,.:!-]*/i, '').trim();
  const base = String(last.base || last.prompt).replace(/\s*\(change:[^)]*\)\s*$/i, '');
  const prompt = change ? `${base}, ${feedbackPhrase(change)}` : base;
  return { prompt: prompt.slice(0, 900), width: w, height: h, shape, base, change: change || 'new variation' };
}
const FEEDBACK_MAP = [
  [/\bbrighter\b|\bmore light\b|\btoo dark\b/i, 'bright high-key lighting, lighter overall exposure'],
  [/\bdarker\b|\bmoodier\b|\btoo bright\b/i, 'darker, moodier low-key lighting'],
  [/\bwarmer\b/i, 'warm golden tones'], [/\bcooler\b/i, 'cool blue tones'],
  [/\bless busy\b|\bsimpler\b|\bcleaner\b|\bminimal\b|\btoo busy\b/i, 'minimal, uncluttered, plain background, fewer elements'],
  [/\bmore nigerian\b|\bnigerian\b|\bnaija\b/i, 'clearly Nigerian people with natural dark skin tones and a contemporary Nigerian setting'],
  [/\bretain\b|\bbrand colou?rs?\b|\bmy brand\b/i, 'RETAIN brand palette: navy blue, red, yellow accents and white'],
  [/\bcloser\b|\bclose[- ]?up\b/i, 'close-up shot'], [/\bwider\b|\bzoom out\b/i, 'wide shot with more of the setting'],
];
export function feedbackPhrase(change) {
  const c = String(change || '').trim();
  const extra = FEEDBACK_MAP.filter(([re]) => re.test(c)).map(([, p]) => p);
  return [c.replace(/^make (?:it|the \w+)\s+/i, '').replace(/[.!]+$/, ''), ...extra].filter(Boolean).join(', ');
}

// ---------- Michael's own face is never generated ----------
const POSE = '(?:standing|sitting|smiling|holding|preaching|praying|wearing|in|on|at|as|with|looking|speaking|teaching|walking|dancing|posing|laughing|singing|working|coding)';
const SELF_RE = new RegExp(String.raw`\b(?:of|showing|with|featuring|feature|starring)\s+(?:me|myself|(?:olaoluwa\s+)?michael|olaoluwa)\b|\b(?:me|myself|olaoluwa|michael)\s+${POSE}\b|\b(?:my|olaoluwa'?s|michael'?s)\s+(?:own\s+)?(?:face|photo|picture|pic|portrait|selfie|headshot|likeness)\b|\bpicture bank\b|\b(?:using|use|with) my (?:pictures|photos|pics)\b`, 'i');
export function selfFace(prompt) {
  const p = String(prompt || '');
  if (/\barchangel michael\b|\bst\.? michael\b|\bsaint michael\b/i.test(p)) return false;
  return SELF_RE.test(p);
}
export const SELF_FACE_REPLY = '📸 I don\'t draw *your* face with AI. Your own photos come from your picture bank on Telegram.\n\nWhat I can do now: make the background or scene *without* you, with space for your photo, then you drop your picture in with Canva. Send it like:\n_image: clean modern flyer background, navy and gold, soft light, empty space on the right for a portrait, no text_';
export function withoutSelf(prompt) {
  return String(prompt || '').replace(/\b(?:of|showing|with|featuring)\s+(?:me|myself)\b/ig, '').replace(/\bmy\s+(?:own\s+)?(?:face|photo|picture|pic|portrait|selfie|headshot)\b/ig, '').replace(/\s{2,}/g, ' ').trim();
}

// ---------- generated people are AI-made ----------
const PEOPLE_RE = /\b(man|men|woman|women|lady|ladies|girl|girls|boy|boys|child|children|kid|kids|person|people|family|couple|pastor|student|students|worker|workers|customer|customers|team|staff|youth|congregation|crowd|face|portrait|businessman|businesswoman|entrepreneur|teacher|doctor|nurse|mother|father|mum|dad|baby)\b/i;
export const peopleNote = prompt => PEOPLE_RE.test(String(prompt || '')) ? '\n_The people in it are AI-made, not real: don\'t present them as real customers or testimonials._' : '';

// ---------- brand looks added to the image prompt ----------
export function brandStyle95(prompt) {
  const p = String(prompt || ''); let s = '';
  if (/\b(retain|salesplat|mysalesplat)\b/i.test(p)) s += ', RETAIN brand palette: deep navy blue, bold red, bright yellow accents and white, corporate and confident';
  if (/\b(nigeria|nigerian|naija|lagos|akure|abuja|ibadan|yoruba|igbo|hausa|ankara|gele|aso[- ]?oke|agbada|danfo|keke|owambe)\b/i.test(p)) s += ', authentic contemporary Nigerian setting, Black Nigerian people with natural dark skin tones and real skin texture, dignified, no stereotypes';
  return s;
}

// ---------- WhatsApp splitting that keeps ``` blocks whole ----------
export function splitFenced(t, max = 3500) {
  const out = []; let rest = String(t || '');
  while (rest.length > max) {
    let cut = -1;
    // prefer: a blank line OUTSIDE a code block; else the end of a line inside one (then close + reopen the fence)
    const fenceOpenAt = i => ((rest.slice(0, i).match(/```/g) || []).length % 2) === 1;
    for (let i = rest.lastIndexOf('\n\n', max); i > max * 0.4; i = rest.lastIndexOf('\n\n', i - 1)) if (!fenceOpenAt(i)) { cut = i; break; }
    if (cut < 0) { const i = rest.lastIndexOf('\n', max); cut = i > max * 0.4 ? i : max; }
    let head = rest.slice(0, cut).replace(/\s+$/, ''); let tail = rest.slice(cut).replace(/^\n+/, '');
    if (fenceOpenAt(cut)) { head += '\n```'; tail = '```\n' + tail; }
    out.push(head.trim()); rest = tail;
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}
