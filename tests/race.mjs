// The last-cup race: many phones stand on the Serve screen with only a few portions left and ALL tap Serve at the same instant.
// Exactly as many serves must succeed as there are portions; every other phone must be told it is sold out. Several rounds, each with a different number of portions.
//   node race.mjs                      (PHONES=20; BROWSER=webkit for Safari's engine; APP_ROOT=/path/to/older/copy to test an older build)
//   BASE_URL=https://ecomsoc-checkout.web.app/ node race.mjs     the DEPLOYED app and the REAL database (throwaway team, removed afterwards): proves the real rules stop a double serve
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const N = +process.env.PHONES || 20;
const LIVE = !!(process.env.BASE_URL || process.env.REAL_DB);          // the real database (with the deployed app, or with this folder's app when REAL_DB=1)
const DB = (process.env.SYNC_URL || 'https://ecomsoc-checkout-7k4q-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const ROOT = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
});
let mock = null;
if (!process.env.BASE_URL) await new Promise(r => web.listen(0, '127.0.0.1', r));
if (!LIVE) { mock = await startMock(); mock.ctl.delayMs = +process.env.DELAY || 20; mock.ctl.jitterMs = +process.env.JITTER || 60; }
const BASE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/?$/, '/') : `http://127.0.0.1:${web.address().port}/`;
const rest = async (m, p, body) => { const r = await fetch(`${DB}/${p}.json${m === 'GET' ? '' : '?print=silent'}`, { method: m, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? undefined : { 'content-type': 'application/json' } }); return r.status === 200 ? r.json() : r.status; };
const cloud = async segs => LIVE ? rest('GET', segs.join('/')) : mock.get(segs);
const setMeta = async (ep, stock) => { if (LIVE) await rest('PUT', `events/${TEAM}/meta`, { epoch: ep, startStock: stock, resetAt: { '.sv': 'timestamp' }, by: 'race' }); else mock.db().events[TEAM].meta = { epoch: ep, startStock: stock, resetAt: Date.now(), by: 'race' }; };
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(100); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM = Array.from({ length: 8 }, () => chars[crypto.randomInt(32)]).join('');
const NOISE = /due to access control checks|Fetch API cannot load/;
const WIN = { step: 'result', follow: 'new', member: 'new', qid: 'E01', attempt: 1, counted: true, picked: 'A', ok: true };
const epochNow = async () => ((await cloud(['events', TEAM, 'meta'])) || {}).epoch || 'e0';
const devsNow = async () => (await cloud(['events', TEAM, 'epochs', await epochNow(), 'devices'])) || {};
const claimsNow = async () => { const c = (await cloud(['events', TEAM, 'epochs', await epochNow(), 'claims'])) || {}; return Array.isArray(c) ? Object.fromEntries(c.map((v, i) => [String(i), v]).filter(([, v]) => v)) : c; };      // Firebase hands numbered keys 1, 2, 3 ... back as an array
const sumServed = async () => Object.values(await devsNow()).reduce((a, d) => a + d.c.served, 0);

if (LIVE) await setMeta('e0', 80); else mock.db().events = { [TEAM]: { meta: { epoch: 'e0', startStock: 80, resetAt: Date.now(), by: 'race' } } };
const pages = [];
console.log(`${N} phones, team ${TEAM}${process.env.APP_ROOT ? ', app from ' + process.env.APP_ROOT : ''} (${process.env.BROWSER || 'chromium'})\n`);
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ ...D });
  await ctx.addInitScript(u => { try { if (u) localStorage.setItem('ecomsoc-sync-url', u); } catch (e) {} window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} }); }, LIVE ? '' : mock.url);
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|NetworkError/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + '#t=' + TEAM); await page.waitForSelector('#app *');
  await page.evaluate(i => { CC.state().label = 'P' + (i + 1); CC.commit(); }, i);
  pages.push(page);
}
check('All ' + N + ' phones are connected', await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.syncState())))).every(s => s === 'ok'), 30000));

