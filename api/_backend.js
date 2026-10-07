// v7: SITES WITH A BACKEND. Built sites get a small client (mai.js) that talks to the bot's own /api/site-data endpoint.
// Data lives in Supabase (michael_ai.site_data / site_users) through the michael_ai_jobs RPC; no service key ever reaches a browser.
// Each site has a public site key (identifies the site) and a server-side schema: only declared fields are stored, every value is
// type-checked and length-capped, honeypot + time-to-fill catch bots, and per-IP / per-day limits stop floods.
import crypto from 'node:crypto';

export const KINDS = ['order', 'booking', 'contact', 'signup', 'entry', 'score', 'item'];
export const NOTIFY_KINDS = ['order', 'booking', 'contact'];          // the owner gets a WhatsApp ping for each new one
export const PUBLIC_KINDS = ['entry', 'score'];                        // readable by visitors (public fields only)
export const TYPES = ['text', 'long', 'email', 'phone', 'number', 'date', 'time', 'choice', 'bool', 'url'];
const CAP = { text: 200, long: 2000, email: 120, phone: 24, url: 300, date: 10, time: 5, choice: 80 };
export const LIMITS = { ipWrites10m: 8, ipScores10m: 30, ipAuth10m: 10, siteDay: 500, maxBody: 8000, minFillMs: 1500 };
const slug = (s, max = 24) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);

// ---------- 1. does the request need a backend? ----------
export const BACKEND_HINT = /\b(orders?\s*(?:form|online|now|page)|order(?:s|ing)?\b(?!\s+to\b)|bookings?|book\s+(?:a|an|your|now|online)|appointment|reserv(?:e|ation)|rsvp|contact\s*form|enquir(?:y|ies)|inquir(?:y|ies)|get\s+in\s+touch|message\s+(?:us|form)|guest\s*book|comments?|reviews?|testimon(?:y|ies|ials)\s+wall|leader\s*board|high\s*scores?|to-?\s*do|todo|task\s+list|log\s*in|sign\s*(?:up|in)|accounts?|members?\s+area|waitlist|wait\s+list|newsletter|subscribe|register(?:ation)?|prayer\s+requests?|save[sd]?\s+(?:data|online)|database|backend|checkout|pay(?:ment|stack)?)\b/i;
export function wantsBackend(brief) { return BACKEND_HINT.test(String(brief || '')); }

// ---------- 2. clean the plan's backend block (the model proposes, this decides) ----------
export function cleanBackend(b) {
  if (!b || typeof b !== 'object') return null;
  const cols = [];
  for (const c of (Array.isArray(b.collections) ? b.collections : []).slice(0, 4)) {
    if (!c || typeof c !== 'object') continue;
    const name = slug(c.name || c.kind, 20);
    let kind = String(c.kind || '').toLowerCase();
    if (!KINDS.includes(kind)) kind = /order|cart|buy/.test(name) ? 'order' : /book|appoint|reserv/.test(name) ? 'booking' : /score|leader/.test(name) ? 'score' : /todo|task|note/.test(name) ? 'item' : /guest|comment|review|wall/.test(name) ? 'entry' : /sub|wait|rsvp|regist/.test(name) ? 'signup' : 'contact';
    if (!name || cols.some(x => x.name === name)) continue;
    const fields = [];
    for (const f of (Array.isArray(c.fields) ? c.fields : []).slice(0, 14)) {
      const fname = slug(typeof f === 'string' ? f : f?.name, 24);
      if (!fname || fname.startsWith('_') || fields.some(x => x.name === fname) || ['id', 'created', 'status', 'uid', 'hp', 'key'].includes(fname)) continue;
      let type = String(f?.type || '').toLowerCase();
      if (!TYPES.includes(type)) type = /email/.test(fname) ? 'email' : /phone|tel|whatsapp|mobile/.test(fname) ? 'phone' : /date|day/.test(fname) ? 'date' : /time/.test(fname) ? 'time' : /qty|quantity|amount|score|guests|people|number|count|age/.test(fname) ? 'number' : /message|note|details|address|comment|review|request|items|order/.test(fname) ? 'long' : 'text';
      const field = { name: fname, type, required: !!f?.required };
      if (type === 'choice') field.options = (Array.isArray(f.options) ? f.options : []).map(o => String(o).slice(0, 60)).filter(Boolean).slice(0, 20);
      if (type === 'choice' && !field.options.length) field.type = 'text';
      if (type === 'number') { field.min = Number.isFinite(+f.min) ? +f.min : (kind === 'score' ? 0 : 0); field.max = Number.isFinite(+f.max) ? +f.max : 1e7; }
      fields.push(field);
    }
    if (kind === 'score' && !fields.some(x => x.name === 'score')) fields.unshift({ name: 'score', type: 'number', required: true, min: 0, max: 1e6 });
    if (kind === 'score' && !fields.some(x => x.name === 'name')) fields.unshift({ name: 'name', type: 'text', required: true });
    if (!fields.length) continue;
    const col = { name, kind, fields, label: String(c.label || c.name || name).slice(0, 40) };
    if (PUBLIC_KINDS.includes(kind)) col.public = fields.filter(x => !['email', 'phone'].includes(x.type)).map(x => x.name);
    cols.push(col);
  }
  if (!cols.length && !b.auth) return null;
  const auth = !!b.auth || cols.some(c => c.kind === 'item');
  return { collections: cols, auth, payments: !!b.payments && cols.some(c => c.kind === 'order' || c.kind === 'booking') };
}

