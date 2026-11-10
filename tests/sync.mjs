// Multi-phone sharing tests.
// Several emulated phones share one team. By default they talk to a local mock of the Firebase
// Realtime Database (tests/mock-rtdb.mjs) that can inject faults. To run the basic checks against
// a REAL database instead:  SYNC_URL=https://<db>.firebasedatabase.app node sync.mjs --live
import { chromium, webkit, firefox, devices } from 'playwright';
const ENGINE = { chromium, webkit, firefox }[process.env.BROWSER || 'chromium'];   // BROWSER=webkit runs the Safari engine
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = process.env.BASE_URL || `http://127.0.0.1:${web.address().port}/`;   // BASE_URL=https://... tests a deployed copy
const mock = LIVE ? null : await startMock();
const DB_URL = LIVE ? process.env.SYNC_URL : mock.url;
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 9000, step = 150) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(step); } return false; }
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newTeam = () => Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
let TEAM = newTeam();
const phones = [];
async function phone(label, o = {}) {
  const ctx = await browser.newContext({ ...D, permissions: IS_CHROMIUM ? ['clipboard-read', 'clipboard-write'] : [] });
  if (!process.env.NO_URL_OVERRIDE) await ctx.addInitScript(([k, u]) => { try { localStorage.setItem(k, u); } catch (e) {} }, ['ecomsoc-sync-url', DB_URL]);   // NO_URL_OVERRIDE=1: use the URL built into the app
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + (o.join === false ? '' : '#t=' + (o.team || TEAM)));
  await page.waitForSelector('#app *');
  if (label) { await page.evaluate(l => { const S = CC.state(); S.label = l; CC.commit(); }, label); }
  phones.push(page); return page;
}
async function closeAll() { for (const p of phones.splice(0)) await p.ctx.close().catch(() => {}); }
const rem = p => p.evaluate(() => CC.remaining());
const st = p => p.evaluate(() => CC.syncState());
const unsent = p => p.evaluate(() => CC.unsent());
const own = p => p.evaluate(() => JSON.parse(JSON.stringify(CC.state().c)));
const syncText = p => p.innerText('#syncrow').catch(() => '');
async function fakeServe(p, n) {
  await p.evaluate(n => { const S = CC.state(); for (let i = 0; i < n; i++) { S.c.customers++; S.c.follows++; S.c.correct++; S.c.won++; S.c.hot++; S.c.served++; if (!S.first) S.first = Date.now(); S.last = Date.now(); CC.commit(); } }, n);
}
async function tap(p, sel) { await p.waitForSelector(sel, { state: 'visible' }); await wait(300); await p.click(sel); }
async function uiServe(p) {
  await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await tap(p, '[data-act=member-new]'); await tap(p, '[data-act=reveal]');
  await p.waitForSelector('.ans[data-act=answer]', { timeout: 4000 }); await wait(450);
  const [qid] = await p.evaluate(() => [CC.state().cur.qid]);
  const letter = await p.evaluate(id => CC.QUESTIONS.find(q => q.id === id).answer, qid);
  await p.click(`.ans[data-k=${letter}]`); await p.waitForSelector('#result');
  await tap(p, '[data-act=serve]'); await p.waitForSelector('[data-act=next]');
}
async function toResultWin(p) {           // park a phone on the "ORDER CONFIRMED" screen
  await p.evaluate(() => { const S = CC.state(); S.cur = { step: 'result', follow: 'new', qid: 'E01', attempt: 1, counted: true, picked: 'A', ok: true }; CC.commit(); });
  await p.reload(); await p.waitForSelector('#result');
}
const rest = async (m, p, body) => { const r = await fetch(DB_URL.replace(/\/+$/, '') + '/' + p + '.json' + (m === 'GET' ? '' : '?print=silent'), { method: m, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? undefined : { 'content-type': 'application/json' } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };
const cloudMeta = async (team = TEAM) => mock ? mock.get(['events', team, 'meta']) : (await rest('GET', `events/${team}/meta`)).json;
const cloudDevices = async (team = TEAM, ep = null) => { const e = await cloudMeta(team); const epoch = ep || (e && e.epoch) || 'e0'; return (mock ? mock.get(['events', team, 'epochs', epoch, 'devices']) : (await rest('GET', `events/${team}/epochs/${epoch}/devices`)).json) || {}; };
const cloudServed = async () => Object.values(await cloudDevices()).reduce((a, d) => a + d.c.served, 0);
const teamsUsed = new Set();
async function cleanup() {                                  // live runs: remove the test team's data afterwards
  if (mock) return;
  for (const team of teamsUsed) {
    const tree = (await rest('GET', `events/${team}`)).json || {};
    for (const ep of Object.keys(tree.epochs || {})) for (const id of Object.keys(tree.epochs[ep].devices || {})) await rest('DELETE', `events/${team}/epochs/${ep}/devices/${id}`);
    await rest('DELETE', `events/${team}/meta`);
  }
}
async function reset() { await closeAll(); await cleanup(); if (mock) mock.reset(); TEAM = newTeam(); teamsUsed.add(TEAM); }
teamsUsed.add(TEAM);

/* ===================== 1. basics ===================== */
{
  const A = await phone('Phone A'), B = await phone('Phone B');
  check('Two phones joined by link both reach "Shared: 2 phones online"', await until(async () => /Shared: 2 phones online/.test(await syncText(A)) && /Shared: 2 phones online/.test(await syncText(B)), 10000), (await syncText(A)).replace(/\n/g, ' '));
  const url = new URL(A.url()); check('Join code is removed from the address bar after joining', url.hash === '');
  await uiServe(A);
  check('A serves one customer through the screens: A shows 79 left', (await rem(A)) === 79);
  check('B sees 79 left within 5 seconds, without touching anything', await until(async () => (await rem(B)) === 79, 5000), 'B=' + await rem(B));
  check('B Home screen text updates by itself (79)', await until(async () => /79/.test(await B.innerText('.stock .n')), 3000));
  check('B also sees the membership counted on A (shared totals)', await until(async () => (await B.evaluate(() => CC.totals().c.members)) === 1, 4000));
  check('B counts the customer and the winner in the tallies', /1\s*Customers/.test((await B.innerText('#tallies')).replace(/\n/g, ' ')) && /1\s*Winners/.test((await B.innerText('#tallies')).replace(/\n/g, ' ')));
  const poll = async () => { const t = Date.now(); await A.evaluate(() => CC.pollNow()); return Date.now() - t; };
  check('One check of the team numbers takes under 1.5 s (local)', (await poll()) < 1500);
  check('No JS errors on either phone', A.errors.length + B.errors.length === 0, A.errors.concat(B.errors).join(' | '));
  await reset();
}

/* ===================== 2. many phones, interleaved serves ===================== */
{
  const ps = []; for (let i = 0; i < 6; i++) ps.push(await phone('Phone ' + (i + 1)));
  await until(async () => (await Promise.all(ps.map(st))).every(s => s === 'ok'), 12000);
  const plan = [7, 3, 5, 9, 2, 6]; const total = plan.reduce((a, b) => a + b, 0);
  await Promise.all(ps.map(async (p, i) => { for (let k = 0; k < plan[i]; k++) { await fakeServe(p, 1); await wait(Math.random() * 400); } }));
  const want = 80 - total;
  const ok = await until(async () => (await Promise.all(ps.map(rem))).every(r => r === want), 10000);
  check(`6 phones served ${total} between them: all 6 show exactly ${want} left`, ok, (await Promise.all(ps.map(rem))).join(','));
  check('Cloud total served equals what the phones counted', (await cloudServed()) === total, `cloud=${(await cloudServed())} expected=${total}`);
  check('No phone has unsent changes left', (await Promise.all(ps.map(unsent))).every(u => u === 0));
  check('No JS errors on any of 6 phones', ps.every(p => p.errors.length === 0), ps.flatMap(p => p.errors).join(' | '));
  await reset();
}

/* ===================== 3. offline phone catches up, nothing lost or doubled ===================== */
{
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await fakeServe(B, 2);
  await until(async () => (await rem(A)) === 78, 6000);
  await A.ctx.setOffline(true);
  await fakeServe(A, 3);
  await until(async () => (await st(A)) === 'offline', 14000);
  check('A notices it is offline (red status, says changes are waiting)', (await st(A)) === 'offline' && /\d+ changes? will send/.test(await syncText(A)), (await syncText(A)).replace(/\n/g, ' '));
  check('While offline A still works: shows its own count of food left', (await rem(A)) === 75, 'A sees ' + (await rem(A)));
  await uiServe(A);                       // a full customer on the offline phone
  check('A can run a whole customer offline', (await own(A)).served === 4 && (await own(A)).customers === 4, JSON.stringify(await own(A)));
  await fakeServe(B, 1);
  await wait(3500);
  check('B (online) does not yet see A\'s offline serves', (await rem(B)) === 80 - 3 && (await cloudServed()) === 3, 'B=' + await rem(B) + ' cloud=' + await cloudServed());
  await A.ctx.setOffline(false);
  const want = 80 - 4 - 3;
  check('Back online: A and B both show the exact total within 8 s', await until(async () => (await rem(A)) === want && (await rem(B)) === want, 8000), `A=${await rem(A)} B=${await rem(B)} want=${want}`);
  check('Cloud total matches (4 on A + 3 on B), nothing doubled', (await cloudServed()) === 7, 'cloud=' + await cloudServed());
  check('A has no unsent changes and goes green', await until(async () => (await unsent(A)) === 0 && (await st(A)) === 'ok', 6000));
  check('No JS errors while offline and back', A.errors.length + B.errors.length === 0, A.errors.concat(B.errors).join(' | '));
  await reset();
}

/* ===================== 4. lost responses (server applied the write, phone never heard back) ===================== */
if (mock) {   // fault injection needs the mock database
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok');
  mock.ctl.dropResponse = true;
  await fakeServe(A, 2); await wait(300); await fakeServe(A, 1);
  await wait(9500);                       // A's pushes time out (7 s) and are retried
  mock.ctl.dropResponse = false;
  check('Lost answers: totals still exact, no double counting', await until(async () => (await rem(A)) === 77 && (await rem(B)) === 77 && (await cloudServed()) === 3, 12000), `A=${await rem(A)} B=${await rem(B)} cloud=${(await cloudServed())}`);
  check('A finally sees its changes as sent', await until(async () => (await unsent(A)) === 0, 8000));
  check('No JS errors', A.errors.length + B.errors.length === 0, A.errors.concat(B.errors).join(' | '));
  await reset();
}

/* ===================== 5. server errors, slow server, hung server ===================== */
if (mock) {   // fault injection needs the mock database
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok');
  mock.ctl.failRate = 1; mock.ctl.failStatus = 500;
  await fakeServe(A, 2);
  await until(async () => (await st(A)) === 'offline', 12000);
  check('Server returning 500: phone shows offline, keeps working', (await st(A)) === 'offline' && (await rem(A)) === 78);
  mock.ctl.failRate = 0;
  check('Server back: phones agree again', await until(async () => (await rem(B)) === 78 && (await unsent(A)) === 0, 10000), `B=${await rem(B)}`);
  mock.ctl.hang = true; await fakeServe(B, 1);
  await wait(9000);
  check('Server that never answers: no crash, B says offline', (await st(B)) === 'offline' && B.errors.length === 0);
  mock.ctl.hang = false;
  check('Hung server recovers: A sees B\'s serve', await until(async () => (await rem(A)) === 77, 14000), 'A=' + await rem(A));
  mock.ctl.refuse = true; await wait(4000); mock.ctl.refuse = false;
  check('Dropped connections recover', await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok', 12000));
  mock.ctl.delayMs = 1800; mock.ctl.jitterMs = 1200;
  await fakeServe(A, 1); await fakeServe(B, 1);
  check('Slow server (2-3 s per request): totals still converge', await until(async () => (await rem(A)) === 75 && (await rem(B)) === 75, 20000), `A=${await rem(A)} B=${await rem(B)}`);
  mock.ctl.delayMs = 0; mock.ctl.jitterMs = 0;
  check('No JS errors through all of that', A.errors.length + B.errors.length === 0, A.errors.concat(B.errors).join(' | '));
  await reset();
}

/* ===================== 6. out-of-order / stale writes ===================== */
if (mock) {   // fault injection needs the mock database
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok');
  mock.ctl.delayMs = 50; mock.ctl.jitterMs = 1500;           // responses and writes land in random order
  for (let i = 0; i < 25; i++) { await fakeServe(A, 1); await wait(40); }
  mock.ctl.delayMs = 0; mock.ctl.jitterMs = 0;
  check('25 rapid changes with random delays: cloud copy ends exactly equal to the phone', await until(async () => (await cloudServed()) === 25 && (await unsent(A)) === 0, 20000), `cloud=${(await cloudServed())} unsent=${await unsent(A)}`);
  check('B shows 55 left', await until(async () => (await rem(B)) === 55, 8000), 'B=' + await rem(B));
  await reset();
}

/* ===================== 7. shared settings: total food, manual adjust, reset ===================== */
{
  const A = await phone('Phone A'), B = await phone('Phone B'), C = await phone('Phone C');
  await until(async () => (await Promise.all([A, B, C].map(st))).every(s => s === 'ok'));
  await fakeServe(A, 4); await fakeServe(B, 3);
  await until(async () => (await rem(C)) === 73);
  // change total food from phone C's Summary screen
  await tap(C, '[data-act=summary]'); await C.waitForSelector('[data-act="start+"]');
  await tap(C, '[data-act="start+"]'); await wait(300); await tap(C, '[data-act="start+"]');
  check('Raising total food by 10 on C updates A and B', await until(async () => (await rem(A)) === 83 && (await rem(B)) === 83 && (await rem(C)) === 83, 8000), `A=${await rem(A)} B=${await rem(B)} C=${await rem(C)}`);
  await tap(C, '[data-act="stock-"]'); await wait(300); await tap(C, '[data-act="stock-"]');
  check('Manual -2 on C reduces the shared count everywhere', await until(async () => (await rem(A)) === 81 && (await rem(B)) === 81, 8000), `A=${await rem(A)} B=${await rem(B)}`);
  check('Summary screen on C lists all 3 phones and the shared totals', /Phone A/.test(await C.innerText('#phones')) && /Phone B/.test(await C.innerText('#phones')) && /7\s*Food served/i.test((await C.innerText('#stats')).replace(/\n/g, ' ')), (await C.innerText('#phones')).replace(/\n/g, ' ').slice(0, 120));
  // copy summary
  await tap(C, '[data-act=copy]'); await wait(300);
  const clip = IS_CHROMIUM ? await C.evaluate(() => navigator.clipboard.readText()) : '';
  if (IS_CHROMIUM) check('Copied summary contains shared totals and a line per phone', /Customers: 7/.test(clip) && /Food served: 7/.test(clip) && /Phone A: 4 customers, 4 served/.test(clip) && /Shared across 3 phones/.test(clip), clip.split('\n').slice(0, 4).join(' / '));
  // reset all
  await tap(A, '[data-act=summary]'); await A.waitForSelector('[data-hold]');
  const hb = await A.$('[data-hold]'); await hb.scrollIntoViewIfNeeded(); const bb = await hb.boundingBox();
  await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await A.mouse.down(); await wait(2300); await A.mouse.up();
  await A.waitForSelector('[data-act=reset-yes]');
  check('Reset asks first and says it affects all phones', /ALL phones/.test(await A.innerText('.sheet')), (await A.innerText('.sheet')).replace(/\n/g, ' ').slice(0, 140));
  const oldEpoch = await A.evaluate(() => CC.state().epoch);
  await tap(A, '[data-act=reset-yes]');
  check('After reset every phone shows the full 90 again', await until(async () => (await rem(A)) === 90 && (await rem(B)) === 90 && (await rem(C)) === 90, 9000), `A=${await rem(A)} B=${await rem(B)} C=${await rem(C)}`);
  const newEpoch = await B.evaluate(() => CC.state().epoch);
  check('Reset starts a new epoch and keeps the old numbers in the database', newEpoch !== oldEpoch && Object.keys(await cloudDevices(TEAM, oldEpoch)).length === 3, `old=${oldEpoch} new=${newEpoch}`);
  check('Customers tally on B is back to zero', (await own(B)).customers === 0 && (await own(B)).served === 0);
  check('No JS errors', [A, B, C].every(p => p.errors.length === 0), [A, B, C].flatMap(p => p.errors).join(' | '));
  await reset();
}

/* ===================== 8. phone offline during a reset ===================== */
{
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await B.ctx.setOffline(true); await fakeServe(B, 2);
  await A.evaluate(() => CC.reset());
  await until(async () => (await rem(A)) === 80 && (await cloudMeta()).epoch !== 'e0', 6000);
  await B.ctx.setOffline(false);
  check('Phone that was offline joins the new epoch when it returns (old tallies dropped, not mixed in)', await until(async () => (await rem(B)) === 80 && (await own(B)).served === 0, 10000), `B=${await rem(B)} served=${(await own(B)).served}`);
  await fakeServe(B, 1);
  check('New serves after the reset count normally', await until(async () => (await rem(A)) === 79, 6000));
  await reset();
}

/* ===================== 9. the last portions ===================== */
{
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await A.evaluate(() => { CC.state().adj = -78; CC.commit(); });                // 2 portions left in total
  await until(async () => (await rem(B)) === 2, 6000);
  await toResultWin(A); await toResultWin(B);
  check('Both phones show "Serve food (2 left)"', /2 left/.test(await A.innerText('#servebtn')) && /2 left/.test(await B.innerText('#servebtn')));
  await A.click('#servebtn'); await A.waitForSelector('[data-act=next]');
  check('After A serves, B\'s button updates by itself to "1 left"', await until(async () => /1 left/.test(await B.innerText('#resfoot')), 5000), (await B.innerText('#resfoot')).replace(/\n/g, ' '));
  await fakeServe(A, 1);                                                          // the last portion goes on A
  check('When the last portion goes elsewhere, B\'s screen flips to sold out with a Done button', await until(async () => /sold out/i.test(await B.innerText('#resbanner')) && !!(await B.$('[data-act=done]')), 5000), (await B.innerText('#resbanner')).replace(/\n/g, ' '));
  check('B no longer offers Serve food', !(await B.$('[data-act=serve]')));
  check('Shared count is exactly 0, never negative', (await rem(A)) === 0 && (await rem(B)) === 0);
  await reset();
}
{
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await A.evaluate(() => { CC.state().adj = -79; CC.commit(); });                // exactly 1 portion left
  await until(async () => (await rem(B)) === 1, 6000);
  await toResultWin(A); await toResultWin(B);
  await Promise.all([A.click('#servebtn'), B.click('#servebtn')]);              // both tap at the same moment
  await Promise.all([A, B].map(p => p.waitForSelector('[data-act=next], [data-act=done]', { timeout: 6000 })));
  await wait(3500);
  const over = (await cloudServed()) - 1;
  check('Two phones tapping Serve in the same instant on the last portion: over-serve at most 1', over <= 1, `served=${(await cloudServed())} over=${over}`);
  check('Both phones agree afterwards and show sold out', (await rem(A)) === (await rem(B)) && (await rem(A)) <= 0, `A=${await rem(A)} B=${await rem(B)}`);
  await reset();
}

/* ===================== 10. joining ===================== */
{
  const N = await phone('', { join: false });
  check('A phone with no team code opens on the Join screen', await N.isVisible('#code'));
  await N.fill('#code', 'abc'); await tap(N, '[data-act=join-go]');
  check('A bad code shows a clear message', /does not look right/.test(await N.innerText('#joinerr')));
  await N.fill('#code', fmtCode(TEAM).toLowerCase()); await tap(N, '[data-act=join-go]');
  check('A good code (typed with a dash and lower case) joins and goes Home', await until(async () => await N.isVisible('[data-act=next]') && /Shared/.test(await syncText(N)), 8000), (await syncText(N)).replace(/\n/g, ' '));
  const S2 = await phone('', { join: false });
  await tap(S2, '[data-act=join-skip]');
  check('"Use on this phone only" goes Home with a "Not shared" bar', /Not shared/.test(await syncText(S2)), (await syncText(S2)).replace(/\n/g, ' '));
  await tap(S2, '#syncrow'); check('Tapping the bar opens the Join screen again', await S2.isVisible('#code'));
  // phone with existing tallies opening a join link
  const T = await phone('', { join: false }); await tap(T, '[data-act=join-skip]'); await fakeServe(T, 2);
  await T.goto('about:blank'); await T.goto(BASE + '#t=' + TEAM); await T.waitForSelector('#app *');   // a fresh page load with the join link
  check('Opening a join link on a phone that already has tallies asks before clearing them', await until(async () => /clear this phone/.test(await T.innerText('.sheet').catch(() => '')), 4000));
  await tap(T, '[data-act=join-yes]');
  check('After confirming, the phone is on the team with a clean slate', await until(async () => (await own(T)).served === 0 && /Shared/.test(await syncText(T)), 8000));
  // join link opened while the app is already open (same page, only the # changes): must still join
  const H = await phone('', { join: false }); await tap(H, '[data-act=join-skip]'); await wait(300);
  await H.evaluate(code => { location.hash = '#t=' + code; }, TEAM);
  check('A join link opened while the app is already open (only the # changes) still joins', await until(async () => (await H.evaluate(() => CC.state().team)) === TEAM && /Shared/.test(await syncText(H)), 8000) && new URL(H.url()).hash === '', (await syncText(H)).replace(/\n/g, ' '));
  const H2 = await phone('', { join: false }); await tap(H2, '[data-act=join-skip]'); await fakeServe(H2, 1); await wait(300);
  await H2.evaluate(code => { location.hash = '#t=' + code; }, TEAM);
  check('A join link arriving while the app is open on a phone WITH tallies also asks first', await until(async () => /clear this phone/.test(await H2.innerText('.sheet').catch(() => '')), 4000));
  // Show join QR
  await tap(T, '[data-act=summary]'); await tap(T, '[data-act=share]');
  check('Show join QR displays a QR code and the team code', !!(await T.$('#qrjoin')) && (await T.innerText('.sheet')).includes(fmtCode(TEAM)));
  await reset();
}
function fmtCode(c) { return c.slice(0, 4) + '-' + c.slice(4); }

/* ===================== 10b. the app open twice on one phone ===================== */
{
  const A = await phone('Phone A'); const B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok');
  const ctx = A.ctx; const A2 = await ctx.newPage(); A2.errors = []; A2.on('pageerror', e => A2.errors.push(e.message));
  await A2.goto(BASE); await A2.waitForSelector('#app *');
  check('A second copy of the app on the same phone starts already on the team (same storage)', await until(async () => (await A2.evaluate(() => CC.state().team)) === TEAM && (await A2.evaluate(() => CC.state().id)) === (await A.evaluate(() => CC.state().id)), 6000));
  await uiServe(A);
  check('A customer served in copy 1 shows up in copy 2 of the same phone straight away', await until(async () => (await A2.evaluate(() => CC.state().c.served)) === 1, 4000), 'copy2 served=' + await A2.evaluate(() => CC.state().c.served));
  await uiServe(A2);
  check('...and a customer served in copy 2 shows up in copy 1', await until(async () => (await A.evaluate(() => CC.state().c.served)) === 2, 4000), 'copy1 served=' + await A.evaluate(() => CC.state().c.served));
  check('The other phone sees exactly 2 served (not 1, not 3) and only one record exists for the phone', await until(async () => (await rem(B)) === 78, 8000) && Object.keys(await cloudDevices()).length === 2, `B=${await rem(B)} records=${Object.keys(await cloudDevices()).length}`);
  check('Both copies agree and nothing is left unsent', (await rem(A)) === (await rem(A2)) && (await unsent(A)) === 0 && (await unsent(A2)) === 0);
  A.errors.push(...A2.errors);
  check('No JS errors', A.errors.length === 0, A.errors.join(' | '));
  await reset();
}

/* ===================== 11. database says no ===================== */
if (mock) {   // fault injection needs the mock database
  const A = await phone('Phone A'); await until(async () => (await st(A)) === 'ok');
  mock.ctl.deny = true; await fakeServe(A, 1);
  await until(async () => (await st(A)) === 'error', 8000);
  check('If the database rules reject writes, the bar says "Sharing problem" and the phone keeps working', (await st(A)) === 'error' && /Sharing problem/.test(await syncText(A)) && (await rem(A)) === 79, (await syncText(A)).replace(/\n/g, ' '));
  await uiServe(A); check('A full customer still works while sharing is broken', (await own(A)).served === 2);
  mock.ctl.deny = false;
  check('When the database accepts again it recovers by itself', await until(async () => (await st(A)) === 'ok' && (await unsent(A)) === 0 && (await cloudServed()) === 2, 12000));
  check('No JS errors', A.errors.length === 0, A.errors.join(' | '));
  await reset();
}

/* ===================== 12. junk in the database, wrong team, migration ===================== */
if (mock) {   // fault injection needs the mock database
  const A = await phone('Phone A'); await until(async () => (await st(A)) === 'ok');
  await until(async () => ((mock.get(['events', TEAM, 'epochs', 'e0']) || {}).devices || null), 6000);     // (a new phone first learns the round, then writes its record: a moment after the green bar)
  const devs = mock.db().events[TEAM].epochs.e0.devices;
  devs['zzzzzzzzzzzz'] = { c: 'oops', rev: 'x' };
  devs['yyyyyyyyyyyy'] = { c: { customers: -9, served: 'many', won: 1e99 }, adj: 'x', rev: 1, hb: 1 };
  devs['xxxxxxxxxxxx'] = null;
  await wait(4500);
  check('Junk or odd records from other phones are ignored safely', (await st(A)) === 'ok' && A.errors.length === 0 && (await rem(A)) === 80, 'rem=' + await rem(A) + ' ' + A.errors.join('|'));
  await reset();
  const W = await phone('Wrong', { team: 'ZZZZZZZZ' });       // another team's code: different world
  await until(async () => (await st(W)) === 'ok');
  check('A different team code is a separate group with its own count', (await rem(W)) === 80 && /1 phone online/.test(await syncText(W)));
  await reset();
  const ctx = await browser.newContext(D); const M = await ctx.newPage();
  await M.goto(BASE);
  await M.evaluate(() => localStorage.setItem('ecomsoc-checkout-challenge-v1', JSON.stringify({ v: 1, startStock: 80, stock: 66, c: { customers: 9, follows: 7, already: 2, correct: 8, wrong: 3, retries: 1, skips: 0, hot: 6, full: 5, won: 8, lost: 1, served: 14 }, first: 1700000000000, last: 1700003600000, label: 'Old phone', bags: { easy: [], hard: [] }, lastId: null, cur: null })));
  await M.reload(); await M.waitForSelector('#app *');
  check('Saves from the previous version are migrated (food left 66, 9 customers, 14 served)', (await rem(M)) === 66 && (await own(M)).customers === 9 && (await own(M)).served === 14);
  await ctx.close();
}

/* ===================== 13. polite on the network, sleeps when hidden ===================== */
if (mock) {   // fault injection needs the mock database
  const ps = [await phone('A'), await phone('B'), await phone('C')];
  await until(async () => (await Promise.all(ps.map(st))).every(s => s === 'ok'));
  const t0 = Date.now(), n0 = mock.stats.total; await wait(12000);
  const perPhoneSec = (mock.stats.total - n0) / ((Date.now() - t0) / 1000) / 3;
  check('Idle traffic is gentle: at most 1.5 requests per second per phone', perPhoneSec <= 1.5, perPhoneSec.toFixed(2) + ' req/s/phone');
  const setVis = (p, v) => p.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  for (const p of ps) await setVis(p, 'hidden');
  await wait(1500); const q0 = mock.stats.total; await wait(5000);
  check('Hidden phones stop polling (battery friendly)', mock.stats.total - q0 <= 1, 'requests while all hidden: ' + (mock.stats.total - q0));
  await setVis(ps[1], 'visible'); await fakeServe(ps[1], 1);
  await until(async () => (await unsent(ps[1])) === 0, 6000);
  await wait(3000);
  check('A hidden phone does not poll, so it still shows the old number', (await rem(ps[0])) === 80, 'rem=' + await rem(ps[0]));
  await setVis(ps[0], 'visible');
  check('Bringing the phone back to the screen refreshes within 2 seconds', await until(async () => (await rem(ps[0])) === 79, 2000), 'rem=' + await rem(ps[0]));
  check('No JS errors', ps.every(p => p.errors.length === 0), ps.flatMap(p => p.errors).join(' | '));
  await reset();
}

/* ===================== 14. new screens: layout, contrast, screenshots, re-join ===================== */
if (mock) {   // fault injection needs the mock database
  const SHOTS = path.join(ROOT, 'tests', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
  const layout = p => p.evaluate(() => {
    const vw = innerWidth, out = { hscroll: document.documentElement.scrollWidth > vw + 0.5, over: [], small: [] };
    for (const el of document.querySelectorAll('#app *, #layer *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.over.push(el.className || el.tagName); }
    for (const b of document.querySelectorAll('#app button, #app input, #layer button')) { const r = b.getBoundingClientRect(); if (r.width && (r.width < 47.5 || r.height < 47.5)) out.small.push((b.textContent || b.id).trim().slice(0, 18) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); }
    return out;
  });
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const colours = (p, sels) => p.evaluate(sels => sels.map(sel => { const el = document.querySelector(sel); if (!el) return null; let n = el, bg = null; while (n) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); if (m.length < 4 || m[3] > .99) { bg = c; break; } n = n.parentElement; } return { sel, color: getComputedStyle(el).color, bg: bg || 'rgb(255,251,240)' }; }), sels);
  const bad = [], lowC = [];
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => /Shared: 2 phones/.test(await syncText(A)));
  await fakeServe(A, 5); await fakeServe(B, 3); await until(async () => (await rem(A)) === 72, 6000); await wait(500);
  const snap = async (p, name, sels = ['#syncrow', '#synctxt', '#syncrow small', '.stock .n']) => {
    await p.screenshot({ path: path.join(SHOTS, 'sync-' + name + '.png') });
    const l = await layout(p); if (l.hscroll || l.over.length || l.small.length) bad.push(name + ' ' + JSON.stringify(l));
    for (const c of (await colours(p, sels)).filter(Boolean)) { const r = ratio(rgb(c.color), rgb(c.bg)); if (r < 4.5) lowC.push(`${name} ${c.sel} ${r.toFixed(2)}`); }
  };
  await snap(A, '1-home-shared');
  await A.ctx.setOffline(true); await fakeServe(A, 1); await until(async () => (await st(A)) === 'offline', 14000); await snap(A, '2-home-offline');
  await A.ctx.setOffline(false); await until(async () => (await st(A)) === 'ok', 10000);
  mock.ctl.deny = true; await fakeServe(A, 1); await until(async () => (await st(A)) === 'error', 8000); await snap(A, '3-home-error'); mock.ctl.deny = false;
  await until(async () => (await st(A)) === 'ok' && (await unsent(A)) === 0, 12000);
  await tap(A, '[data-act=summary]'); await A.waitForSelector('#phones'); await wait(300); await snap(A, '4-summary', ['#syncrow', '#stats .stat b', '#phones', '.sec']);
  await A.evaluate(() => { document.querySelector('.main').scrollTop = 99999; }); await wait(200); await snap(A, '5-summary-bottom', ['#teamcode', '.sub']);
  await tap(A, '[data-act=share]'); await wait(300); await snap(A, '6-join-qr', ['.sheet h3', '.sheet .sub']); await tap(A, '[data-act=modal-close]');
  const hb = await A.$('[data-hold]'); await hb.scrollIntoViewIfNeeded(); const bb = await hb.boundingBox();
  await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await A.mouse.down(); await wait(2300); await A.mouse.up(); await A.waitForSelector('[data-act=reset-yes]'); await wait(200);
  await snap(A, '7-reset-confirm', ['.sheet h3', '.sheet .sub']); await tap(A, '[data-act=modal-close]');
  await tap(A, '[data-act=back-home]');
  const J = await phone('', { join: false }); await J.waitForSelector('#code'); await snap(J, '8-join-screen', ['.title', '.sub', '#code']);
  await toResultWin(B); await fakeServe(A, 1); await A.evaluate(() => { CC.state().adj = -(CC.state().startStock) + 1; CC.commit(); });
  await until(async () => /sold out/i.test(await B.innerText('#resbanner').catch(() => '')), 6000); await snap(B, '9-result-sold-out', ['.banner b', '.banner small', '.fact p']);
  check('New screens (status bar states, Summary, join QR, reset sheet, Join screen, sold out): no horizontal overflow, all tap targets >= 48px', bad.length === 0, bad.join(' | '));
  check('New screens: text contrast meets 4.5:1 in every sync state', lowC.length === 0, lowC.join(' | '));
  check('No JS errors on the new screens', [A, B, J].every(p => p.errors.length === 0), [A, B, J].flatMap(p => p.errors).join(' | '));
  await reset();

  // leaving and re-joining a team (same phone) must not be blocked by the "never go backwards" rule
  const T = await phone('Phone T'); await until(async () => (await st(T)) === 'ok');
  await fakeServe(T, 3); await until(async () => (await cloudServed()) === 3, 8000);
  const other = newTeam();
  await tap(T, '[data-act=summary]'); await tap(T, '[data-act=change-team]'); await T.fill('#code', other); await tap(T, '[data-act=join-go]');
  await T.waitForSelector('[data-act=join-yes]'); await tap(T, '[data-act=join-yes]');
  await until(async () => (await st(T)) === 'ok', 8000); await fakeServe(T, 1); await wait(3000);
  await tap(T, '[data-act=summary]'); await tap(T, '[data-act=change-team]'); await T.fill('#code', TEAM); await tap(T, '[data-act=join-go]');
  await T.waitForSelector('[data-act=join-yes]'); await tap(T, '[data-act=join-yes]');
  await until(async () => (await st(T)) === 'ok' && !(await T.$('.sheet')), 8000);
  await fakeServe(T, 2);
  check('Leaving a team and re-joining it works (no "Sharing problem"), old serves still counted', await until(async () => (await st(T)) === 'ok' && (await unsent(T)) === 0 && (await cloudServed()) === 5, 10000), `state=${await st(T)} cloud=${(await cloudServed())}`);
  await reset();
}

/* ===================== 15. rapid taps on the shared total over a slow network ===================== */
if (mock) {   // regression: a slow reply to the first tap must not overwrite the second tap
  const A = await phone('Phone A'), B = await phone('Phone B');
  await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  mock.ctl.delayMs = 700;
  await tap(A, '[data-act=summary]'); await A.waitForSelector('[data-act="start+"]'); await wait(350);
  for (let i = 0; i < 4; i++) { await A.click('[data-act="start+"]'); await wait(520); }
  mock.ctl.delayMs = 0;
  check('Four +5 taps over a slow network add exactly 20 for every phone', await until(async () => (await rem(A)) === 100 && (await rem(B)) === 100, 15000), `A=${await rem(A)} B=${await rem(B)}`);
  check('Total food at start in the database is 100', ((await cloudMeta()) || {}).startStock === 100);
  check('No JS errors', A.errors.length + B.errors.length === 0, A.errors.concat(B.errors).join(' | '));
  await reset();
}

await closeAll(); await cleanup(); await browser.close(); web.close(); if (mock) await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} sync checks passed`);
fs.writeFileSync(path.join(ROOT, 'tests', 'last-sync-run.json'), JSON.stringify({ passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
