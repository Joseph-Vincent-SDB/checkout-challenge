// "Do the phones see each other, and does the app SAY so when they cannot?"
//   1. A new phone appears in the other phones' Phones list within a few seconds of joining (not only after the next heartbeat),
//      and it never leaves a stray record behind in a dead round.
//   2. A phone whose updates cannot be sent (it can still read the database) must not show a green bar: it says so, and recovers by itself.
//   3. A phone that is alone on its team (no organiser, no other phone: a mistyped team code looks exactly like this) says so and shows the code.
//   4. A phone on the WRONG team code never mixes with the right team, and tells the volunteer why it is alone.
//   node visibility.mjs        (BROWSER=webkit for the Safari engine)
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
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
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(150); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rc = n => Array.from({ length: n }, () => chars[crypto.randomInt(32)]).join('');
const TEAM = rc(8), OTHER = rc(8), KEY = rc(24), HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const phones = [];
async function phone(label, url, o = {}) {
  const ctx = await browser.newContext(D);
  await ctx.addInitScript(([k, u, hk, h, adm]) => { try { localStorage.setItem(k, u); if (adm) localStorage.setItem(hk, h); } catch (e) {} }, ['ecomsoc-sync-url', mock.url, 'ecomsoc-admin-hash', HASH, !!o.admin]);
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(BASE + url); await page.waitForSelector('#app *');
  if (label) await page.evaluate(l => { const s = CC.state(); s.label = l; CC.commit(); }, label);
  phones.push(page); return page;
}
const names = p => p.evaluate(() => CC.teamPhones().map(r => r.name));
const bar = async p => (await p.innerText('#syncrow')).replace(/\s*\n\s*/g, ' / ');
const barClass = p => p.evaluate(() => document.getElementById('syncrow').className);
const epochNow = t => (mock.get(['events', t, 'meta']) || {}).epoch;
const blockWrites = async p => { mock.ctl.failWriteIds = [await p.evaluate(() => CC.state().id)]; };        // the database answers this phone's reads but refuses everything it tries to write (same on both browser engines)
const allowWrites = async () => { mock.ctl.failWriteIds = []; };

console.log(`Visibility checks (${process.env.BROWSER || 'chromium'})\n`);

/* ---------- 1. a joining phone shows up quickly, in the right round ---------- */
const H = await phone('', '#t=' + TEAM + '&a=' + KEY, { admin: true });
const A = await phone('Phone A', '#t=' + TEAM);
check('1a. The first phones join and see each other', await until(async () => { const [a, b] = await Promise.all([names(H), names(A)]); return a.includes('Phone A') && b.some(x => /Admin/.test(x)) }, 15000), JSON.stringify(await names(A)));
// a reset on the organiser phone starts a new round; every phone then moves to it
await H.evaluate(() => CC.reset ? CC.reset() : null);
await until(async () => epochNow(TEAM) && epochNow(TEAM) !== 'e0', 8000);
const ep = epochNow(TEAM);
const e0Before = Object.keys(((mock.get(['events', TEAM, 'epochs']) || {}).e0 || {}).devices || {});
const t0 = Date.now();
const B = await phone('Phone B', '#t=' + TEAM);
const seen = await until(async () => (await names(H)).includes('Phone B') && (await names(A)).includes('Phone B'), 12000);
check('1b. A phone that joins is listed on the other phones within 8 seconds (not only after the next heartbeat)', seen && Date.now() - t0 < 8000, (Date.now() - t0) + ' ms');
check('1c. ...and it sees the others and the organiser itself', await until(async () => { const n = await names(B); return n.includes('Phone A') && n.some(x => /Admin/.test(x)); }, 8000), JSON.stringify(await names(B)));
await wait(1500);
const idB = await B.evaluate(() => CC.state().id);
const e0After = Object.keys(((mock.get(['events', TEAM, 'epochs']) || {}).e0 || {}).devices || {});
check('1d. The new phone left no record behind in the old round (it waits to learn the current round before it writes)', ep !== 'e0' && !e0After.includes(idB) && e0After.length === e0Before.length, e0After.length + ' in e0 (was ' + e0Before.length + '), round now ' + ep);

/* ---------- 2. a phone that can read but not send must not look healthy ---------- */
await blockWrites(B);
await B.evaluate(() => { const s = CC.state(); s.c.customers += 1; CC.commit(); });
check('2a. When this phone\'s updates keep failing, its bar is red and says other phones cannot see it', await until(async () => /cannot see this phone/i.test(await bar(B)) && /bad/.test(await barClass(B)), 30000), await bar(B) + ' | ' + await barClass(B));
check('2b. ...the status is "nosend", never "ok"', (await B.evaluate(() => CC.syncState())) === 'nosend');
check('2c. ...the phone says how many changes are waiting', /1 change/.test(await bar(B)), await bar(B));
await allowWrites(B);
check('2d. When sending works again the bar turns green by itself and the other phones list the phone again', await until(async () => (await B.evaluate(() => CC.syncState())) === 'ok' && /ok/.test(await barClass(B)) && /Shared/.test(await bar(B)), 30000) && await until(async () => (await names(A)).includes('Phone B'), 15000), await bar(B));
check('2e. ...and the change made while it could not send arrived (nothing lost)', await until(async () => Object.values((mock.get(['events', TEAM, 'epochs', epochNow(TEAM), 'devices']) || {})).some(d => d.l === 'Phone B' && d.c.customers === 1), 15000));

