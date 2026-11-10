// Crowd test: a very large team. A few real phones (one organiser, several volunteers running customers) share a database that also holds
// many simulated phones, each kept "online" with fresh heartbeats, so every real phone has to download, add up and draw a huge team.
//   node crowd.mjs                          (SIM=150 simulated phones, DURATION_S=75; Chromium also measures long main-thread tasks)
// Checks: Auto update speed slows down by itself, the console lists and updates with everybody, an organiser change still reaches every real phone
// within a few seconds, the real phones' totals match the database exactly (simulated phones included), no errors, and how much each phone downloads.
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const SIM = +process.env.SIM || 150, DURATION = (+process.env.DURATION_S || 75) * 1000, REAL = +process.env.REAL || 6;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}/`;
const mock = await startMock(); mock.ctl.delayMs = 25; mock.ctl.jitterMs = 90;
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(100); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM = Array.from({ length: 8 }, () => chars[crypto.randomInt(32)]).join('');
const KEY = Array.from({ length: 24 }, () => chars[crypto.randomInt(32)]).join(''), HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const NOISE = /due to access control checks|Fetch API cannot load/;

mock.db().events = { [TEAM]: { meta: { epoch: 'e0', startStock: 2000, resetAt: Date.now(), by: 'crowd' } } };
const dev0 = mock.db().events[TEAM].epochs = { e0: { devices: {} } };
const simIds = Array.from({ length: SIM }, (_, i) => 'sim' + String(100000 + i));
const zero = { customers: 0, follows: 0, already: 0, correct: 0, wrong: 0, retries: 0, skips: 0, hot: 0, full: 0, won: 0, lost: 0, served: 0, members: 0, memberAlready: 0 };
let simServed = 0;
simIds.forEach((id, i) => { const s = 2 + (i % 7); simServed += s; dev0.e0.devices[id] = { l: 'Crowd ' + (i + 1), c: { ...zero, customers: s + 2, follows: s + 2, won: s, correct: s, wrong: 2, hot: s + 2, served: s }, adj: 0, rev: 1, hb: Date.now(), app: 3 }; });
const keep = setInterval(() => { const d = mock.db().events[TEAM].epochs.e0.devices; simIds.forEach(id => { if (d[id]) { d[id].hb = Date.now(); d[id].rev++; } }); }, 6000);   // every simulated phone says "still here" every 6 seconds

const pages = [];
async function mk(i, kind) {
  const ctx = await browser.newContext({ ...D });
  await ctx.addInitScript(([k, u, hk, h]) => { try { localStorage.setItem(k, u); localStorage.setItem(hk, h); } catch (e) {} window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} }); window.__long = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) {} }, ['ecomsoc-sync-url', mock.url, 'ecomsoc-admin-hash', HASH]);
  const page = await ctx.newPage(); page.ctx = ctx; page.kind = kind; page.errors = []; page.stats = { customers: 0, serves: 0 };
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|NetworkError|JSON|Unexpected token/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + '#t=' + TEAM + (kind === 'admin' ? '&a=' + KEY : '')); await page.waitForSelector('#app *');
  if (kind === 'vol') await page.evaluate(i => { CC.state().label = 'Real ' + (i + 1); CC.commit(); }, i);
  pages.push(page); return page;
}
console.log(`Team ${TEAM}: ${SIM} simulated phones + 1 organiser + ${REAL - 1} real volunteer phones for ${DURATION / 1000}s (${process.env.BROWSER || 'chromium'})`);
const A = await mk(900, 'admin'); const vols = []; for (let i = 0; i < REAL - 1; i++) vols.push(await mk(i, 'vol'));
check('The real phones connect to a team of ' + (SIM + REAL) + ' phones', await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.syncState())))).every(s => s === 'ok'), 40000));
await wait(6000);
const n = await A.evaluate(() => CC.livePhones());
check('Every real phone sees the whole crowd online (' + n + ' phones)', n >= SIM, String(n));
const poll = await vols[0].evaluate(() => CC.pollEveryMs());
check('Auto update speed slows itself down for this big team (checks every ' + poll / 1000 + ' s instead of 2 s)', poll >= 8000, poll + ' ms');
check('The real phones add up the whole crowd: food left is the stock minus every simulated serve too', await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.remaining())))).every(v => v === 2000 - simServed), 30000), String(await vols[0].evaluate(() => CC.remaining())) + ' vs ' + (2000 - simServed));

/* ---------- the run ---------- */
const deadline = Date.now() + DURATION;
async function tapq(p, sel) { await wait(330); if (await p.$('#bcast')) { await p.click('[data-act=bcast-ok]', { timeout: 3000 }).catch(() => {}); await wait(350); } await p.click(sel, { timeout: 4000 }); }
async function customer(p) {
  for (let step = 0; step < 40 && Date.now() < deadline + 8000; step++) {
    const s = await p.evaluate(() => ({ cur: CC.state().cur, home: !!document.querySelector('[data-act=next]'), back: !!document.querySelector('[data-act=back-home]') })), cu = s.cur;
    if (!cu) {
      if (s.home && step === 0) { if (await p.$('[data-act=next][disabled]')) { await wait(rnd(1200, 2500)); return; } await tapq(p, '[data-act=next]'); p.stats.customers++; continue; }
      if (s.home) return; if (s.back) { await tapq(p, '[data-act=back-home]'); continue; } await wait(300); continue;
    }
    if (cu.step === 'follow') await tapq(p, '[data-act=follow-new]');
    else if (cu.step === 'member') await tapq(p, '[data-act=member-new]');
    else if (cu.step === 'reveal') await tapq(p, '[data-act=reveal]');
    else if (cu.step === 'drop') await wait(400);
    else if (cu.step === 'question') { await wait(rnd(400, 900)); const q = await p.evaluate(id => CC.QUESTIONS.find(x => x.id === id), cu.qid); await tapq(p, `.ans[data-k=${Math.random() < 0.7 ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer)}]`); }
    else if (cu.step === 'result') { await wait(300); if (await p.$('#servebtn')) { await tapq(p, '#servebtn'); p.stats.serves++; return; } if (await p.$('[data-act=retry]')) { await tapq(p, '[data-act=retry]'); continue; } if (await p.$('[data-act=done]')) { await tapq(p, '[data-act=done]'); return; } await wait(300); }
    else await wait(300);
  }
}
async function worker(p) { while (Date.now() < deadline) { try { await customer(p); } catch (e) { await wait(400); } await wait(rnd(200, 800)); } }
const lat = [], failed = [];
async function organiser() {
  await tapq(A, '[data-act=admin-open]'); await A.waitForSelector('#adm-live'); await wait(2000);
  const acts = [m => A.evaluate(m => document.querySelector(`[data-act=adm-mode][data-m=${m}]`).click(), m), () => A.evaluate(() => CC.adminSet({ paused: !(CC.state().ctl || {}).paused }, 'pause')), () => A.evaluate(() => CC.adminSet({ keep: [0, 5, 20][Math.floor(Math.random() * 3)] }, 'reserve')), () => A.evaluate(() => CC.adminSet({ msg: { id: Math.random().toString(36).slice(2, 10), t: 'Crowd test', k: 'info' } }, 'message'))];
  while (Date.now() < deadline - 8000) {
    const rev0 = await A.evaluate(() => (CC.state().ctl || {}).rev || 0), t0 = Date.now();
    await acts[Math.floor(Math.random() * acts.length)](['rush', 'normal', 'quiet', 'clear'][Math.floor(Math.random() * 4)]).catch(e => failed.push(String(e.message).split('\n')[0]));
    const ok = await until(async () => { const want = await A.evaluate(() => (CC.state().ctl || {}).rev || 0); if (want <= rev0) return false; const r = await Promise.all(vols.map(p => p.evaluate(() => (CC.state().ctl || {}).rev || 0))); return r.every(x => x >= want); }, 30000);
    lat.push(ok ? Date.now() - t0 : -1); if (!ok) failed.push('a change did not reach every real phone');
    await wait(rnd(2500, 5000));
  }
}
const t0 = Date.now();
await Promise.all([...vols.map(worker), organiser()]);
const runMs = Date.now() - t0;
await A.evaluate(() => CC.adminSet({ paused: false, keep: 0, msg: null }));

/* ---------- results ---------- */
const ok = lat.filter(x => x >= 0).sort((a, b) => a - b), q = f => ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * f))] : -1;
console.log(`\n${lat.length} organiser changes with ${SIM + REAL} phones in the team: until every real phone had it: median ${q(0.5)} ms, 95th ${q(0.95)} ms, worst ${ok[ok.length - 1]} ms`);
check('Every organiser change reached every real phone, even with the team numbers checked only every ' + poll / 1000 + ' s', failed.length === 0 && lat.length >= 5, failed.slice(0, 3).join(' | ') + ' (' + lat.length + ' changes)');
check('...within 9 seconds at worst (the settings are checked on their own short timer)', ok.length > 0 && ok[ok.length - 1] <= 9000, ok[ok.length - 1] + ' ms');
await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.unsent())))).every(u => u === 0), 40000);
await wait(poll + 4000);
const served = vols.reduce((a, p) => a + p.stats.serves, 0), cust = vols.reduce((a, p) => a + p.stats.customers, 0);
console.log(`Real phones ran ${cust} customers (${served} served) in ${Math.round(runMs / 1000)} s`);
const d = mock.db().events[TEAM].epochs.e0.devices, cs = Object.values(d).reduce((a, r) => a + r.c.served, 0);
const rems = await Promise.all(pages.map(p => p.evaluate(() => CC.remaining())));
check('Every real phone shows exactly the database\'s food count (' + (2000 - cs) + '), simulated phones included', rems.every(v => v === 2000 - cs), JSON.stringify([...new Set(rems)]));
const rows = await A.evaluate(() => CC.teamPhones().length);
check('The organiser phone lists every phone of the crowd (' + rows + ')', rows >= SIM);
await A.evaluate(() => { document.querySelector('[data-act=back-home]') && document.querySelector('[data-act=back-home]').click(); });
const load = await Promise.all(pages.map(p => p.evaluate(() => ({ kbMin: Math.round(CC.rxPerMin() / 1024), long: (window.__long || []).slice() }))));
const kb = load.map(x => x.kbMin);
console.log(`Each real phone downloads about ${Math.round(kb.reduce((a, b) => a + b, 0) / kb.length)} KB a minute with ${SIM + REAL} phones in the team (largest ${Math.max(...kb)} KB)`);
check('Download per phone stays modest (under 1.5 MB a minute) for a team of ' + (SIM + REAL), Math.max(...kb) < 1536, Math.max(...kb) + ' KB/min');
if (IS_CHROMIUM) {
  const longA = load[0].long, longV = load.slice(1).flatMap(x => x.long);
  console.log(`Long main-thread tasks (over 50 ms): organiser phone ${longA.length} (worst ${Math.max(0, ...longA)} ms), volunteer phones ${longV.length} (worst ${Math.max(0, ...longV)} ms)`);
  check('The phones stay responsive: no main-thread task over 400 ms on this computer (a phone is slower, but there is a wide margin)', Math.max(0, ...longA, ...longV) < 400, Math.max(0, ...longA, ...longV) + ' ms');
}
const errs = pages.flatMap(p => p.errors).filter(e => !NOISE.test(e)), rej = (await Promise.all(pages.map(p => p.evaluate(() => window.__rej || []).catch(() => [])))).flat();
check('No JavaScript errors on any real phone', errs.length === 0, errs.slice(0, 3).join(' | '));
check('No unhandled promise rejections', rej.length === 0, rej.slice(0, 3).join(' | '));
clearInterval(keep);
for (const p of pages) await p.ctx.close().catch(() => {});
await browser.close(); web.close(); await mock.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} crowd checks passed`);
process.exit(bad.length ? 1 : 0);
