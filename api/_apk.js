// v7: REAL APK (no new accounts). "apk <site>": packages one of his built apps as a signed Android APK (Trusted Web Activity)
// through PWABuilder's free cloud packager (the same service pwabuilder.com uses; no account, no key), then hosts the APK on the
// site itself (https://<site>/app.apk), adds /.well-known/assetlinks.json so it opens full-screen, and sends him the full zip
// (APK + Play Store AAB + signing key) privately on WhatsApp. A plain website is first turned into an installable PWA.
import * as S from './_sites.js';
import { unzip } from './_files.js';

const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const PACKAGER = () => process.env.APK_PACKAGER_URL || 'https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage';
export const A_NEED = { a_load: 15e3, a_pwa: 90e3, a_pack: 170e3, a_deploy: 90e3 };
export function packageId(slug) {
  let id = String(slug || 'app').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'app';
  if (!/^[a-z]/.test(id)) id = 'a' + id;
  return `ng.michaelai.${id}`;
}
export function packOptions(site, plan) {
  const url = new URL(site.url);
  const color = plan?.palette?.primary && /^#[0-9a-f]{6}$/i.test(plan.palette.primary) ? plan.palette.primary : '#2b59c3';
  const bg = plan?.palette?.bg && /^#[0-9a-f]{6}$/i.test(plan.palette.bg) ? plan.palette.bg : '#ffffff';
  const name = String(site.title || plan?.title || 'App').slice(0, 40);
  return {
    packageId: packageId(site.slug), name, launcherName: name.slice(0, 12), appVersion: `1.0.${site.apkVersion || 1}`, appVersionCode: site.apkVersion || 1, appVersionName: `1.0.${site.apkVersion || 1}`,
    host: url.host, startUrl: '/', webManifestUrl: `${url.origin}/manifest.webmanifest`, iconUrl: `${url.origin}/icon-512.png`, maskableIconUrl: `${url.origin}/icon-512.png`, monochromeIconUrl: null,
    themeColor: color, themeColorDark: color, navigationColor: color, navigationColorDark: color, navigationDividerColor: color, navigationDividerColorDark: color, backgroundColor: bg,
    display: 'standalone', fallbackType: 'customtabs', features: {}, enableNotifications: false, enableSiteSettingsShortcut: true, isChromeOSOnly: false, isMetaQuest: false,
    fullScopeUrl: `${url.origin}/`, minSdkVersion: 21, orientation: 'default', shortcuts: [], splashScreenFadeOutDuration: 300, serviceAccountJsonFile: null, additionalTrustedOrigins: [], retainedBundles: [],
    signingMode: 'new', signing: { file: null, alias: 'michael-ai', fullName: 'Michael', organization: 'Michael', organizationalUnit: 'Apps', countryCode: 'NG', keyPassword: '', storePassword: '' },
  };
}
export async function pack(opts, { ms = 160000, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(PACKAGER(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts), signal: AbortSignal.timeout(ms) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || buf.readUInt32LE(0) !== 0x04034b50) return { ok: false, error: `packager answered ${r.status}: ${trim(buf.toString('utf8'), 160)}` };
  const files = unzip(buf);
  const apkName = [...files.keys()].find(k => /\.apk$/i.test(k));
  if (!apkName) return { ok: false, error: 'no APK inside the package' };
  return { ok: true, zip: buf, apk: files.get(apkName), assetlinks: (() => { const k = [...files.keys()].find(k => /(^|\/)assetlinks\.json$/i.test(k)); return k ? files.get(k).toString('utf8') : null; })(), names: [...files.keys()] };
}
export function doneText(site, apkUrl, { pwaified = false } = {}) {
  return [`📱 *${site.title}* is now a real Android app (APK)!`, '', `⬇️ Download: ${apkUrl}`, '',
    '*Install*: open the link on your Android phone → download → tap the file → allow "Install unknown apps" for Chrome (one time) → Install.',
    pwaified ? '_I first turned the site into an installable app (icon + offline)._' : '',
    '', '🗂️ The zip I sent has the APK, a Play Store bundle (.aab) and your *signing key*. Keep it safe: you need the same key for every update. Putting it on Google Play needs a Google Play developer account ($25 once).',
    '_It opens your live site full-screen, so every edit you make shows up in the app too._'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export async function phase(st, h) {
  const { step, deps } = h;
  if (st.phase === 'a_load') {
    const site = await h.rpc('site_get', { ns: h.ns, slug: st.slug }, 15000);
    if (!site) { st.phase = 'fail'; st.error = `I couldn't find the site "${st.slug}"`; return; }
    st.site = { slug: site.slug, title: site.title, url: site.url, project: site.project, project_id: site.project_id, kind: site.kind, version: site.version || 1, site_key: site.site_key, backend: site.backend, owner: site.owner, brief: site.brief };
    st.apkVersion = ((site.files?._apk_version) || 0) + 1;
    st.pwaified = site.kind !== 'app';
    step(`apk: ${site.slug} (${site.kind}) v${site.version}${st.pwaified ? ', needs PWA first' : ''}`);
    st.phase = st.pwaified ? 'a_pwa' : 'a_pack';
    if (st.pwaified) st.redeploy = true;
    return;
  }
  if (st.phase === 'a_pwa' || st.phase === 'a_deploy') {
    const site = await h.rpc('site_get', { ns: h.ns, slug: st.slug }, 15000);
    const files = { ...site.files };
    let plan; try { plan = JSON.parse(files['_plan.json']); } catch { plan = { title: site.title, slug: site.slug, palette: {} }; }
    plan.type = 'app';
    for (const k of Object.keys(files)) if (k.startsWith('_')) delete files[k];
    const clean = Object.fromEntries(Object.entries(files).filter(([k]) => !['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'vercel.json', 'mai.js'].includes(k)));
    if (st.phase === 'a_deploy') { clean['app.apk'] = { b64: st.apkB64 }; if (st.assetlinks) clean['.well-known/assetlinks.json'] = st.assetlinks; }
    const out = S.decorate(clean, plan, { version: (site.version || 1) + 1, siteKey: site.site_key || null, api: h.api });
    const d = await S.deployFiles(site.project, out);
    let s = null;
    for (let i = 0; i < 20; i++) { s = await S.deploymentStatus(d.id); if (['READY', 'ERROR', 'CANCELED'].includes(s.state)) break; await new Promise(r => setTimeout(r, 3000)); }
    if (s?.state !== 'READY') { st.phase = 'fail'; st.error = `Vercel didn't finish the deploy (${s?.state || 'timeout'})`; return; }
    const keep = Object.fromEntries(Object.entries(out).filter(([k]) => !['mai.js'].includes(k)));
    if (st.phase === 'a_deploy') keep._apk_version = st.apkVersion;
    await h.rpc('site_put', { ns: h.ns, slug: site.slug, owner: site.owner, title: site.title, kind: 'app', project: site.project, project_id: site.project_id, url: site.url, files: { ...keep, '_plan.json': JSON.stringify(plan) }, version: (site.version || 1) + 1, last_deploy: d.id, brief: site.brief, site_key: site.site_key || null, backend: site.backend || null }, 20000);
    step(`${st.phase === 'a_pwa' ? 'made installable (manifest + service worker)' : 'hosted app.apk + assetlinks'}: ${d.id}`);
    if (st.phase === 'a_pwa') { st.phase = 'a_pack'; await new Promise(r => setTimeout(r, 2000)); return; }
    const apkUrl = `${site.url.replace(/\/$/, '')}/app.apk`;
    let headOk = false; try { const hr = await fetch(apkUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) }); headOk = hr.ok; } catch {}
    step(`apk link ${headOk ? 'live' : 'not reachable yet'}: ${apkUrl}`);
    const zipName = `${site.slug}-android-v${st.apkVersion}.zip`;
    const sd = await h.sendDoc(Buffer.from(st.zipB64, 'base64'), 'application/zip', zipName, `📦 ${site.title}: APK + Play Store bundle + signing key (keep this safe)`);
    step(`zip ${sd.ok ? 'sent' : 'NOT sent: ' + trim(sd.detail, 80)}`);
    await h.finish(doneText(site, apkUrl, { pwaified: st.pwaified }), { url: apkUrl, slug: site.slug, apk_bytes: Math.round(st.apkB64.length * 0.75), zip_sent: !!sd.ok });
    delete st.apkB64; delete st.zipB64; delete st.assetlinks;
    return;
  }
  if (st.phase === 'a_pack') {
    const site = await h.rpc('site_get', { ns: h.ns, slug: st.slug }, 15000);
    let plan; try { plan = JSON.parse(site.files['_plan.json']); } catch { plan = {}; }
    const r = await pack(packOptions({ ...st.site, url: site.url, apkVersion: st.apkVersion }, plan));
    st.packTries = (st.packTries || 0) + 1;
    if (!r.ok) {
      step(`pack failed (${st.packTries}): ${r.error}`);
      if (st.packTries >= 2) { st.phase = 'fail'; st.error = 'the free Android packager didn\'t answer (' + trim(r.error, 80) + '). Try again later, or install it from Chrome: ⋮ → Add to Home screen'; }
      return;
    }
    st.apkB64 = r.apk.toString('base64'); st.zipB64 = r.zip.toString('base64'); st.assetlinks = r.assetlinks;
    step(`packed: APK ${Math.round(r.apk.length / 1024)} KB, zip ${Math.round(r.zip.length / 1024)} KB (${r.names.join(', ')})`);
    st.phase = 'a_deploy';
    return;
  }
}