async function round(R, label) {
  const ep = 'r' + Math.random().toString(36).slice(2, 7);
  await setMeta(ep, R);                                                  // a new round: R portions in all
  await until(async () => (await Promise.all(pages.map(p => p.evaluate(e => CC.state().epoch === e && CC.remaining() === (CC.state().startStock), ep)))).every(Boolean), 30000);
  await Promise.all(pages.map(async p => { await p.evaluate(w => { CC.state().cur = w; CC.commit(); }, WIN); await p.reload(); }));
  await Promise.all(pages.map(p => p.waitForSelector('#servebtn', { timeout: 20000 })));
  await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.syncState())))).every(s => s === 'ok'), 20000);
  await wait(2500);                                                      // everyone has the same, fresh count
  const left = await pages[0].evaluate(() => CC.remaining());
  let bursts = 0;
  for (; bursts < 3; bursts++) {                                         // ALL tap Serve at the same moment; a phone told "Busy, tap again" (or "sold out") taps again, as a volunteer would
    const before = await Promise.all(pages.map(p => p.evaluate(() => CC.state().c.served)));
    await Promise.all(pages.map((p, i) => before[i] > 0 ? null : p.click('#servebtn', { timeout: 15000, noWaitAfter: true }).catch(() => {})));
    await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.unsent())))).every(u => u === 0), 30000);
    await wait(2500);
    const now = (await Promise.all(pages.map(p => p.evaluate(() => CC.state().c.served)))).reduce((a, b) => a + b, 0);
    if (now >= R) break;
  }
  await wait(2500);
  if (process.env.DEBUG) {                                               // who claimed which serve number, and what each phone believed
    const cl = await claimsNow(), ph = await Promise.all(pages.map(p => p.evaluate(() => ({ id: CC.state().id, served: CC.state().c.served, last: CC.net.lastClaim, stock: CC.state().startStock, rem: CC.remaining(), top: CC.net.claimTopUntil > Date.now(), log: CC.net.claimLog.slice(-3) }))));
    const idx = Object.fromEntries(ph.map((x, i) => [x.id, 'P' + (i + 1)]));
    console.log('  DEBUG claims:', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, idx[v.id] || v.id]))));
    console.log('  DEBUG claim outcomes per phone:', ph.map((x, i) => 'P' + (i + 1) + ': ' + x.log.join('; ')).filter(x => !/: $/.test(x)).join(' | '));
    console.log('  DEBUG phones that served:', ph.map((x, i) => x.served ? 'P' + (i + 1) + ' (last ' + x.last + ')' : null).filter(Boolean).join(', '), '| stock seen:', [...new Set(ph.map(x => x.stock))].join(','));
  }
  const served = await Promise.all(pages.map(p => p.evaluate(() => CC.state().c.served)));
  const stillWaiting = await Promise.all(pages.map(p => p.evaluate(() => !!document.querySelector('[data-act=serve], #servebtn') || /Sold out/i.test(document.body.innerText))));
  const total = served.reduce((a, b) => a + b, 0);
  return { left, bursts: bursts + 1, total, db: await sumServed(), phonesServed: served.filter(x => x > 0).length, maxOne: Math.max(...served), claims: Object.keys(await claimsNow()).length, stillWaiting: stillWaiting.filter(Boolean).length };
}
for (const R of [1, 3, 8, 15].filter(r => r <= N)) {              // (each phone serves at most once, so a round needs at least as many phones as portions)
  const r = await round(R);
  console.log(`  round with ${R} portion(s): ${r.left} showed, ${r.total} serves counted, ${r.phonesServed} phones served, database serves ${r.db}, claims ${r.claims}`);
  check(`${R} portion(s), ${N} phones tap Serve together: exactly ${R} serve${R === 1 ? '' : 's'} succeed (no over-serving)`, r.left === R && r.total === R && r.db === R, JSON.stringify(r));
  check('...every phone served at most once and the database count equals the phones\' count', r.maxOne <= 1 && r.db === r.total);
  check(`...the other ${N - R} phones were refused and are told it is sold out (they did not serve)`, r.phonesServed === R);
  if (process.env.APP_ROOT === undefined) check('...each serve has its own serve number (claims) in the database', r.claims >= R);
}
// a phone with no connection can still serve (it cannot be stopped without a connection)
{
  await setMeta('off1', 40);
  const P = pages[0]; await until(async () => (await P.evaluate(() => CC.state().epoch)) === 'off1', 20000);
  await P.evaluate(w => { CC.state().cur = w; CC.commit(); }, WIN); await P.reload(); await P.waitForSelector('#servebtn');
  await P.ctx.setOffline(true); await wait(500);
  await P.click('#servebtn'); await until(async () => (await P.evaluate(() => CC.state().c.served)) === 1, 8000);
  check('A phone with no connection serves normally and keeps the serve to send later', (await P.evaluate(() => CC.state().c.served)) === 1 && (await P.evaluate(() => CC.unsent())) > 0);
  await P.ctx.setOffline(false);
  check('...and the serve reaches the database when the connection returns', await until(async () => (await P.evaluate(() => CC.unsent())) === 0, 20000));
}
// database rules from before claims existed: serving still works (a phone falls back and remembers it for a while)   (local stand-in only)
if (!LIVE) {
  mock.ctl.legacyRules = true;
  mock.db().events[TEAM].meta = { epoch: 'old1', startStock: 40, resetAt: Date.now(), by: 'race' };
  const P = pages[1]; await until(async () => (await P.evaluate(() => CC.state().epoch)) === 'old1', 20000);
  await P.evaluate(w => { CC.state().cur = w; CC.commit(); }, WIN); await P.reload(); await P.waitForSelector('#servebtn'); await wait(1500);
  await P.click('#servebtn');
  check('With database rules that do not know claims, a serve still works (no error, no hang)', await until(async () => (await P.evaluate(() => CC.state().c.served)) === 1, 10000) && (await P.evaluate(() => CC.state().cur)) === null);
  check('...and the phone remembers not to try claims again for a few minutes', (await P.evaluate(() => CC.net.noClaimsUntil)) > Date.now());
  mock.ctl.legacyRules = false;
}
const errs = pages.flatMap(p => p.errors).filter(e => !NOISE.test(e)), rej = (await Promise.all(pages.map(p => p.evaluate(() => window.__rej || []).catch(() => [])))).flat();
check('No JavaScript errors on any phone', errs.length === 0, errs.slice(0, 3).join(' | '));
check('No unhandled promise rejections', rej.length === 0, rej.slice(0, 3).join(' | '));
for (const p of pages) await p.ctx.close().catch(() => {});
if (LIVE) {                                                            // remove everything this test wrote to the real database
  const eps = (await rest('GET', `events/${TEAM}/epochs`)) || {};
  for (const ep of Object.keys(eps)) {
    for (const id of Object.keys((await rest('GET', `events/${TEAM}/epochs/${ep}/devices`)) || {})) await rest('DELETE', `events/${TEAM}/epochs/${ep}/devices/${id}`);
    for (const k of Object.keys((await rest('GET', `events/${TEAM}/epochs/${ep}/claims`)) || {})) await rest('DELETE', `events/${TEAM}/epochs/${ep}/claims/${k}`);
  }
  await rest('DELETE', `events/${TEAM}/meta`);
  check('Everything the test wrote to the real database was removed again', (await rest('GET', `events/${TEAM}`)) === null);
}
await browser.close(); if (!process.env.BASE_URL) web.close(); if (mock) await mock.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} race checks passed`);
process.exit(bad.length ? 1 : 0);