/* ---------- 3 and 4. a phone on the wrong code is alone, and says so ---------- */
const W = await phone('Phone W', '#t=' + OTHER);
await until(async () => (await W.evaluate(() => CC.syncState())) === 'ok', 12000);
check('3a. A phone on a different team code never appears on the real team (and the real team never appears on it)', !(await names(A)).includes('Phone W') && !(await names(W)).includes('Phone A'));
check('3b. Right after joining it shows the normal green bar (no false alarm during the first seconds)', /ok/.test(await barClass(W)), await bar(W));
await W.evaluate(() => { CC.net.okSince -= 25000; });                      // pretend it has been connected and alone for 25 seconds
check('3c. After 20 seconds alone, with no organiser and no other phone, the bar turns amber and shows the team code to compare', await until(async () => { const b = await bar(W); return /alone on this team/i.test(b) && /warn/.test(await barClass(W)) && new RegExp(OTHER.slice(0, 4) + '-' + OTHER.slice(4)).test(b); }, 8000), await bar(W));
const W2 = await phone('Phone W2', '#t=' + OTHER);
check('3d. As soon as a second phone joins the same code the warning goes away', await until(async () => (await names(W)).includes('Phone W2') && !/alone/i.test(await bar(W)) && /ok/.test(await barClass(W)), 15000), await bar(W));
check('3e. The real team\'s phones never show that warning (an organiser is there)', !/alone/i.test(await bar(A)) && !/alone/i.test(await bar(B)));
check('3f. The organiser phone itself is never told it is "alone"', !/alone/i.test(await bar(H)));

/* ---------- 5. the organiser phone's own numbers are for the organiser ---------- */
await H.evaluate(() => { const st = CC.state(); st.c.customers = 7; st.c.served = 5; CC.commit(); });
await A.evaluate(() => { const st = CC.state(); st.c.customers = 3; st.c.served = 2; CC.commit(); });
await until(async () => { const r = await A.evaluate(() => CC.teamPhones().filter(x => x.admin).map(x => x.c.customers)); return r[0] === 7; }, 15000);   // the volunteer phone HAS the number (it is in the team totals) ...
const rowsHtml = async (p) => p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = CC.phonesHtml(); return [...d.querySelectorAll('.kv')].map(k => k.innerText || k.textContent); });
const vRows = await rowsHtml(A), adminRow = vRows.find(t => /Admin/.test(t)), ownRow = vRows.find(t => /Phone A/.test(t)), otherRow = vRows.find(t => /Phone B/.test(t));
check('5a. A volunteer phone still lists the organiser phone by name in Phones', !!adminRow, JSON.stringify(vRows));
check('5b. ...but without its customers and served numbers', adminRow && !/customers|served|\b7\b|\b5\b/.test(adminRow), adminRow);
check('5c. ...while its own row and the other volunteers\' rows keep their numbers', /3 customers/.test(ownRow || '') && /2 served/.test(ownRow || '') && /customers/.test(otherRow || ''), JSON.stringify([ownRow, otherRow]));
const copyA = await A.evaluate(() => CC.summaryText());
check('5d. The summary a volunteer copies has no line with the organiser phone\'s numbers', !/Admin[^\n]*customers/.test(copyA) && /By phone:/.test(copyA) && /Phone A: 3 customers/.test(copyA), copyA.split('\n').slice(-5).join(' | '));
await until(async () => (await H.evaluate(() => CC.teamPhones().filter(x => !x.me).map(x => x.c.customers))).includes(3) && (await A.evaluate(() => CC.remaining())) === (await H.evaluate(() => CC.remaining())), 20000);       // let every phone catch up before comparing
const totalServed = await A.evaluate(() => { let n = 0; CC.teamPhones().forEach(x => { n += x.c.served; }); return n; });
check('5e. ...the food count on the volunteer phone counts all the serves (organiser 5 + Phone A 2 + the rest)', totalServed >= 7 && (await A.evaluate(() => CC.remaining())) === (await H.evaluate(() => CC.remaining())), totalServed + ' served in the list, remaining A=' + await A.evaluate(() => CC.remaining()) + ' H=' + await H.evaluate(() => CC.remaining()));
const hRows = await rowsHtml(H);
check('5f. The organiser phone sees every number, its own and the volunteers\'', hRows.some(t => /Admin/.test(t) && /7 customers/.test(t) && /5 served/.test(t)) && hRows.some(t => /Phone A/.test(t) && /3 customers/.test(t)), JSON.stringify(hRows));
const copyH = await H.evaluate(() => CC.summaryText());
check('5g. ...and the organiser\'s copied summary lists every phone', /Admin[^\n]*: 7 customers, 5 served/.test(copyH) && /Phone A: 3 customers, 2 served/.test(copyH), copyH.split('\n').slice(-5).join(' | '));

check('No JavaScript errors on any phone', phones.every(p => p.errors.length === 0), phones.flatMap(p => p.errors).slice(0, 3).join(' | '));
for (const p of phones) await p.ctx.close().catch(() => {});
await browser.close(); web.close(); await mock.close();
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} visibility checks passed`); process.exit(ok === results.length ? 0 : 1);
