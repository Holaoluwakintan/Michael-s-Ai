#!/usr/bin/env python3
"""v8 knowledge index builder for Michael AI ("knows his world").
Reads his letters (letters.csv, spare-letters.csv, old-100-mondays deduped by title), his 6 book manuscripts
(files/newsletter/books/*.txt, ~2,200-char passages), tools/book-overviews.json (one whole-book summary each, made with
flash-lite) and tools/projects.md (public project facts + links, no secrets). Embeds with gemini-embedding-001
(768 dims, RETRIEVAL_DOCUMENT, free tier ~100 items/min -> backs off on 429) and inserts into Supabase
michael_ai.kchunks (ns 'wa') through the Management API. Idempotent: rows are keyed by a hash of (src, body);
embeddings are cached in tools/.emb-cache.pkl. The collected-works PDF is the same 5 books, so it is skipped.
Env/files: /home/user/tab/files/.michael-gemini.env (GEMINI_API_KEY), .voicepad-supabase-pat.env (SUPABASE_PAT).
Usage: python3 tools/kb-index.py [--dry]
"""
import csv, hashlib, json, os, pickle, re, sys, time, requests
F = '/home/user/tab/files/'; N = F + 'newsletter/'; HERE = os.path.dirname(os.path.abspath(__file__)); PROJ = 'rlbrhpjljjgpqpqjrpkc'
def env(p):
    d = {}
    for l in open(p):
        if '=' in l and not l.strip().startswith('#'):
            k, v = l.strip().split('=', 1); d[k.replace('export ', '').strip()] = v.strip().strip('"\'')
    return d
K = env(F + '.michael-gemini.env')['GEMINI_API_KEY']; PAT = env(F + '.voicepad-supabase-pat.env')['SUPABASE_PAT']
SECRET = re.compile(r'(AIza[0-9A-Za-z_\-]{20,}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_\-]{20,}\.|ghp_[A-Za-z0-9]{20,}|xkeysib-|password\s*[:=]|api[_ ]?key\s*[:=]|secret\s*[:=])', re.I)
BOOKS = {'01-twisted': 'Twisted', '02-balm-of-gilead': 'Balm of Gilead', '03-golgotha': 'Golgotha', '04-queen-esther-the-cult-leader': 'Queen Esther: The Cult Leader', '05-crack-the-algorithm': 'Crack the Algorithm', '05b-crack-the-algorithm-part-2': 'Crack the Algorithm (Part 2)'}
def split(t, size=2200, overlap=150):
    paras = [p.strip() for p in re.split(r'\n\s*\n|\n(?=[A-Z])', t) if p.strip()]; out = []; cur = ''
    for p in paras:
        if len(p) > size:
            if cur: out.append(cur); cur = ''
            out += [p[i:i + size] for i in range(0, len(p), size - overlap)]; continue
        if cur and len(cur) + len(p) + 1 > size: out.append(cur); cur = cur[-overlap:] + '\n' + p
        else: cur = cur + '\n' + p if cur else p
    if cur.strip(): out.append(cur)
    return out
chunks = []
def add(src, title, body, url=None, salt=''):
    body = body.strip()
    if len(body) < 80 or SECRET.search(body): return
    chunks.append(dict(src=src, title=title[:200], url=url, body=body, h=hashlib.sha256(((salt or src) + '|' + body).encode()).hexdigest()[:40]))
def letter(r, label): return f"{label}: \"{r['title']}\" (book: {r.get('book','')}). Verse: {r.get('verse_ref','')} ({r.get('translation','KJV')}): {r.get('verse_text','')}\n\n{r['body']}\n\nPromise: {r.get('promise','')}\n{r.get('signoff','')}"
titles = set()
for r in csv.DictReader(open(N + 'letters.csv')): titles.add(r['title'].strip().lower()); add('letters', r['title'], letter(r, f"Monday & Friday Letter #{r['slot']} ({r['day']} {r['date']})"))
for r in csv.DictReader(open(N + 'spare-letters.csv')): titles.add(r['title'].strip().lower()); add('spare-letters', r['title'], letter(r, 'Spare Monday letter'))
for r in csv.DictReader(open(N + 'old-100-mondays/monday-letters.csv', encoding='utf-8-sig')):
    if r['title'].strip().lower() not in titles: add('monday-letters', r['title'], letter(r, f"Old Monday Letter week {r['week']}"))
for slug, name in BOOKS.items():
    for i, p in enumerate(split(open(N + f'books/{slug}.txt').read())): add('book:' + slug.split('-', 1)[1], f'{name} (excerpt {i + 1})', f'From Michael\'s book "{name}":\n' + p)
ov = json.load(open(os.path.join(HERE, 'book-overviews.json')))
for slug, txt in ov.items():
    if slug in BOOKS: body = f'Overview of Michael\'s book "{BOOKS[slug]}" (whole-book summary):\n' + txt.strip(); add('book:' + slug.split('-', 1)[1], f'{BOOKS[slug]} — book overview', body, salt='overview')
for sec in re.split(r'\n(?=## )', open(os.path.join(HERE, 'projects.md')).read()):
    if sec.startswith('## '):
        urls = re.findall(r'https://\S+', sec); add('projects', sec.split('\n', 1)[0][3:], "Michael's project — " + sec[3:], urls[0].rstrip('.') if urls else None)
print(len(chunks), 'chunks')
if '--dry' in sys.argv: sys.exit()
cp = os.path.join(HERE, '.emb-cache.pkl'); embs = pickle.load(open(cp, 'rb')) if os.path.exists(cp) else {}
todo = [c for c in chunks if c['h'] not in embs]; i = 0
while i < len(todo):
    b = todo[i:i + 20]
    r = requests.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents', headers={'x-goog-api-key': K}, json={'requests': [{'model': 'models/gemini-embedding-001', 'content': {'parts': [{'text': c['body'][:8000]}]}, 'taskType': 'RETRIEVAL_DOCUMENT', 'title': c['title'], 'outputDimensionality': 768} for c in b]}, timeout=120)
    if r.status_code == 429: print('429, waiting'); time.sleep(65); continue
    r.raise_for_status()
    for c, e in zip(b, r.json()['embeddings']): embs[c['h']] = e['values']
    i += 20; pickle.dump(embs, open(cp, 'wb')); print('embedded', i, '/', len(todo))
q = lambda s: "'" + s.replace("'", "''") + "'"
for i in range(0, len(chunks), 40):
    vals = ',\n'.join(f"('wa',{q(c['src'])},{q(c['title'])},{q(c['url']) if c['url'] else 'null'},{q(c['body'])},{q(c['h'])},{q('[' + ','.join(f'{x:.6f}' for x in embs[c['h']]) + ']')}::extensions.vector)" for c in chunks[i:i + 40])
    r = requests.post(f'https://api.supabase.com/v1/projects/{PROJ}/database/query', headers={'Authorization': 'Bearer ' + PAT}, json={'query': f'insert into michael_ai.kchunks(ns,src,title,url,body,h,emb) values {vals} on conflict (ns,h) do nothing'}, timeout=120)
    r.raise_for_status()
print('done')
