
import crypto from 'node:crypto';
const mod = await import('./api/whatsapp.js');
const step = process.argv[2];
const FROM = '2340000000001';
const payload = (msg) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PID' }, contacts: [{ profile: { name: 'Test' }, wa_id: msg.from }], messages: [msg] } }] }] });
const post = async (body, sig) => { const raw = JSON.stringify(body); const h = { 'content-type': 'application/json' }; if (sig) h['x-hub-signature-256'] = sig === 'good' ? 'sha256=' + crypto.createHmac('sha256', process.env.WA_APP_SECRET).update(raw).digest('hex') : sig;
  const r = await mod.POST(new Request('http://x/api/whatsapp', { method: 'POST', headers: h, body: raw })); console.log('->', r.status, (await r.text()).slice(0, 1500)); };
const text = (id, t, from = FROM) => payload({ from, id, timestamp: '1', type: 'text', text: { body: t } });
const T = Date.now();
if (step === 'get') {
  for (const tok of [process.env.WA_VERIFY_TOKEN, 'wrong']) { const r = await mod.GET(new Request(`http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(tok)}&hub.challenge=1158201444`)); console.log('verify', tok === 'wrong' ? 'wrong' : 'right', r.status, await r.text()); }
  const h = await mod.GET(new Request('http://x/api/whatsapp?health=1')); console.log(await h.text());
}
if (step === 'text') { await post(text('wamid.TEXT1', "What's the capital of Ghana?")); console.log('DUPLICATE:'); await post(text('wamid.TEXT1', "What's the capital of Ghana?")); console.log('STRANGER:'); await post(text('wamid.X'+T, 'hi', '2349999999999')); }
if (step === 'dup-cold') { await post(text('wamid.TEXT1', "What's the capital of Ghana?")); }
if (step === 'mem') { for (const t of ['remember that my favourite colour is purple', '/memory']) await post(text('wamid.M' + T + t.length, t)); }
if (step === 'mem2') { await post(text('wamid.Q' + T, "what's my favourite colour?")); }
if (step === 'cmds') { for (const t of ['/forget 1', '/memory', '/new', '/help']) await post(text('wamid.C' + T + t, t)); }
if (step === 'sig') { await post(text('wamid.S1' + T, '/memory'), 'sha256=deadbeef'); await post(text('wamid.S2' + T, '/memory'), 'good'); await post(text('wamid.S3' + T, '/memory')); }
if (step === 'image') { await post(payload({ from: FROM, id: 'wamid.I' + T, type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'What word is in this picture, and what colour is the circle?' } })); }
if (step === 'voice') { await post(payload({ from: FROM, id: 'wamid.V' + T, type: 'audio', audio: { id: 'MEDIA2', mime_type: 'audio/ogg; codecs=opus', voice: true } })); }
if (step === 'notoken') { await post(text('wamid.N' + T, 'hello')); }
