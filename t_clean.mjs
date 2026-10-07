import { list, del } from '@vercel/blob';
let n = 0; for (;;) { const r = await list({ prefix: 'wa-test/', limit: 1000 }); if (!r.blobs.length) break; await del(r.blobs.map(b => b.url)); n += r.blobs.length; if (!r.hasMore) break; }
console.log('cleaned', n);