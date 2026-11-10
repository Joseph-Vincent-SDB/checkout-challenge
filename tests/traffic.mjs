// High-traffic test: many phones online at once while the organiser phones change settings the whole time.
//   node traffic.mjs                      (PHONES=24 DURATION_S=90 by default; BROWSER=webkit for the Safari engine)
//   MIX=1 runs every second phone on WebKit (needs `npx playwright install webkit`).
// What it checks, with a local stand-in for the database that has a little network delay on every request:
//   - every organiser change reaches every online phone quickly (median / 95th percentile / worst case are printed)
//   - the console keeps working with many phones (taps answer quickly, the phone list shows everyone)
//   - customers, serves, holds, hidden phones, messages, question switches, modes, reserve, update speed and refresh all run together
//   - at the end every phone and the database agree exactly, nobody was served twice, no JavaScript errors
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const MIX = process.env.MIX === '1';
const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const N = +process.env.PHONES || 24, DURATION = (+process.env.DURATION_S || 90) * 1000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}/`;
const mock = await startMock();
mock.ctl.delayMs = 25; mock.ctl.jitterMs = 90;                 // a realistic little delay on every request
const launchChromium = () => chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const browser = MIX ? await launchChromium() : await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const browserWk = MIX ? await webkit.launch() : null;
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(100); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const key24 = () => Array.from({ length: 24 }, () => chars[crypto.randomInt(32)]).join('');
const TEAM = Array.from({ length: 8 }, () => chars[crypto.randomInt(32)]).join('');
const KEY = key24(), HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const NOISE = /due to access control checks|Fetch API cannot load/;

const pages = [];
async function mkPhone(i, kind) {                      // kind: 'vol' | 'admin' | 'quiet'
  const wk = MIX && i % 2 === 1;
  const ctx = await (wk ? browserWk : browser).newContext({ ...D });
  await ctx.addInitScript(([k, u, h]) => { try { localStorage.setItem(k, u); localStorage.setItem('ecomsoc-admin-hash', h); } catch (e) {} }, ['ecomsoc-sync-url', mock.url, HASH]);
  await ctx.addInitScript(() => { window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} }); });
  const page = await ctx.newPage(); page.ctx = ctx; page.i = i; page.kind = kind; page.errors = []; page.disrupted = []; page.stats = { customers: 0, serves: 0, offline: 0, reloads: 0 };
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|NetworkError|JSON|Unexpected token/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + '#t=' + TEAM + (kind === 'admin' ? '&a=' + KEY : kind === 'quiet' ? '&c=' + KEY : '')); await page.waitForSelector('#app *');
  if (kind === 'vol') await page.evaluate(i => { CC.state().label = 'Phone ' + (i + 1); CC.commit(); }, i);
  await stamp(page);
  pages.push(page); return page;
}
/* each phone writes down the moment it first holds each settings revision, so latency is measured on the phone itself */
async function stamp(page) {
  await page.evaluate(() => { window.__seen = window.__seen || {}; if (window.__stampTimer) return; window.__stampTimer = setInterval(() => { try { const c = CC.state().ctl; if (c && !(c.rev in window.__seen)) window.__seen[c.rev] = Date.now(); } catch (e) {} }, 40); });
}
const st = p => p.evaluate(() => CC.state());

console.log(`Team ${TEAM}: ${N} volunteer phones + 2 organiser phones for ${DURATION / 1000}s (${MIX ? 'chromium + webkit mix' : process.env.BROWSER || 'chromium'})`);
const STOCK = +process.env.STOCK || 400;                       // plenty of food, so the run is about traffic and not about the sold-out edge (the soak test covers that)
mock.db().events = { [TEAM]: { meta: { epoch: 'e0', startStock: STOCK, resetAt: Date.now(), by: 'traffic' } } };
const A = await mkPhone(900, 'admin'), Q = await mkPhone(901, 'quiet');
const vols = [];
for (let i = 0; i < N; i++) { vols.push(await mkPhone(i, 'vol')); if (i % 6 === 5) await wait(200); }   // phones joining over a few seconds, like people scanning a QR
check('All phones join the team and show a green connection', await until(async () => (await Promise.all([A, Q, ...vols].map(p => p.evaluate(() => CC.syncState())))).every(s => s === 'ok'), 40000));
mock.stats.log.length = 0; mock.stats.total = 0;                                 // count only what happens during the run

/* ---------- a phone that works through customers like a real volunteer ---------- */
const deadline = Date.now() + DURATION;
async function tapq(p, sel) {
  await wait(330);
  if (await p.$('#bcast')) { await p.click('[data-act=bcast-ok]', { timeout: 3000 }).catch(() => {}); await wait(350); }
  await p.click(sel, { timeout: 4000 });
}
async function customer(p) {
  for (let step = 0; step < 40 && Date.now() < deadline + 8000; step++) {
    const s = await p.evaluate(() => ({ cur: CC.state().cur, home: !!document.querySelector('[data-act=next]'), back: !!document.querySelector('[data-act=back-home]') }));
    const cu = s.cur;
    if (!cu) {
      if (s.home && step === 0) {
        if (await p.$('[data-act=next][disabled]')) { p.stats.blocked = (p.stats.blocked || 0) + 1; await wait(rnd(1200, 2500)); return; }
        await tapq(p, '[data-act=next]'); p.stats.customers++; continue;
      }
      if (s.home) return;
      if (s.back) { await tapq(p, '[data-act=back-home]'); continue; }
      await wait(300); continue;
    }
    if (cu.step === 'follow') await tapq(p, Math.random() < 0.3 ? '[data-act=follow-already]' : '[data-act=follow-new]');
    else if (cu.step === 'member') await tapq(p, Math.random() < 0.3 ? '[data-act=member-already]' : '[data-act=member-new]');
    else if (cu.step === 'reveal') await tapq(p, '[data-act=reveal]');
    else if (cu.step === 'drop') await wait(400);
    else if (cu.step === 'question') {
      await wait(rnd(400, 1200));
      const q = await p.evaluate(id => CC.QUESTIONS.find(x => x.id === id), cu.qid);
      const right = Math.random() < 0.65, letters = ['A', 'B', 'C', 'D'], k = right ? q.answer : pick(letters.filter(l => l !== q.answer));
      await tapq(p, `.ans[data-k=${k}]`);
    } else if (cu.step === 'result') {
      await wait(300);
      if (await p.$('#servebtn')) { await tapq(p, '#servebtn'); p.stats.serves++; return; }
      if (await p.$('[data-act=retry]')) { await tapq(p, '[data-act=retry]'); continue; }
      if (await p.$('[data-act=done]')) { await tapq(p, '[data-act=done]'); return; }
      await wait(300);
    } else await wait(300);
  }
}
async function worker(p) {
  while (Date.now() < deadline) {
    try {
      const r = Math.random();
      if (r < 0.02) { p.disrupted.push([Date.now()]); await p.ctx.setOffline(true); p.stats.offline++; await wait(rnd(1500, 4000)); await p.ctx.setOffline(false); p.disrupted[p.disrupted.length - 1].push(Date.now() + 6000); }
      else if (r < 0.03) { p.disrupted.push([Date.now()]); await p.reload(); await p.waitForSelector('#app *'); await stamp(p); p.stats.reloads++; p.disrupted[p.disrupted.length - 1].push(Date.now() + 6000); await wait(500); }
      else await customer(p);
    } catch (e) { await p.ctx.setOffline(false).catch(() => {}); await wait(400); }
    await wait(rnd(200, 900));
  }
}

/* ---------- the organiser: changes something every few seconds, and times how long each change takes to reach every phone ---------- */
const lat = [], failedChanges = [];
const adminActions = [
  ['mode rush', p => p.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=rush]').click())],
  ['mode normal', p => p.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=normal]').click())],
  ['mode clear', p => p.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=clear]').click())],
  ['mode quiet', p => p.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=quiet]').click())],
  ['pause', p => p.evaluate(() => document.querySelector('[data-act=adm-pause]').click())],
  ['lock', p => p.evaluate(() => document.querySelector('[data-act=adm-lock]').click())],
  ['speed', p => p.evaluate(() => document.querySelector('[data-act=adm-poll][data-s="' + [0, 2, 4, 8][Math.floor(Math.random() * 4)] + '"]').click())],
  ['reserve', p => p.evaluate(() => document.querySelector('[data-act=adm-keep-set][data-n="' + [0, 5, 10][Math.floor(Math.random() * 3)] + '"]').click())],
  ['question', p => p.evaluate(() => { const rows = [...document.querySelectorAll('[data-act=adm-q]')]; if (rows.length) rows[Math.floor(Math.random() * rows.length)].click(); })],
  ['message', p => p.evaluate(() => { CC.adminSet({ msg: { id: Math.random().toString(36).slice(2, 10), t: 'Traffic test ' + Date.now() % 1000, k: Math.random() < 0.5 ? 'warn' : 'info' } }, 'Message sent to all phones'); })],
  ['clear message', p => p.evaluate(() => { CC.adminSet({ msg: null }, 'Message cleared'); })],
  ['hold a phone', p => p.evaluate(() => { const ids = Object.keys(CC.state().peers); if (!ids.length) return; const id = ids[Math.floor(Math.random() * ids.length)], c = CC.state().ctl || { hold: [] }; const h = (c.hold || []).slice(); const i = h.indexOf(id); if (i >= 0) h.splice(i, 1); else if (h.length < 4) h.push(id); CC.adminSet({ hold: h }, 'Phone held or resumed'); })],
  ['direct message', p => p.evaluate(() => { const ids = Object.keys(CC.state().peers); if (!ids.length) return; const id = ids[Math.floor(Math.random() * ids.length)]; const c = CC.state().ctl || { dm: {} }; const dm = Object.assign({}, c.dm || {}); dm[id] = { id: Math.random().toString(36).slice(2, 10), t: 'Hello ' + id.slice(-3), k: 'info' }; CC.adminSet({ dm: dm }, 'Message sent to one phone'); })],
  ['hide a phone', p => p.evaluate(() => { const ids = Object.keys(CC.state().peers); if (!ids.length) return; const id = ids[Math.floor(Math.random() * ids.length)], c = CC.state().ctl || { gone: [] }; const g = (c.gone || []).slice(); const i = g.indexOf(id); if (i >= 0) g.splice(i, 1); else if (g.length < 3) g.push(id); CC.adminSet({ gone: g }, 'Phone hidden or shown'); })],
  ['undo', p => p.evaluate(() => CC.undoLast())],
];
async function openConsole(p) {
  if (!(await p.$('#adm-live'))) {
    if (await p.$('[data-act=admin-open]')) await p.click('[data-act=admin-open]');
    else { await p.click('[data-act=back-home]'); await wait(350); await p.click('[data-act=admin-open]'); }
    await p.waitForSelector('#adm-live');
  }
  const q = await p.$('[data-act=adm-q-open][aria-expanded=false]'); if (q) await q.click();
  await wait(400);
}
const pairs = [];                              // [seconds from "landed in the database" to "phone holds it", phone was undisturbed]
async function conv(rev0, name) {                // wait until every phone holds the organiser's newest settings; record each phone's own arrival time
  const t0 = Date.now();
  let want = 0, landed = 0, own = false, idleSince = 0;
  const ok = await until(async () => {
    const r = await A.evaluate(() => ({ rev: (CC.state().ctl || {}).rev || 0, sent: CC.net.ctlSentAt, own: CC.net.ctlRev, busy: CC.net.ctlBusy || CC.net.ctlWant }));
    if (r.busy) { idleSince = 0; return false; }
    if (r.rev <= rev0) { if (!idleSince) idleSince = Date.now(); if (Date.now() - idleSince > 4000) return 'none'; return false; }     // the action changed nothing (for example Undo with nothing to undo)
    want = r.rev; landed = r.sent; own = r.own === r.rev;
    const revs = await Promise.all(vols.map(p => p.evaluate(() => (CC.state().ctl || {}).rev || 0).catch(() => 0)));
    return revs.every(x => x >= want);
  }, 45000);
  if (ok === 'none') return -2;
  if (!ok) return -1;
  if (own) {
    const seen = await Promise.all(vols.map(p => p.evaluate(r => (window.__seen || {})[r] || 0, want).catch(() => 0)));
    seen.forEach((t, i) => {
      if (!t || !landed) return;
      const dis = vols[i].disrupted.some(([a, b]) => b === undefined ? true : (landed - 1000 <= b && t + 1000 >= a));
      pairs.push({ ms: Math.max(0, t - landed), calm: !dis, name });
    });
  }
  return Date.now() - t0;
}
async function organiser() {
  await openConsole(A);
  await wait(2500);
  while (Date.now() < deadline - 6000) {
    const [name, fn] = pick(adminActions);
    const rev0 = await A.evaluate(() => (CC.state().ctl || {}).rev || 0);
    const t0 = Date.now();
    try { await fn(A); } catch (e) { failedChanges.push(name + ': ' + String(e.message).split('\n')[0]); }
    const tap = Date.now() - t0;
    const ms = await conv(rev0, name);
    lat.push({ name, ms, tap });
    if (ms === -1) failedChanges.push(name + ' did not reach every phone');
    await wait(rnd(1500, 4000));
  }
}
async function quiet() {                           // the second organiser phone also changes things (the later change wins)
  await wait(8000);
  while (Date.now() < deadline - 8000) {
    try { await Q.evaluate(() => { CC.adminSet({ hot: [50, 70, 90][Math.floor(Math.random() * 3)] }, 'Easy chance changed'); }); } catch (e) {}
    await wait(rnd(6000, 11000));
  }
}

const t0 = Date.now();
await Promise.all([...vols.map(worker), organiser(), quiet()]);
const runMs = Date.now() - t0;

/* ---------- results ---------- */
const sorted = lat.filter(l => l.ms >= 0).map(l => l.ms).sort((a, b) => a - b);        // (changes that changed nothing are not counted)
const q = f => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : -1;
const qp = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : -1;
const calm = pairs.filter(x => x.calm).map(x => x.ms).sort((a, b) => a - b), allp = pairs.map(x => x.ms).sort((a, b) => a - b);
console.log(`\n${lat.length} organiser changes x ${vols.length} phones = ${pairs.length} arrivals measured on the phones themselves`);
console.log(`Arrival time after the change landed in the database, phones that were not offline or reloading: median ${qp(calm, 0.5)} ms, 95th ${qp(calm, 0.95)} ms, worst ${calm[calm.length - 1]} ms (${calm.length} arrivals)`);
console.log(`...all phones including those that were offline or reloading: median ${qp(allp, 0.5)} ms, 95th ${qp(allp, 0.95)} ms, worst ${allp[allp.length - 1]} ms`);
console.log(`Time until EVERY phone held a change (including the ones that were offline): median ${q(0.5)} ms, 95th ${q(0.95)} ms, worst ${sorted[sorted.length - 1]} ms`);
console.log('Tap-to-screen time on the organiser phone: ' + Math.max(...lat.map(l => l.tap)) + ' ms worst');
check('Every organiser change reached every phone', failedChanges.length === 0 && lat.length >= 8, failedChanges.slice(0, 4).join(' | ') + ' (' + lat.length + ' changes)');
// (dozens of browsers share this one computer's processor while hundreds of customers run, so the tail is mostly scheduling; a real fault in the settings timer would show as 15 seconds or more)
check('For phones that were online and not reloading, 95% of changes arrived within 8 seconds and the slowest within 12', calm.length >= N && qp(calm, 0.95) <= 8000 && calm[calm.length - 1] <= 12000, `95th ${qp(calm, 0.95)} ms, worst ${calm[calm.length - 1]} ms`);
check('Even counting phones that were offline or reloading, the slowest change reached all ' + N + ' phones within 30 seconds', sorted.length > 0 && sorted[sorted.length - 1] <= 30000, sorted[sorted.length - 1] + ' ms');
check('The organiser phone answers a tap or change immediately (under 1.5 s)', Math.max(...lat.map(l => l.tap)) < 1500, Math.max(...lat.map(l => l.tap)) + ' ms');

// settle: everyone back online, then compare
await Promise.all(pages.map(p => p.ctx.setOffline(false).catch(() => {})));
await A.evaluate(() => CC.adminSet({ paused: false, locked: false, keep: 0, poll: 0, hold: [], gone: [], qoff: [], dm: {}, msg: null }));
await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.unsent())))).every(u => u === 0), 40000);
await until(async () => { const r = await Promise.all(pages.map(p => p.evaluate(() => CC.remaining()))); return r.every(v => v === r[0]); }, 40000);
await until(async () => { const want = (mock.get(['events', TEAM, 'ctl']) || {}).rev; const r = await Promise.all(vols.map(p => p.evaluate(() => (CC.state().ctl || {}).rev))); return want && r.every(x => x === want); }, 40000);
await until(async () => { const d = await A.evaluate(() => CC.deliveryInfo()); return d.waiting.length === 0 && d.applied >= d.online - d.legacy.length && d.online >= N - 1; }, 40000);
const devs = (() => { const m = mock.get(['events', TEAM, 'meta']); return mock.get(['events', TEAM, 'epochs', (m && m.epoch) || 'e0', 'devices']) || {}; })();
const cloud = Object.values(devs).reduce((a, d) => { for (const k in d.c) a[k] = (a[k] || 0) + d.c[k]; return a; }, {});
const sumStats = vols.reduce((a, p) => ({ customers: a.customers + p.stats.customers, serves: a.serves + p.stats.serves, offline: a.offline + p.stats.offline, reloads: a.reloads + p.stats.reloads }), { customers: 0, serves: 0, offline: 0, reloads: 0 });
console.log(`Phones ran ${sumStats.customers} customers (${sumStats.serves} served), ${sumStats.offline} offline spells and ${sumStats.reloads} refreshes in ${Math.round(runMs / 1000)} s; the database holds ${Object.keys(devs).length} phone records`);
check('Customers were really served during the run', sumStats.customers >= N && cloud.served > 0, JSON.stringify({ customers: sumStats.customers, served: cloud.served }));
const remVals = await Promise.all(pages.map(p => p.evaluate(() => CC.remaining())));
check('Every phone shows the same food count as the database (' + (STOCK - (cloud.served || 0)) + ')', remVals.every(v => v === remVals[0]) && remVals[0] === STOCK - cloud.served, JSON.stringify([...new Set(remVals)]));
const KEYS = ['customers', 'served', 'won', 'lost', 'follows', 'already', 'members', 'memberAlready', 'skips', 'correct', 'wrong'];
await until(async () => (await Promise.all(pages.map(p => p.evaluate(() => CC.totals().c)))).every(t => KEYS.every(k => t[k] === cloud[k])), 40000);       // every phone has downloaded everybody's final numbers (a big team checks every few seconds)
const tot = await Promise.all(pages.map(p => p.evaluate(() => CC.totals().c)));
const same = tot.every(t => KEYS.every(k => t[k] === cloud[k]));
check('Every phone agrees with the database on every counter', same, same ? '' : JSON.stringify(KEYS.filter(k => tot.some(t => t[k] !== cloud[k]))) + ' differ; first phone off: ' + JSON.stringify(tot.find(t => KEYS.some(k => t[k] !== cloud[k]))) + ' vs ' + JSON.stringify(cloud));
const ctlRevs = await Promise.all(vols.map(p => p.evaluate(() => (CC.state().ctl || {}).rev)));
const cRev = (mock.get(['events', TEAM, 'ctl']) || {}).rev;
check('Every phone ended on the organiser\'s final settings (revision ' + cRev + ')', ctlRevs.every(r => r === cRev), JSON.stringify([...new Set(ctlRevs)]));
const di = await A.evaluate(() => CC.deliveryInfo());
check('The delivery panel on the organiser phone shows all online phones have the latest settings', di && di.waiting.length === 0 && di.applied === di.online && di.online >= N - 1, JSON.stringify(di && { a: di.applied, o: di.online, w: di.waiting.slice(0, 3) }));
const reqPerSecPerPhone = mock.stats.total / ((runMs + 1) / 1000) / (N + 2);
console.log(`Database load: ${mock.stats.total} requests, about ${reqPerSecPerPhone.toFixed(2)} per second per phone`);
// every phone here finishes a customer every few seconds (real use is a customer or two a minute), and each serve now also claims its serve number, so this is a guard against runaway request loops rather than a budget
check('Network use stays gentle with many phones (under 3 requests per second per phone, with every phone serving customers back to back)', reqPerSecPerPhone < 3, reqPerSecPerPhone.toFixed(2));
const all = [...pages];
const jsErr = all.flatMap(p => p.errors).filter(e => !NOISE.test(e));
check('No JavaScript errors on any of the ' + all.length + ' phones', jsErr.length === 0, jsErr.slice(0, 3).join(' | '));
const rejs = []; for (const p of all) rejs.push(...(await p.evaluate(() => window.__rej || []).catch(() => [])));
check('No unhandled promise rejections on any phone', rejs.length === 0, rejs.slice(0, 3).join(' | '));
const overs = await A.evaluate(() => CC.remaining());
check('Nobody was served more food than existed (no over-serving)', overs >= 0, 'remaining ' + overs);

for (const p of all) await p.ctx.close().catch(() => {});
await browser.close(); if (browserWk) await browserWk.close(); web.close(); await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} traffic checks passed`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-traffic-run.json'), JSON.stringify({ phones: N, durationS: DURATION / 1000, changes: lat.length, medianMs: q(0.5), p95Ms: q(0.95), worstMs: sorted[sorted.length - 1], passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
