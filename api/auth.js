import { passOk } from './chat.js';
export default async function handler(req, res) {
  if (!passOk(req.headers['x-passcode'])) {
    await new Promise(r => setTimeout(r, 800));
    res.status(401).json({ ok: false }); return;
  }
  res.status(200).json({ ok: true, image: false });
}