// ---------- 3. server-side validation ----------
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
export function cleanStr(v, max) { return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max); }
export function validate(col, input) {
  const errors = [], out = {};
  if (!col) return { ok: false, errors: ['unknown form'] };
  const data = input && typeof input === 'object' ? input : {};
  for (const f of col.fields) {
    let v = data[f.name];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) { if (f.required) errors.push(`${f.name} is required`); continue; }
    if (Array.isArray(v)) v = v.join(', ');
    switch (f.type) {
      case 'number': { const n = Number(String(v).replace(/[,\s₦]/g, '')); if (!Number.isFinite(n)) { errors.push(`${f.name} must be a number`); break; } if (n < (f.min ?? -1e12) || n > (f.max ?? 1e12)) { errors.push(`${f.name} is out of range`); break; } out[f.name] = Math.round(n * 100) / 100; break; }
      case 'email': { const s = cleanStr(v, CAP.email); if (!EMAIL.test(s)) errors.push(`${f.name} must be an email`); else out[f.name] = s; break; }
      case 'phone': { const s = cleanStr(v, CAP.phone); const d = s.replace(/\D/g, ''); if (d.length < 7 || d.length > 15 || /[^\d+\s().-]/.test(s)) errors.push(`${f.name} must be a phone number`); else out[f.name] = s; break; }
      case 'url': { const s = cleanStr(v, CAP.url); if (!/^https?:\/\/[^\s<>"]+$/i.test(s)) errors.push(`${f.name} must be a link`); else out[f.name] = s; break; }
      case 'date': { const s = cleanStr(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) errors.push(`${f.name} must be a date`); else out[f.name] = s; break; }
      case 'time': { const s = cleanStr(v, 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) errors.push(`${f.name} must be a time`); else out[f.name] = s; break; }
      case 'bool': out[f.name] = v === true || /^(true|on|yes|1)$/i.test(String(v)); break;
      case 'choice': { const s = cleanStr(v, CAP.choice); const hit = f.options.find(o => o.toLowerCase() === s.toLowerCase()); if (!hit) errors.push(`${f.name} must be one of the options`); else out[f.name] = hit; break; }
      default: { const s = cleanStr(v, f.type === 'long' ? CAP.long : CAP.text); if (s) out[f.name] = s; else if (f.required) errors.push(`${f.name} is required`); }
    }
  }
  return { ok: !errors.length, data: out, errors };
}
export function publicRow(col, row) {
  const keep = col.public || [];
  const d = {}; for (const k of keep) if (row.data?.[k] != null) d[k] = row.data[k];
  return { id: row.id, data: d, created: row.created };
}

// ---------- 4. logins (per site): scrypt password hashes, HMAC tokens ----------
export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `s1$${salt}$${h}`;
}
export function checkPassword(pw, stored) {
  const [v, salt, h] = String(stored || '').split('$');
  if (v !== 's1' || !salt || !h) return false;
  const a = Buffer.from(hashPassword(pw, salt).split('$')[2], 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const authSecret = () => process.env.SITE_AUTH_SECRET || crypto.createHmac('sha256', String(process.env.SCHED_KEY || 'mai-dev')).update('mai-site-auth-v1').digest('hex');
export function signToken(siteKey, uid, username, days = 30, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ k: siteKey, u: uid, n: username, e: Math.floor(now / 1000) + days * 86400 })).toString('base64url');
  const sig = crypto.createHmac('sha256', authSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(token, siteKey, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', authSecret()).update(body).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(body, 'base64url').toString()); if (j.k !== siteKey || j.e * 1000 < now) return null; return { uid: j.u, username: j.n }; } catch { return null; }
}
export const USER_RE = /^[a-z0-9_.@-]{3,40}$/;
export const newSiteKey = () => 'sk_' + crypto.randomBytes(12).toString('base64url');
export const ipHash = ip => crypto.createHmac('sha256', authSecret()).update(String(ip || '')).digest('hex').slice(0, 16);

// ---------- 5. origin check: only the site's own Vercel URLs may call ----------
export function originOk(origin, site) {
  if (!origin || !site) return false;
  let host; try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const proj = String(site.project || '').toLowerCase();
  let siteHost = ''; try { siteHost = new URL(site.url).host.toLowerCase(); } catch {}
  if (host === siteHost) return true;
  if (proj && (host === `${proj}.vercel.app` || (host.startsWith(proj + '-') && host.endsWith('.vercel.app')))) return true;
  return false;
}

// ---------- 6. owner messages ----------
const lagos = t => new Date(new Date(t).getTime() + 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const KIND_ICON = { order: '🛒', booking: '📅', contact: '✉️', signup: '📝', entry: '💬', score: '🏆', item: '🗒️' };
const KIND_WORD = { order: 'order', booking: 'booking', contact: 'message', signup: 'sign-up', entry: 'entry', score: 'score', item: 'item' };
export function rowLines(data, max = 8) {
  return Object.entries(data || {}).filter(([k]) => !k.startsWith('_')).slice(0, max).map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${String(v).replace(/\s+/g, ' ').slice(0, 160)}`);
}
export function notifyText(site, col, row) {
  return [`${KIND_ICON[col.kind] || '🔔'} *New ${KIND_WORD[col.kind] || col.kind}* on *${site.title || site.slug}* (#${row.id})`, ...rowLines(row.data),
    row.data?._paid ? `💰 Paid: ₦${row.data._paid}` : '', '', `See all: *orders ${site.slug}* · CSV: *export ${site.slug}*`].filter(x => x !== '').join('\n');
}
export function ordersText(site, rows, { title = 'Orders & bookings' } = {}) {
  if (!rows.length) return `📭 No orders, bookings or messages on *${site.title || site.slug}* yet.\nShare the link: ${site.url}`;
  const lines = [`🧾 *${title}: ${site.title || site.slug}* (latest ${rows.length})`];
  for (const r of rows) {
    lines.push('', `${KIND_ICON[r.kind] || '•'} *#${r.id}* ${r.status === 'new' ? '🆕 ' : ''}${r.data?._paid ? '💰 paid ' : ''}_${lagos(r.created)}_`, ...rowLines(r.data, 6));
  }
  lines.push('', `CSV of everything: *export ${site.slug}*`);
  return lines.join('\n');
}
export function dataText(site, counts, samples = {}, users = 0) {
  if (!counts.length && !users) return `📭 *${site.title || site.slug}* has no saved data yet.\n${site.url}`;
  const lines = [`🗄️ *Data on ${site.title || site.slug}*`];
  for (const c of counts) {
    lines.push('', `${KIND_ICON[c.kind] || '•'} *${c.coll}*: ${c.total}${c.new_count ? ` (${c.new_count} new)` : ''}`);
    for (const r of (samples[c.coll] || []).slice(0, 3)) lines.push(`   #${r.id} ${Object.values(r.data || {}).filter(v => typeof v !== 'object').slice(0, 3).map(v => String(v).slice(0, 40)).join(' · ')}`);
  }
  if (users) lines.push('', `👤 Accounts: ${users}`);
  lines.push('', `*orders ${site.slug}* · *export ${site.slug}* (CSV)`);
  return lines.join('\n');
}

// ---------- 7. CSV export ----------
const csvCell = v => { let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(rows) {
  const fields = [];
  for (const r of rows) for (const k of Object.keys(r.data || {})) if (!fields.includes(k)) fields.push(k);
  const head = ['id', 'date (Lagos)', 'form', 'status', ...fields];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push([r.id, lagos(r.created), r.coll, r.status, ...fields.map(f => r.data?.[f])].map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------- 8. Paystack (built, OFF until PAYSTACK_PUBLIC_KEY + PAYSTACK_SECRET_KEY are set) ----------
export const paymentsOn = () => /^pk_(test|live)_/.test(process.env.PAYSTACK_PUBLIC_KEY || '') && /^sk_(test|live)_/.test(process.env.PAYSTACK_SECRET_KEY || '');
export async function paystackVerify(reference, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  const d = j.data || {};
  return { ok: r.ok && j.status === true && d.status === 'success', amount: (d.amount || 0) / 100, currency: d.currency, reference: d.reference, email: d.customer?.email, metadata: d.metadata || {} };
}

// ---------- 9. the client library every backend site gets as mai.js ----------
export function clientJs({ api, key, backend }) {
  const cfg = { api, key, cols: Object.fromEntries((backend?.collections || []).map(c => [c.name, { kind: c.kind, fields: c.fields.map(f => f.name) }])), auth: !!backend?.auth, pay: !!backend?.payments };
  return `/* mai.js: backend for this site, by Michael AI. Data is saved securely on the server. */
(function(){'use strict';
var C=${JSON.stringify(cfg)};var T0=Date.now();var TK='mai_tok_'+C.key.slice(-6);var PAY=null;
function tok(){try{return localStorage.getItem(TK)||''}catch(e){return ''}}
function setTok(t,u){try{if(t){localStorage.setItem(TK,t);localStorage.setItem(TK+'_u',u||'')}else{localStorage.removeItem(TK);localStorage.removeItem(TK+'_u')}}catch(e){}}
function call(op,body){body=body||{};body.key=C.key;body.op=op;var t=tok();if(t)body.token=t;
 return fetch(C.api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{ok:false,error:'Server error ('+r.status+')'}})}).catch(function(){return{ok:false,error:'No connection. Check your data and try again.'}})}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var MAI={config:C,
 add:function(coll,data,extra){var b={coll:coll,data:data||{},t:Date.now()-T0};if(extra)for(var k in extra)b[k]=extra[k];return call('add',b)},
 list:function(coll,opts){opts=opts||{};return call('list',{coll:coll,limit:opts.limit||30}).then(function(r){return r.ok?r.rows:[]})},
 update:function(id,data,coll){return call('update',{id:id,data:data,coll:coll})},
 remove:function(id,coll){return call('remove',{id:id,coll:coll})},
 signup:function(u,p){return call('signup',{username:u,password:p}).then(function(r){if(r.ok)setTok(r.token,r.username);refreshAuth();return r})},
 login:function(u,p){return call('login',{username:u,password:p}).then(function(r){if(r.ok)setTok(r.token,r.username);refreshAuth();return r})},
 logout:function(){setTok('');refreshAuth()},
 user:function(){var t=tok();if(!t)return null;try{return localStorage.getItem(TK+'_u')||'me'}catch(e){return 'me'}},
 payments:function(){if(!PAY)PAY=fetch(C.api+'?op=config&key='+encodeURIComponent(C.key)).then(function(r){return r.json()}).catch(function(){return{payments:false}});return PAY},
 pay:function(o){return MAI.payments().then(function(cf){if(!cf.payments||!cf.public_key)return{ok:false,soon:true,error:'Payments coming soon'};
  return new Promise(function(res){function go(){try{var p=new window.PaystackPop();p.newTransaction({key:cf.public_key,email:o.email,amount:Math.round(+o.amount*100),currency:'NGN',metadata:{order_id:o.id,site:C.key},
   onSuccess:function(tx){call('verify',{reference:tx.reference,id:o.id,coll:o.coll}).then(res)},onCancel:function(){res({ok:false,error:'Payment cancelled'})}})}catch(e){res({ok:false,error:'Payment could not start'})}}
   if(window.PaystackPop)go();else{var s=document.createElement('script');s.src='https://js.paystack.co/v2/inline.js';s.onload=go;s.onerror=function(){res({ok:false,error:'Payment could not load'})};document.head.appendChild(s)}})})}
};
window.MAI=MAI;
function status(form,msg,ok){var el=form.querySelector('[data-mai-status]');if(!el){el=document.createElement('p');el.setAttribute('data-mai-status','');el.setAttribute('role','status');form.appendChild(el)}el.textContent=msg;el.className=(el.className||'').replace(/\\bmai-(ok|err)\\b/g,'')+' '+(ok?'mai-ok':'mai-err')}
function formData(form){var d={};var els=form.elements;for(var i=0;i<els.length;i++){var e=els[i];if(!e.name||e.name==='_hp'||e.disabled||e.type==='submit'||e.type==='button')continue;
 if(e.type==='checkbox'){if(e.checked)d[e.name]=d[e.name]?d[e.name]+', '+e.value:(e.value&&e.value!=='on'?e.value:true)}else if(e.type==='radio'){if(e.checked)d[e.name]=e.value}else if(e.value!=='')d[e.name]=e.value}return d}
function honeypot(form){if(form.querySelector('input[name=_hp]'))return;var w=document.createElement('div');w.setAttribute('aria-hidden','true');w.style.cssText='position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
 w.innerHTML='<label>Leave empty<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label>';form.appendChild(w)}
function wireForm(form){var coll=form.getAttribute('data-mai-form');honeypot(form);form.addEventListener('submit',function(ev){ev.preventDefault();var btn=form.querySelector('[type=submit],button:not([type])');if(btn)btn.disabled=true;
 var hp=form.querySelector('input[name=_hp]');var data=formData(form);status(form,'Sending…',true);
 MAI.add(coll,data,{hp:hp?hp.value:''}).then(function(r){if(!r.ok){status(form,r.error||'Something went wrong. Try again.',false);if(btn)btn.disabled=false;return}
  var done=form.getAttribute('data-mai-success')||'✅ Received! Thank you.';
  var wantPay=form.hasAttribute('data-mai-pay');var amt=+(data.amount||form.getAttribute('data-mai-amount')||0);
  if(wantPay&&amt>0&&data.email){MAI.pay({id:r.id,coll:coll,email:data.email,amount:amt}).then(function(p){status(form,p.ok?'✅ Paid! Your order #'+r.id+' is confirmed.':(p.soon?done+' Online payment is coming soon; we will contact you to pay.':done+' ('+p.error+')'),true);if(btn)btn.disabled=false;form.reset()})}
  else{status(form,done+(wantPay?' Online payment is coming soon; we will contact you to pay.':''),true);if(btn)btn.disabled=false;form.reset()}
  refreshLists(coll)})})}
function renderRows(el,rows,coll){var kind=(C.cols[coll]||{}).kind;var f=(el.getAttribute('data-mai-fields')||'').split(',').filter(Boolean);
 if(!rows.length){el.innerHTML='<p class="mai-empty">'+esc(el.getAttribute('data-mai-empty')||'Nothing here yet. Be the first!')+'</p>';return}
 el.innerHTML=rows.map(function(r,i){var d=r.data||{};var keys=f.length?f:Object.keys(d);
  if(kind==='score')return '<div class="mai-row mai-score"><span class="mai-rank">'+(i+1)+'</span><span class="mai-name">'+esc(d.name||'Player')+'</span><b class="mai-points">'+esc(d.score)+'</b></div>';
  return '<div class="mai-row">'+keys.map(function(k){var v=d[k];if(/^(rating|stars?)$/i.test(k)&&+v>=1&&+v<=5)v=new Array(Math.round(+v)+1).join('\u2b50');return '<div class="mai-'+esc(k)+'">'+esc(v)+'</div>'}).join('')+'<small class="mai-date">'+esc(new Date(r.created).toLocaleDateString())+'</small></div>'}).join('')}
function refreshLists(only){var els=document.querySelectorAll('[data-mai-list]');for(var i=0;i<els.length;i++){(function(el){var coll=el.getAttribute('data-mai-list');if(only&&only!==coll)return;
 MAI.list(coll,{limit:+(el.getAttribute('data-mai-limit')||20)}).then(function(rows){renderRows(el,rows,coll)})})(els[i])}}
function refreshAuth(){var u=MAI.user();var els=document.querySelectorAll('[data-mai-when]');for(var i=0;i<els.length;i++){var w=els[i].getAttribute('data-mai-when');els[i].hidden=(w==='in')?!u:!!u}
 var ns=document.querySelectorAll('[data-mai-username]');for(var j=0;j<ns.length;j++)ns[j].textContent=u||'';try{document.dispatchEvent(new CustomEvent('mai:auth',{detail:{user:u}}))}catch(e){}}
function wireAuth(form){var mode=form.getAttribute('data-mai-auth');form.addEventListener('submit',function(ev){ev.preventDefault();var d=formData(form);status(form,'Please wait…',true);
 MAI[mode==='signup'?'signup':'login'](d.username||d.email||'',d.password||'').then(function(r){status(form,r.ok?(mode==='signup'?'✅ Account created. You are signed in.':'✅ Signed in.'):(r.error||'Try again.'),r.ok);if(r.ok){form.reset();refreshLists()}})})}
function init(){var f=document.querySelectorAll('form[data-mai-form]');for(var i=0;i<f.length;i++)wireForm(f[i]);
 var a=document.querySelectorAll('form[data-mai-auth]');for(var j=0;j<a.length;j++)wireAuth(a[j]);
 var lo=document.querySelectorAll('[data-mai-logout]');for(var k=0;k<lo.length;k++)lo[k].addEventListener('click',function(e){e.preventDefault();MAI.logout()});
 refreshAuth();refreshLists();
 var notes=document.querySelectorAll('[data-mai-pay-note]');if(notes.length)MAI.payments().then(function(cf){for(var n=0;n<notes.length;n++)notes[n].textContent=cf.payments?'💳 Pay securely online with Paystack':'💳 Payments coming soon. Order now and we will contact you to pay.'})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
`;
}

// ---------- 10. the instructions the code model gets for a backend site ----------
export function backendPrompt(backend) {
  if (!backend) return '';
  const cols = backend.collections.map(c => `- "${c.name}" (${c.kind}${c.public ? ', public: visitors can see ' + c.public.join(', ') : ''}${c.kind === 'item' ? ', private to the signed-in user' : ''}): fields ${c.fields.map(f => `${f.name}${f.required ? '*' : ''} (${f.type}${f.options ? ': ' + f.options.join('/') : ''})`).join(', ')}`).join('\n');
  return `
REAL BACKEND (it is live; wire the page to it exactly like this):
The page loads mai.js automatically before app.js (do NOT write mai.js and do NOT add a script tag for it). It gives window.MAI.
Collections (* = required):
${cols}
- Forms: <form data-mai-form="COLLECTION"> whose inputs use name= exactly the field names above (required ones get the required attribute; use type=email/tel/number/date/time and <select> for choices). Put <p data-mai-status role="status"></p> inside each form. MAI sends the form, shows the result there and resets it. Do NOT add your own submit handler or fetch for these forms. Optional: data-mai-success="custom thank-you text".
- Lists: <div data-mai-list="COLLECTION" data-mai-limit="20"></div> is filled automatically (newest first; a "score" collection renders as a leaderboard, highest first). Style .mai-row, .mai-score, .mai-rank, .mai-name, .mai-points, .mai-date, .mai-empty, .mai-ok, .mai-err in style.css. You may also render yourself: MAI.list('COLLECTION').then(function(rows){ ... }) where each row is {id, data:{...}, created}.
- From JavaScript: MAI.add('COLLECTION', {field: value}) returns a Promise of {ok, id, error} (e.g. save a quiz score at the end of a game, then show the leaderboard).
${backend.auth ? `- Logins: <form data-mai-auth="signup"> and <form data-mai-auth="login">, each with inputs name="username" and name="password" (minlength 6) and a <p data-mai-status></p>. Elements with data-mai-when="in" show only when signed in, data-mai-when="out" only when signed out (MAI toggles the hidden attribute); <span data-mai-username></span> shows the name; a button with data-mai-logout signs out. document fires a "mai:auth" event when that changes. Private collections belong to the signed-in user: MAI.add(coll, data), MAI.list(coll), MAI.update(id, data, coll), MAI.remove(id, coll).\n` : ''}${backend.payments ? `- Payments (Paystack): add data-mai-pay to the order/booking form, plus an email field and either an input name="amount" (naira, number) or data-mai-amount="PRICE" on the form, and a <p data-mai-pay-note></p> near the button. Payments are OFF right now: MAI then shows "Payments coming soon" and still saves the order. Never write card fields yourself.\n` : ''}- Never store or show emails/phone numbers of visitors publicly.`;
}

// ---------- 11. a sensible backend when the request clearly needs one but the plan forgot it ----------
export function defaultBackend(brief) {
  const t = String(brief || '').toLowerCase();
  const cols = [];
  const pay = /\b(pay|payment|paystack|checkout)\b/.test(t);
  if (/\border/.test(t) || (/\b(shop|store|checkout)\b/.test(t) && !/\b(bookings?|appointment|reserv)/.test(t))) cols.push({ name: 'orders', kind: 'order', fields: [{ name: 'name', required: true }, { name: 'phone', type: 'phone', required: true }, { name: 'items', type: 'long', required: true }, { name: 'address', type: 'long' }, { name: 'note', type: 'long' }].concat(pay ? [{ name: 'email', type: 'email', required: true }, { name: 'amount', type: 'number' }] : []) });
  if (/\b(bookings?\b|book\s+(?:a|an|your|now|online)\b|appointment|reserv|schedule a)/.test(t)) cols.push({ name: 'bookings', kind: 'booking', fields: [{ name: 'name', required: true }, { name: 'phone', type: 'phone', required: true }, { name: 'date', type: 'date', required: true }, { name: 'time', type: 'time' }, { name: 'service' }, { name: 'note', type: 'long' }] });
  if (/\b(guest\s*book|comments?|reviews?|testimon|prayer request)/.test(t)) cols.push({ name: /prayer/.test(t) ? 'prayers' : /review/.test(t) ? 'reviews' : 'guestbook', kind: 'entry', fields: [{ name: 'name', required: true }, { name: 'message', type: 'long', required: true }] });
  if (/\b(leader\s*board|high\s*scores?|quiz|game)\b/.test(t) && /\b(leader|score|rank)/.test(t)) cols.push({ name: 'scores', kind: 'score', fields: [{ name: 'name', required: true }, { name: 'score', type: 'number', required: true }] });
  if (/\b(to-?\s*do|todo|task list|notes app)\b/.test(t)) cols.push({ name: 'todos', kind: 'item', fields: [{ name: 'text', required: true }, { name: 'done', type: 'bool' }] });
  if (/\b(rsvp|waitlist|wait list|newsletter|subscribe|register)/.test(t)) cols.push({ name: /rsvp/.test(t) ? 'rsvps' : 'signups', kind: 'signup', fields: [{ name: 'name', required: true }, { name: 'email', type: 'email' }, { name: 'phone', type: 'phone' }].concat(/rsvp/.test(t) ? [{ name: 'guests', type: 'number' }] : []) });
  if ((!cols.length && /\b(contact|enquir|inquir|message|get in touch|form)\b/.test(t)) || /\bcontact\s+form\b/.test(t)) cols.push({ name: 'messages', kind: 'contact', fields: [{ name: 'name', required: true }, { name: 'phone', type: 'phone' }, { name: 'email', type: 'email' }, { name: 'message', type: 'long', required: true }] });
  const auth = /\b(log\s*in|sign\s*(?:up|in)|accounts?|members?\s+area)\b/.test(t) || cols.some(c => c.kind === 'item');
  return cleanBackend({ collections: cols.slice(0, 3), auth, payments: pay });
}
