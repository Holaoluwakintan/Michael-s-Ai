// v7 test helper: the bot's store moved from Vercel Blob to Supabase kv (Blob was suspended at 100% Vercel usage).
// cleanTest() clears the wa-test sandbox in both; kvWrites(fn) counts kv_put calls made while fn runs.
import * as J from './api/_jobs.js';
export async function cleanTest() {
  let n = 0;
  try { if (J.jobsOn()) n += +(await J.rpc('kv_purge_test', {})) || 0; } catch (e) { console.log('kv purge skipped:', e.message); }
  try { const { list, del } = await import('@vercel/blob'); const l = await list({ prefix: 'wa-test/' }); if (l.blobs.length) { await del(l.blobs.map(b => b.url)); n += l.blobs.length; } } catch (e) { /* Blob store suspended or absent */ }
  return n;
}
export async function kvWrites(fn) {
  const real = globalThis.fetch; const keys = [];
  globalThis.fetch = async (u, o = {}) => {
    if (String(u).includes('/rpc/michael_ai_jobs') && o.body) { try { const b = JSON.parse(o.body); if (b.p_op === 'kv_put') keys.push(b.p_args.k); } catch {} }
    return real(u, o);
  };
  try { await fn(); } finally { globalThis.fetch = real; }
  return keys;
}
