// Organiser (admin) phone: who is the admin, messages to every phone, pause and lock, shared event settings,
// delivery under failures and odd data, live numbers and alerts, small screens, and the Instagram browser (sections A to K);
// stall modes, question pool, per-phone controls, update speed, delivery tracking and refresh, reserve, undo and change list,
// odd and old data, and the longer console on the smallest phone (sections L to T).
//   node admin.mjs            (SECTIONS=A,B,... to pick sections;  BROWSER=webkit node admin.mjs for the Safari engine)
import { chromium, webkit, firefox, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit, firefox }[process.env.BROWSER || 'chromium'];
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
const SECTIONS = (process.env.SECTIONS || '').split(',').filter(Boolean); const want = n => !SECTIONS.length || SECTIONS.includes(n);
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(150); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newTeam = () => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
let TEAM = newTeam(); const phones = [];
async function phone(label, o = {}) {
  const ctx = await browser.newContext({ ...D, ...(o.ctx || {}) });
  if (!o.noOverride) await ctx.addInitScript(([k, u]) => { try { localStorage.setItem(k, u); } catch (e) {} }, ['ecomsoc-sync-url', mock.url]);
  if (o.offsetMs) await ctx.addInitScript(off => { const R = Date; class D2 extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } } window.Date = D2; }, o.offsetMs);
  if (o.init) await ctx.addInitScript(o.init, o.initArg);
  await ctx.addInitScript(() => { window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} }); });
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|NetworkError|JSON|Unexpected token/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + (o.join === false ? '' : '#t=' + (o.team || TEAM))); await page.waitForSelector('#app *');
  if (label) await page.evaluate(l => { CC.state().label = l; CC.commit(); }, label);
  phones.push(page); return page;
}
async function closeAll() { for (const p of phones.splice(0)) { rejs.push(...(await p.evaluate(() => window.__rej || []).catch(() => []))); await p.ctx.close().catch(() => {}); } }
async function reset() { await closeAll(); mock.reset(); TEAM = newTeam(); }
const rem = p => p.evaluate(() => CC.remaining()); const st = p => p.evaluate(() => CC.syncState()); const unsent = p => p.evaluate(() => CC.unsent());
const tap = async (p, sel) => { await p.waitForSelector(sel, { state: 'visible' }); await wait(330); await p.click(sel); };
const fakeServe = (p, n) => p.evaluate(n => { const S = CC.state(); for (let i = 0; i < n; i++) { S.c.customers++; S.c.follows++; S.c.correct++; S.c.won++; S.c.hot++; S.c.served++; S.first = S.first || Date.now(); S.last = Date.now(); CC.commit(); } }, n);
const toQuestion = async p => { await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await tap(p, '[data-act=member-new]'); await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 4000 }); await wait(450); };
const answer = async (p, ok = true) => { const q = await p.evaluate(() => CC.QUESTIONS.find(x => x.id === CC.state().cur.qid)); const pick = ok ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer); await p.click(`.ans[data-k=${pick}]`); await p.waitForSelector('#result'); };
const cloudDevices = () => { const m = mock.get(['events', TEAM, 'meta']); return mock.get(['events', TEAM, 'epochs', (m && m.epoch) || 'e0', 'devices']) || {}; };
const cloudServed = () => Object.values(cloudDevices()).reduce((a, d) => a + d.c.served, 0);
const NOISE = /due to access control checks|Fetch API cannot load/;       // WebKit logs a cancelled or refused fetch like this even though the app handles it; real unhandled rejections are counted separately below
const noErr = ps => ps.every(p => p.errors.filter(e => !NOISE.test(e)).length === 0);
const errs = ps => ps.flatMap(p => p.errors).filter(e => !NOISE.test(e)).join(' | ');
const rejs = [];


/* ================= organiser (admin) phone tests ================= */
import crypto from 'node:crypto';
const TESTKEY = (() => { let k = ''; for (let i = 0; i < 24; i++) k += chars[crypto.randomInt(32)]; return k; })();
const OTHERKEY = (() => { let k = ''; for (let i = 0; i < 24; i++) k += chars[crypto.randomInt(32)]; return k; })();
const TESTHASH = crypto.createHash('sha256').update(TESTKEY).digest('hex');
const ADMLABEL = "Joseph's Phone (Admin)";
const QLABEL = "Skyson's phone";
const initHash = h => { try { localStorage.setItem('ecomsoc-admin-hash', h); } catch (e) {} };
const hashOpts = { init: initHash, initArg: TESTHASH };
const SKEY = 'ecomsoc-checkout-challenge-v1';
const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
const ctlCloud = () => mock.get(['events', TEAM, 'ctl']);
const st0 = p => p.evaluate(() => CC.state());
async function mkAdmin(o = {}) {
  const A = await phone('', { join: false, ...hashOpts, ...o }); await A.goto('about:blank'); await A.goto(BASE + '#t=' + TEAM + '&a=' + TESTKEY); await A.waitForSelector('#app *');
  await until(async () => await A.evaluate(() => CC.state().admin === true && CC.state().team !== ''), 8000);
  await until(async () => (await st(A)) === 'ok', 8000);
  return A;
}
async function mkVol(label, o = {}) { const V = await phone(label, { ...hashOpts, ...o }); await until(async () => (await st(V)) === 'ok', 8000); return V; }
async function openAdmin(A) { await tap(A, '[data-act=admin-open]'); await A.waitForSelector('#adm-live'); }
async function openAdminFromSummary(A) { await tap(A, '[data-act=back-home]'); await A.waitForSelector('[data-act=admin-open]'); await openAdmin(A); }
async function goHome(A) { await tap(A, '[data-act=back-home]'); await A.waitForSelector('[data-act=next]'); }
const bodyText = p => p.innerText('#app').then(t => t.replace(/\n/g, ' '));
const cloudCtlIs = (pred) => until(async () => { const c = ctlCloud(); return c && pred(c); }, 16000);

/* ---------- A. who is the admin ---------- */
if (want('A')) {
  const A = await mkAdmin();
  check('Admin link: this phone becomes the admin and joins the team', (await st0(A)).admin === true && (await st0(A)).team === TEAM);
  check('...it is named "Joseph\'s Phone (Admin)"', (await st0(A)).label === ADMLABEL, (await st0(A)).label);
  check('...the key and the team code are removed from the address bar', new URL(A.url()).hash === '' && !A.url().includes(TESTKEY));
  check('...the name reaches the database', await until(async () => Object.values(cloudDevices()).some(d => d.l === ADMLABEL), 8000));
  check('...the secret key is not stored anywhere on the phone or in the database', !JSON.stringify(await A.evaluate(() => ({ ...localStorage }))).includes(TESTKEY) && !JSON.stringify(mock.db()).includes(TESTKEY));
  check('...Home shows the ADMIN pill and the organiser console button', await A.isVisible('.pill.adm') && await A.isVisible('[data-act=admin-open]'));
  await A.reload(); await A.waitForSelector('#app *'); await wait(500);
  check('The admin status survives a reload', (await st0(A)).admin === true && await A.isVisible('[data-act=admin-open]'));
  await A.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.label = 'Hacked name'; localStorage.setItem(k, JSON.stringify(s)); }, SKEY);
  await A.reload(); await A.waitForSelector('#app *'); await wait(400);
  check('The admin name cannot be changed by editing stored data', (await st0(A)).label === ADMLABEL);
  await tap(A, '[data-act=summary]'); await A.waitForSelector('#label');
  check('Summary: the admin phone name box is locked', await A.evaluate(() => document.querySelector('#label').disabled) === true);
  check('...and the admin phone still has every volunteer control (food +/-, total, reset)', !!(await A.$('[data-act="stock+"]')) && !!(await A.$('[data-act="start+"]')) && !!(await A.$('[data-hold]')));
  check('No JS errors (admin phone)', noErr([A]), errs([A]));

  // a normal volunteer, a wrong key, a malformed key
  const V = await mkVol('Volunteer 1');
  check('A normal volunteer phone has no admin controls (no console button, no ADMIN pill)', !(await V.$('[data-act=admin-open]')) && !(await V.$('.pill.adm')) && (await st0(V)).admin === false);
  const W = await phone('', { join: false, ...hashOpts }); await W.goto('about:blank'); await W.goto(BASE + '#t=' + TEAM + '&a=' + OTHERKEY); await W.waitForSelector('#app *'); await wait(900);
  check('A wrong admin key joins the team as a normal phone and grants nothing', (await st0(W)).admin === false && (await st0(W)).team === TEAM && !(await W.$('[data-act=admin-open]')) && !new URL(W.url()).hash);
  const M = await phone('', { join: false, ...hashOpts }); await M.goto('about:blank'); await M.goto(BASE + '#t=' + TEAM + '&a=SHORT'); await M.waitForSelector('#app *'); await wait(700);
  check('A malformed key is ignored without errors', (await st0(M)).admin === false && (await st0(M)).team === TEAM);
  const N = await phone('', { join: false, ...hashOpts }); await N.goto('about:blank'); await N.goto(BASE + '#t=' + TEAM); await N.waitForSelector('#app *'); await wait(500);
  check('An ordinary team link never makes anyone admin', (await st0(N)).admin === false);

  // sign in by pasting the key (for the Home Screen app, which has its own storage)
  await tap(V, '[data-act=summary]'); await V.waitForSelector('[data-act=admin-signin]');
  await tap(V, '[data-act=admin-signin]'); await V.waitForSelector('#adminkey');
  await V.fill('#adminkey', OTHERKEY.toLowerCase()); await tap(V, '[data-act=admin-signin-go]'); await wait(700);
  check('Organiser sign-in with a wrong key is refused and says so', (await st0(V)).admin === false && /not valid/i.test(await V.evaluate(() => (document.querySelector('#toast') || {}).textContent || '')));
  await tap(V, '[data-act=admin-signin]'); await V.waitForSelector('#adminkey');
  await V.fill('#adminkey', TESTKEY.slice(0, 4) + '-' + TESTKEY.slice(4, 8) + ' ' + TESTKEY.slice(8).toLowerCase()); await V.press('#adminkey', 'Enter');
  check('Organiser sign-in with the right key (pasted with dashes, spaces, lower case) makes it the admin with the fixed name', await until(async () => (await st0(V)).admin === true && (await st0(V)).label === ADMLABEL, 6000));
  await V.waitForSelector('[data-act=admin-open]');
  check('There is no sign-out: an admin phone keeps its admin status (no sign-out button in Summary)', !(await V.$('[data-act=admin-out]')) && !/sign out/i.test(await V.innerText('#app')));
  // "always the admin on this device": a fresh session, a closed browser, damaged or cleared data
  const state = await A.ctx.storageState();
  const reopen = async (st, extra = {}) => { const P = await phone('', { join: false, init: initHash, initArg: TESTHASH, ...extra, ctx: { storageState: st, ...(extra.ctx || {}) } }); await P.goto('about:blank'); await P.goto(BASE); await P.waitForSelector('#app *'); await wait(500); return P; };
  const R1 = await reopen(state);
  check('A fresh session (browser closed and opened again) is still the admin, with the fixed name and no key needed', (await st0(R1)).admin === true && (await st0(R1)).label === ADMLABEL && (await st0(R1)).team === TEAM && await R1.isVisible('[data-act=admin-open]'));
  const R2 = await reopen({ cookies: state.cookies, origins: [] });
  check('If the app\'s stored data is wiped but the long-lived cookie remains, it is still the admin', (await st0(R2)).admin === true && (await st0(R2)).label === ADMLABEL);
  const lockItem = state.origins.flatMap(o => o.localStorage).filter(i => i.name === 'ecomsoc-admin-lock');
  const R3 = await reopen({ cookies: [], origins: [{ origin: new URL(BASE).origin, localStorage: lockItem }] });
  check('If only the second stored copy remains, it is still the admin', lockItem.length === 1 && (await st0(R3)).admin === true);
  await A.evaluate(k => { localStorage.setItem(k, '{broken json'); }, SKEY); await A.reload(); await A.waitForSelector('#app *'); await wait(400);
  check('If the main saved data is damaged, the admin status comes back from the extra copies', (await st0(A)).admin === true && (await st0(A)).label === ADMLABEL);
  const sha = k => crypto.createHash('sha256').update(k).digest('hex');
  const R4 = await reopen(state, { init: initHash, initArg: sha(OTHERKEY) });
  check('A new admin key (changed hash) ends the old admin phones: nobody stays admin by accident', (await st0(R4)).admin === false && !(await R4.$('[data-act=admin-open]')));
  const R5 = await phone('', { join: false, ...hashOpts }); await R5.goto('about:blank'); await R5.goto(BASE); await R5.waitForSelector('#app *'); await wait(400);
  check('A brand-new phone with no data is never admin', (await st0(R5)).admin === false);
  check('No JS errors (volunteer, wrong-key, malformed, sign-in and reopened phones)', noErr([V, W, M, N, R1, R2, R3, R4, R5, A]), errs([V, W, M, N, R1, R2, R3, R4, R5, A]));
  await reset();
}

/* ---------- B. message to every phone ---------- */
if (want('B')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2');
  await openAdmin(A);
  await tap(A, '[data-act=adm-send]');
  check('Sending an empty message is refused', !ctlCloud() || !ctlCloud().msg);
  await tap(A, '[data-act=adm-preset][data-t="Only 10 serves left"]');
  check('A quick-message button fills the box', (await A.inputValue('#bmsg')) === 'Only 10 serves left' && /19 \/ 140/.test(await A.innerText('#bcount')));
  await A.fill('#bmsg', '  Free   <b>Thai</b> food  is nearly gone  '); await tap(A, '[data-act=adm-send]');
  check('The message reaches the database (spaces tidied, id and style stored)', await cloudCtlIs(c => c.msg && c.msg.t === 'Free <b>Thai</b> food is nearly gone' && c.msg.k === 'info' && /^[0-9a-f]{8}$/.test(c.msg.id)), JSON.stringify(ctlCloud()));
  check('...both volunteer phones show it as a banner within a few seconds', await until(async () => (await V.isVisible('#bcast')) && (await V2.isVisible('#bcast')), 16000));
  check('...the text is shown as plain text (nothing is injected as HTML)', (await V.innerText('#bcast')).includes('<b>Thai</b>') && (await V.$$('#bcast b')).length === 0);
  check('...the admin phone does not get its own banner, and shows what is currently sent', !(await A.$('#bcast')) && /<b>Thai<\/b>/.test(await A.innerText('#admmsg')));
  await wait(600);
  const bb = await V.evaluate(() => { const r = document.querySelector('#bcast').getBoundingClientRect(), b = document.querySelector('#bcast button').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, vw: innerWidth, bh: b.height, role: document.querySelector('#bcast').getAttribute('role') }; });
  check('...the banner is on screen, has a 48 px Got it button and is announced to screen readers', bb.top >= 0 && bb.bottom < 400 && bb.w <= bb.vw && bb.bh >= 47.5 && bb.role === 'alert', JSON.stringify(bb));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-broadcast-volunteer.png') });
  await tap(V, '[data-act=bcast-ok]'); await wait(300);
  check('Got it hides the banner on that phone only', !(await V.$('#bcast')) && (await V2.isVisible('#bcast')));
  await V.reload(); await V.waitForSelector('#app *'); await wait(2800);
  check('...and it stays hidden after a reload (it is not shown twice)', !(await V.$('#bcast')));
  // important style, new message returns, mid-customer
  await toQuestion(V);
  await A.fill('#bmsg', 'Please check your bar is green'); await tap(A, '[data-act=adm-kind][data-k=warn]'); await tap(A, '[data-act=adm-send]');
  check('A new (important) message shows again on a phone that dismissed the old one, even in the middle of a customer', await until(async () => await V.isVisible('#bcast.warn'), 16000) && !!(await V.$('.ans[data-act=answer]')));
  await tap(V, '[data-act=bcast-ok]'); await wait(300);
  await answer(V, true);
  check('Dismissing it mid-customer does not disturb the customer', !!(await V.$('#servebtn')) && !(await V.$('#bcast')));
  await tap(V, '#servebtn'); await V.waitForSelector('[data-act=next]');
  // clear
  await tap(A, '[data-act=adm-clear]');
  check('Clear message removes it from the database and from phones that had not dismissed it', await cloudCtlIs(c => !c.msg) && await until(async () => !(await V2.$('#bcast')), 16000));
  // long text and a tampered record
  check('The message box limits text to 140 characters', await A.evaluate(() => document.querySelector('#bmsg').maxLength) === 140);
  // offline phone gets it when it comes back
  await V2.ctx.setOffline(true); await wait(500);
  await A.fill('#bmsg', 'Back online message'); await tap(A, '[data-act=adm-send]'); await cloudCtlIs(c => c.msg && c.msg.t === 'Back online message');
  await wait(1500); const stillNone = !(await V2.$('#bcast'));
  await V2.ctx.setOffline(false);
  check('An offline phone does not see a message until it is back, then shows it', stillNone && await until(async () => await V2.isVisible('#bcast'), 12000));
  // tampered database record
  mock.db().events[TEAM].ctl = { rev: 500, paused: false, locked: false, mem: true, hot: 70, retries: 1, msg: { id: 'x', t: 'y'.repeat(140), k: 'warn' } };
  await until(async () => (await V.evaluate(() => (CC.state().ctl || {}).rev)) === 500, 16000);
  check('A message of the right shape from the database is shown; the app never trusts more than 140 characters', (await V.evaluate(() => CC.state().ctl.msg.t.length)) <= 140);
  check('No JS errors', noErr([A, V, V2]), errs([A, V, V2]));
  await reset();
}

/* ---------- C. pause the stall and lock volunteer settings ---------- */
if (want('C')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A); await A.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-console-top.png') });
  await toQuestion(V);                                  // a customer is in progress when the stall is paused
  await tap(A, '[data-act=adm-pause]');
  check('Pause reaches the database', await cloudCtlIs(c => c.paused === true));
  await answer(V, true);
  check('A customer already in progress can finish (serve) while paused', !!(await V.$('#servebtn')));
  await tap(V, '#servebtn'); await V.waitForSelector('[data-act=next]');
  check('Volunteer Home shows "Stall paused" and the Next customer button is disabled', await until(async () => /Stall paused/.test(await bodyText(V)) && await V.evaluate(() => !!document.querySelector('[data-act=next][disabled]')), 16000));
  await V.click('[data-act=next]', { force: true, timeout: 1500 }).catch(() => {}); await wait(400);
  check('Pressing it anyway does not start a customer', (await st0(V)).cur === null && !(await V.$('[data-act=follow-new]')));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-paused-volunteer.png') });
  await V.reload(); await V.waitForSelector('#app *'); await wait(500);
  check('The pause is remembered after a reload', /Stall paused/.test(await bodyText(V)));
  await goHome(A).catch(() => {}); await A.waitForSelector('[data-act=next]');
  check('The admin phone is not blocked while paused (and says so)', await A.evaluate(() => !document.querySelector('[data-act=next][disabled]')) && /paused for volunteers/.test(await bodyText(A)));
  await openAdmin(A); await tap(A, '[data-act=adm-pause]');
  check('Resume enables Next customer again on volunteer phones', await until(async () => await V.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')) && !/Stall paused/.test(await bodyText(V)), 16000));

  await tap(A, '[data-act=adm-lock]');
  check('Lock reaches the database', await cloudCtlIs(c => c.locked === true));
  await tap(V, '[data-act=summary]'); await V.waitForSelector('#stats');
  check('Locked: the volunteer Summary shows a locked note and no food +/-, total or reset controls', await until(async () => !!(await V.$('#lockednote')) && !(await V.$('[data-act="stock+"]')) && !(await V.$('[data-act="start+"]')) && !(await V.$('[data-hold]')), 16000));
  check('...but the volunteer can still copy the summary and change this phone\'s name', !!(await V.$('[data-act=copy]')) && await V.evaluate(() => !document.querySelector('#label').disabled));
  await tap(A, '[data-act=back-home]'); await tap(A, '[data-act=summary]'); await A.waitForSelector('#stats');
  check('The admin phone keeps all of them while locked', !!(await A.$('[data-act="stock+"]')) && !!(await A.$('[data-hold]')));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-locked-volunteer.png') });
  await tap(A, '[data-act=back-home]'); await openAdmin(A); await tap(A, '[data-act=adm-lock]');
  check('Unlock gives the volunteer their controls back', await until(async () => !!(await V.$('[data-act="stock+"]')) && !!(await V.$('[data-hold]')) && !(await V.$('#lockednote')), 16000));
  // a reset by a volunteer does not wipe the organiser's settings
  await tap(A, '[data-act=adm-pause]'); await cloudCtlIs(c => c.paused === true);
  await until(async () => (await V.evaluate(() => CC.state().ctl && CC.state().ctl.paused)) === true, 16000);
  await V.evaluate(() => CC.reset()); await wait(2500);
  check('A reset of the tallies keeps the organiser settings (still paused)', ctlCloud().paused === true && (await V.evaluate(() => CC.state().ctl.paused)) === true);
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- D. event settings for every phone ---------- */
if (want('D')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A);
  await tap(A, '[data-act=adm-mem]');
  check('Switching the membership step off reaches the database and the volunteer phone', await cloudCtlIs(c => c.mem === false) && await until(async () => (await V.evaluate(() => CC.state().ctl && CC.state().ctl.mem)) === false, 16000));
  await tap(V, '[data-act=next]'); await tap(V, '[data-act=follow-new]'); await V.waitForSelector('[data-act=reveal]');
  check('With it off, Follow goes straight to Reveal deal and the steps say 2 of 4', !(await V.$('#qrm')) && /step 2 of 4/i.test(await bodyText(V)));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  // the organiser switches it back on while a customer is waiting at the follow step
  await tap(V, '[data-act=next]'); await V.waitForSelector('[data-act=follow-new]');
  await tap(A, '[data-act=adm-mem]'); await cloudCtlIs(c => c.mem === true); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === true, 16000);
  await tap(V, '[data-act=follow-new]');
  check('Switching it back on: the next customer sees the membership QR (step 2 of 5)', await V.waitForSelector('#qrm', { timeout: 4000 }).then(() => true).catch(() => false) && /step 2 of 5/i.test(await bodyText(V)));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  // switching off while a customer is on the membership step
  await tap(V, '[data-act=next]'); await tap(V, '[data-act=follow-new]'); await V.waitForSelector('#qrm');
  await tap(A, '[data-act=adm-mem]'); await cloudCtlIs(c => c.mem === false); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === false, 16000);
  await V.reload(); await V.waitForSelector('#app *'); await wait(400);
  check('If the step is switched off while a customer is on it, the customer moves on to Reveal deal', !!(await V.$('[data-act=reveal]')) && !(await V.$('#qrm')));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  await A.evaluate(() => CC.adminSet({ mem: true })); await cloudCtlIs(c => c.mem === true); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === true, 16000);
  // hot deal chance
  for (let i = 0; i < 4; i++) await tap(A, '[data-act="adm-hot+"]');
  check('HOT DEAL chance: +10 steps stop at 100 and reach the database', await cloudCtlIs(c => c.hot === 100) && /100%/.test(await A.innerText('#adm-ctl')));
  await until(async () => (await V.evaluate(() => CC.state().ctl.hot)) === 100, 16000);
  const diffs = await V.evaluate(() => Array.from({ length: 24 }, () => { const id = CC.drawQuestion(); return CC.QUESTIONS.find(q => q.id === id).difficulty; }));
  check('At 100% every draw is a HOT DEAL (easy) question', diffs.every(d => d === 'easy'), diffs.join(','));
  await A.evaluate(() => CC.adminSet({ hot: 0 })); await until(async () => (await V.evaluate(() => CC.state().ctl.hot)) === 0, 16000);
  const diffs0 = await V.evaluate(() => Array.from({ length: 24 }, () => { const id = CC.drawQuestion(); return CC.QUESTIONS.find(q => q.id === id).difficulty; }));
  check('At 0% every draw is a FULL PRICE (hard) question', diffs0.every(d => d === 'hard'), diffs0.join(','));
  await A.evaluate(() => CC.adminSet({ hot: 70 }));
  // retries
  await A.evaluate(() => CC.adminSet({ retries: 0 })); await until(async () => (await V.evaluate(() => CC.state().ctl.retries)) === 0, 16000);
  await toQuestion(V); await answer(V, false);
  check('With 0 retries a wrong answer ends the turn: no "try one more" button, counted as lost', !(await V.$('[data-act=retry]')) && (await st0(V)).c.lost === 1, await V.evaluate(() => document.querySelector('.foot').innerText.replace(/\n/g, ' | ')));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  await A.evaluate(() => CC.adminSet({ retries: 2 })); await until(async () => (await V.evaluate(() => CC.state().ctl.retries)) === 2, 16000);
  await toQuestion(V); await answer(V, false);
  let r1 = !!(await V.$('[data-act=retry]')); await tap(V, '[data-act=retry]'); await V.waitForSelector('.ans[data-act=answer]'); await wait(400); await answer(V, false);
  let r2 = !!(await V.$('[data-act=retry]')); await tap(V, '[data-act=retry]'); await V.waitForSelector('.ans[data-act=answer]'); await wait(400); await answer(V, false);
  check('With 2 retries a customer gets three tries before the turn ends', r1 && r2 && !(await V.$('[data-act=retry]')));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- E. delivery: failures, stale numbers, odd data ---------- */
if (want('E')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  // a stale revision number on this phone: the write is refused once, then read the stored copy and go again
  mock.db().events[TEAM].ctl = { rev: 50, paused: false, locked: false, mem: true, hot: 70, retries: 1 };
  await A.evaluate(() => { CC.net.ctlRev = 0; CC.state().ctl = Object.assign({}, CC.state().ctl || { paused: false, locked: false, mem: true, hot: 70, retries: 1, msg: null }, { rev: 0 }); CC.adminSet({ paused: true }); });
  check('A write refused as "older" is retried with the stored revision and lands', await cloudCtlIs(c => c.paused === true && c.rev > 50), JSON.stringify(ctlCloud()));
  await A.evaluate(() => CC.adminSet({ paused: false })); await cloudCtlIs(c => c.paused === false);
  // network trouble
  mock.ctl.failRate = 1; mock.ctl.failStatus = 503;
  await A.evaluate(() => CC.adminSet({ locked: true })); await wait(1500);
  check('While the database is failing, the change is not lost and the console says it is waiting to send', ctlCloud().locked === false && (await A.evaluate(() => CC.adminAlerts().some(a => /waiting to send/.test(a.t)))));
  mock.ctl.failRate = 0;
  check('When the network returns the change lands by itself', await cloudCtlIs(c => c.locked === true));
  await A.evaluate(() => CC.adminSet({ locked: false })); await cloudCtlIs(c => c.locked === false);
  // quick toggles: the last one wins
  await A.evaluate(() => { CC.adminSet({ paused: true }); CC.adminSet({ paused: false }); CC.adminSet({ paused: true }); CC.adminSet({ hot: 40 }); CC.adminSet({ hot: 60 }); });
  check('Several quick changes in a row end with the last value of each', await cloudCtlIs(c => c.paused === true && c.hot === 60), JSON.stringify(ctlCloud()));
  await A.evaluate(() => CC.adminSet({ paused: false, hot: 70 })); await cloudCtlIs(c => c.paused === false && c.hot === 70);
  // odd data in the database
  await until(async () => (await V.evaluate(() => CC.state().ctl && CC.state().ctl.paused === false && CC.state().ctl.hot === 70)), 16000);
  mock.db().events[TEAM].ctl = 'garbage';
  await wait(2800);
  check('Text instead of a settings record is ignored by phones', (await V.evaluate(() => CC.state().ctl)) !== null && (await V.evaluate(() => CC.state().ctl.paused)) === false);
  mock.db().events[TEAM].ctl = { rev: 600, paused: 'yes', locked: 1, mem: 'no', hot: 'lots', retries: 99, msg: { id: '<script>', t: 5, k: 'x' } };
  await until(async () => (await V.evaluate(() => CC.state().ctl.rev)) === 600, 16000);
  const cl = await V.evaluate(() => CC.state().ctl);
  check('Wrong types and out-of-range values are cleaned (not paused, not locked, membership on, 70%, at most 2 retries, bad message dropped)', cl.paused === false && cl.locked === false && cl.mem === true && cl.hot === 70 && cl.retries === 2 && cl.msg === null, JSON.stringify(cl));
  delete mock.db().events[TEAM].ctl;
  check('If the settings record is deleted, phones go back to the normal defaults', await until(async () => (await V.evaluate(() => CC.state().ctl)) === null, 16000) && (await V.evaluate(() => CC.CONFIG.hotDealPercent)) === 70);
  // a volunteer phone cannot write the settings, even by calling the app function
  const wrote = await V.evaluate(() => CC.adminSet({ paused: true })); await wait(900);
  check('A volunteer phone cannot change the organiser settings even if the app function is called', wrote === false && !(ctlCloud() && ctlCloud().paused));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- F. live numbers, alerts and the report ---------- */
if (want('F')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2');
  await fakeServe(V, 6); await fakeServe(V2, 4);
  await until(async () => (await rem(A)) === 70, 16000);
  await openAdmin(A);
  const t = await bodyText(A);
  check('Console: food left, phones online and customers match the team totals', await until(async () => /70\s*Food left/.test(await bodyText(A)) && /3 \/ 3\s*Phones online/.test(await bodyText(A)) && /10\s*Customers/.test(await bodyText(A)), 6000), t.slice(0, 300));
  check('Console: lists every phone with its own numbers', /Volunteer 1/.test(t) && /Volunteer 2/.test(t) && /6 customers/.test(t) && /4 customers/.test(t) && /\(you\)/.test(t));
  check('Alerts: "All good" when nothing is wrong', /No alerts/.test(t) || /All good/.test(t), t.slice(0, 200));
  // pace from this phone's own samples
  const pace = await A.evaluate(() => { const s = CC.samples(); s.length = 0; s.push([Date.now() - 10 * 60000, 0]); return CC.paceInfo(); });
  check('Pace: 10 serves over the last 10 minutes is about 60 an hour', pace.kind === 'recent' && pace.perHr >= 50 && pace.perHr <= 70, JSON.stringify(pace));
  const eta = await A.evaluate(() => CC.etaText());
  check('Sell-out estimate gives a time and minutes (70 left at ~60/h is a bit over an hour)', /about .*\d.*in .*(\d+ min|\d+(\.\d)? h)/.test(eta), eta);
  const none = await A.evaluate(() => { CC.samples().length = 0; return CC.paceInfo(Date.now() - 50 * 3600000); });
  check('Pace with no history does not invent a number', none.kind === 'none' || none.perHr === 0, JSON.stringify(none));
  // alerts
  await fakeServe(V, 58); await until(async () => (await rem(A)) === 12, 16000);
  check('Alert: "Running low" at 15 or fewer', await A.evaluate(() => CC.adminAlerts().some(a => /Running low: 12/.test(a.t))));
  await A.evaluate(() => { const k = Object.keys(CC.state().peers)[0]; CC.net.seen[k].t = Date.now() - 80000; });
  check('Alert: a phone that was online and went quiet is reported by name', await A.evaluate(() => CC.adminAlerts().some(a => /went offline/.test(a.t))));
  await A.evaluate(() => { const s = CC.samples(); s.length = 0; });
  // report
  const rep = await A.evaluate(() => CC.adminReport());
  check('Admin report: contains the normal summary plus pace, win rate, settings and every phone', /EcomSoc Checkout Challenge summary/.test(rep) && /ADMIN REPORT/.test(rep) && /Settings now: stall open, volunteer settings unlocked, membership step on, HOT DEAL chance 70%, retries 1/.test(rep) && /Volunteer 2: /.test(rep) && /Win rate/.test(rep), rep.split('\n').slice(-8).join(' / '));
  // sold out and over-served
  await fakeServe(V, 12); await until(async () => (await rem(A)) === 0, 16000);
  check('Alert: sold out', await A.evaluate(() => CC.adminAlerts().some(a => /sold out/.test(a.t))));
  await goHome(A); await wait(400);
  check('Home: the console button shows a red alert count', await A.isVisible('#adminrow .alertn'));
  check('No JS errors', noErr([A, V, V2]), errs([A, V, V2]));
  await reset();
}

/* ---------- G. small screens and the long console ---------- */
if (want('G')) {
  const A = await mkAdmin({ ctx: { viewport: { width: 320, height: 568 } } }), V = await mkVol('Volunteer 1', { ctx: { viewport: { width: 320, height: 568 } } });
  await A.setViewportSize({ width: 320, height: 568 }); await V.setViewportSize({ width: 320, height: 568 });
  await openAdmin(A); await wait(300);
  const lay = await A.evaluate(() => {
    const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('hscroll');
    document.querySelectorAll('#app button, #app textarea').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.height < 47.5 || r.width < 47.5)) bad.push('small:' + (b.textContent || b.id).trim().slice(0, 14)); if (r.right > innerWidth + 1 || r.left < -1) bad.push('wide:' + (b.textContent || b.id).trim().slice(0, 14)); });
    const m = document.querySelector('.main'); return { bad, scrolls: m.scrollHeight > m.clientHeight };
  });
  check('Console on the smallest phone (320 x 568): no sideways scroll, every button is 48 px or more and inside the screen, and it scrolls', lay.bad.length === 0 && lay.scrolls, JSON.stringify(lay));
  await A.evaluate(() => { document.querySelector('.main').scrollTop = 1e5; }); await wait(200);
  check('The last button (Copy admin report) can be reached by scrolling', await A.evaluate(() => { const b = document.querySelector('[data-act=adm-copy]').getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= 0; }));
  await A.fill('#bmsg', 'x'.repeat(140)); await A.evaluate(() => document.querySelector('[data-act=adm-kind][data-k=warn]').click()); await A.evaluate(() => document.querySelector('[data-act=adm-send]').click());
  await until(async () => await V.isVisible('#bcast'), 16000); await wait(600);
  const bl = await V.evaluate(() => { const r = document.querySelector('#bcast').getBoundingClientRect(), b = document.querySelector('#bcast button').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth, bh: b.height }; });
  check('A 140-character important message fits the 320 px screen (banner fully on screen, Got it 48 px)', bl.top >= 0 && bl.left >= 0 && bl.right <= bl.vw && bl.bottom <= bl.vh && bl.bh >= 47.5, JSON.stringify(bl));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-broadcast-320.png') });
  await tap(V, '[data-act=bcast-ok]');
  const lv = await V.evaluate(() => { const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('hscroll'); return bad; });
  check('Volunteer Home on 320 px with the organiser features present has no sideways scroll', lv.length === 0);
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- H. admin link opened inside Instagram ---------- */
if (want('H')) {
  const I = await phone('', { join: false, ...hashOpts, ctx: { userAgent: IGI, ...(IS_CHROMIUM ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) } });
  await I.goto('about:blank'); await I.goto(BASE + '#t=' + TEAM + '&a=' + TESTKEY); await I.waitForSelector('#app *'); await wait(700);
  check('Admin link inside Instagram: shows the open-in-Safari guide, does not join and does not unlock anything there', /Open this in Safari/.test(await I.innerText('#app')) && (await st0(I)).admin === false && (await st0(I)).team === '');
  if (IS_CHROMIUM) { await tap(I, '[data-act=iab-copy]'); await wait(400); const clip = await I.evaluate(() => navigator.clipboard.readText()); check('...Copy link keeps the admin key so it still works in Safari', clip === BASE + '#t=' + TEAM + '&a=' + TESTKEY, clip); }
  await tap(I, '[data-act=iab-continue]');
  check('...Continue anyway applies the team and the admin key', await until(async () => (await st0(I)).admin === true && (await st0(I)).team === TEAM, 8000));
  check('No JS errors', noErr([I]), errs([I]));
  await reset();
}

/* ---------- I. the live numbers are visible on every phone ---------- */
if (want('I')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2');
  await fakeServe(V, 6); await fakeServe(V2, 4);
  await V.evaluate(() => { const S = CC.state(); S.c.members = 3; CC.commit(); });
  await until(async () => (await rem(V2)) === 70 && (await rem(A)) === 70, 16000);
  const tiles = async (p, sel = '#livegrid') => (await p.innerText(sel)).replace(/\s+/g, ' ').trim();
  const want6 = (t, n = '2/2') => new RegExp('^70 Food left ' + n + ' Phones online - Serves').test(t) && /100% Win rate 10 New follows 3 New members$/.test(t);
  const unusedOld = t => /^70 Food left 3\/3 Phones online - Serves\/hour 100% Win rate 10 New follows 3 New members$/.test(t);
  let tv = ''; await until(async () => want6(tv = await tiles(V2)), 16000);
  check('Volunteer Home shows food left, phones online (volunteer phones only), serves per hour, win rate, new follows and new members', want6(tv), tv);
  check('...the admin phone shows the same numbers, and counts every phone including itself (3/3)', want6(await tiles(A), '3/3'), await tiles(A));
  await tap(V2, '[data-act=summary]'); await V2.waitForSelector('#livegrid2');
  check('Summary shows the same live numbers with a line saying how serves per hour is worked out', want6(await tiles(V2, '#livegrid2')) && /Serves per hour appears after a few minutes/.test(await V2.innerText('#livebasis')), await V2.innerText('#livebasis'));
  await tap(V2, '[data-act=back-home]'); await V2.waitForSelector('[data-act=next]');
  await V2.evaluate(() => { const s = CC.samples(); s.length = 0; s.push([Date.now() - 10 * 60000, 0]); });
  check('Serves per hour appears on a volunteer phone from its own readings (10 serves in 10 minutes is about 60 an hour)', await until(async () => { const m = (await tiles(V2)).match(/(\d+) Serves\/hour/); return m && +m[1] >= 50 && +m[1] <= 70; }, 6000), await tiles(V2));
  await fakeServe(V, 1); await V.evaluate(() => { const S = CC.state(); S.c.members++; CC.commit(); });
  check('The numbers update on other phones within seconds when someone serves (food 69, 11 new follows, 4 new members)', await until(async () => /^69 Food left 2\/2 Phones online/.test(await tiles(V2)) && /11 New follows 4 New members$/.test(await tiles(V2)), 16000), await tiles(V2));
  await V2.setViewportSize({ width: 320, height: 568 }); await wait(250);
  const geo = await V2.evaluate(() => { const g = document.querySelector('#livegrid').getBoundingClientRect(); return { hs: document.documentElement.scrollWidth > innerWidth + 1, l: g.left, r: g.right, vw: innerWidth }; });
  check('Home with the live numbers fits a 320 px wide phone', !geo.hs && geo.l >= 0 && geo.r <= geo.vw, JSON.stringify(geo));
  await V2.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'live-numbers-volunteer-320.png') });
  await V2.setViewportSize({ width: 375, height: 667 }); await wait(200); await V2.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'live-numbers-volunteer.png') });
  check('No JS errors', noErr([A, V, V2]), errs([A, V, V2]));
  await reset();
}

/* ---------- J. the organiser phone is always first in the Phones list ---------- */
if (want('J')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  const adminId = (await st0(A)).id;
  check('The admin phone writes who it is to a record that a reset does not clear', await until(async () => { const a = mock.get(['events', TEAM, 'admin']); return a && a.id === adminId && a.l === ADMLABEL && typeof a.hb === 'number'; }, 16000), JSON.stringify(mock.get(['events', TEAM, 'admin'])));
  const rows = async p => (await p.$$eval('#phones .kv', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim())));
  await tap(V, '[data-act=summary]'); await V.waitForSelector('#phones');
  await until(async () => /Joseph's Phone \(Admin\)/.test((await rows(V))[0] || ''), 16000);
  let r = await rows(V);
  check('Volunteer Summary: "Joseph\'s Phone (Admin)" is the first row with its numbers only (no online/offline, no last seen), then this phone', /^Joseph's Phone \(Admin\) 0 customers 0 served$/.test(r[0]) && /^Volunteer 1 \(you\)/.test(r[1]), JSON.stringify(r));
  const seenOnline = { row: r[0], tiles: (await V.innerText('#livegrid2')).replace(/\s+/g, ' ') };
  await tap(A, '[data-act=summary]'); await A.waitForSelector('#phones');
  await until(async () => (await rows(A)).length >= 2, 16000);
  const rA = await rows(A);
  check('The admin phone sees its own row first too, and every other phone after it', /^Joseph's Phone \(Admin\) \(you\)/.test(rA[0]) && /Volunteer 1/.test(rA[1]), JSON.stringify(rA));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'phones-list-admin-first.png') });
  // the admin phone goes away
  const state = await A.ctx.storageState(); await A.ctx.close(); phones.splice(phones.indexOf(A), 1);
  await V.evaluate(() => { const S = CC.state(), k = S.adminInfo.id; CC.net.adminSeen = { hb: S.adminInfo.hb, t: Date.now() - 80000 }; if (CC.net.seen[k]) CC.net.seen[k].t = Date.now() - 80000; });
  await tap(V, '[data-act=back-home]'); await tap(V, '[data-act=summary]'); await V.waitForSelector('#phones');
  r = await rows(V);
  check('With the admin phone offline it is still the first row and shows nothing about online, offline or last seen', /^Joseph's Phone \(Admin\) 0 customers 0 served$/.test(r[0]) && !/online|offline|seen/i.test(r[0]), JSON.stringify(r));
  const tilesNow = (await V.innerText('#livegrid2')).replace(/\s+/g, ' ');
  check('...and the volunteer screens are identical whether the admin phone is online or offline (row and phones-online tile, 1/1 volunteer phone)', r[0] === seenOnline.row && tilesNow.replace(/\d+ Serves\/hour|- Serves\/hour/, '') === seenOnline.tiles.replace(/\d+ Serves\/hour|- Serves\/hour/, '') && /1\/1 Phones online/.test(tilesNow), seenOnline.tiles + ' || ' + tilesNow);
  check('...and the "Shared: N phones online" line does not count the admin phone either', /Shared: 1 phone online/.test(await V.innerText('#syncrow')), await V.innerText('#syncrow'));
  // a reset starts a new round with no record for the admin phone: it must still be listed
  await V.evaluate(() => CC.reset()); await until(async () => (await V.evaluate(() => CC.state().epoch)) !== 'e0', 16000); await wait(2600);
  await tap(V, '[data-act=back-home]').catch(() => {}); await tap(V, '[data-act=summary]'); await V.waitForSelector('#phones');
  r = await rows(V);
  check('After a reset (new round, no record yet for the admin phone) it is still the first row, with 0 customers', /^Joseph's Phone \(Admin\) 0 customers 0 served$/.test(r[0]), JSON.stringify(r));
  // the volunteer phone loses its network and is reloaded: the list comes from what it remembered
  mock.ctl.refuse = true; await V.reload(); await V.waitForSelector('#app *'); await wait(600);
  await tap(V, '[data-act=summary]'); await V.waitForSelector('#phones');
  r = await rows(V);
  check('A volunteer phone that reloads with no connection still lists the organiser phone first', /^Joseph's Phone \(Admin\) 0 customers 0 served$/.test(r[0]), JSON.stringify(r));
  mock.ctl.refuse = false;
  // a phone that joins late sees it too (the organiser phone was last seen five minutes ago)
  mock.db().events[TEAM].admin.hb = Date.now() - 5 * 60000;
  const V3 = await mkVol('Volunteer 3'); await tap(V3, '[data-act=summary]'); await V3.waitForSelector('#phones');
  await until(async () => /^Joseph's Phone \(Admin\)/.test((await rows(V3))[0] || ''), 16000);
  r = await rows(V3);
  check('A phone that joins later also sees the organiser phone first, with no presence information', /^Joseph's Phone \(Admin\) 0 customers 0 served$/.test(r[0]) && /Volunteer 3 \(you\)/.test(r[1]), JSON.stringify(r));
  // the admin phone comes back
  const syncBefore = (await V3.innerText('#syncrow')).split('\n')[0];
  const A2 = await phone('', { join: false, init: initHash, initArg: TESTHASH, ctx: { storageState: state } }); await A2.goto('about:blank'); await A2.goto(BASE); await A2.waitForSelector('#app *');
  await wait(5000);
  const back = await rows(V3);
  check('When the admin phone comes back, volunteer phones still show no online or offline status for it, and the online count does not change', !/online|offline|seen/i.test(back[0]) && (await V3.innerText('#syncrow')).split('\n')[0] === syncBefore, back[0] + ' | ' + syncBefore + ' -> ' + (await V3.innerText('#syncrow')).split('\n')[0]);
  // a spoofed record changes nothing about the name shown
  mock.db().events[TEAM].admin = { id: 'abcdef123456', l: 'Totally the boss', hb: Date.now() };
  await V3.evaluate(() => { CC.net.adminPollAt = 0; }); await wait(3500); r = await rows(V3);
  check('The organiser row always shows the fixed organiser name, whatever the stored record says', /^Joseph's Phone \(Admin\)/.test(r[0]) && !r.some(x => /Totally the boss/.test(x)), JSON.stringify(r));
  check('No JS errors', noErr([V, V3, A2]), errs([V, V3, A2]));
  await reset();
}

/* ---------- K. a quiet admin: every admin power, but listed like any other phone ---------- */
if (want('K')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  const Q = await phone('', { join: false, ...hashOpts }); await Q.goto('about:blank'); await Q.goto(BASE + '#t=' + TEAM + '&c=' + TESTKEY); await Q.waitForSelector('#app *');
  await until(async () => await Q.evaluate(() => CC.state().admin === true && CC.state().team !== ''), 8000);
  await until(async () => (await st(Q)) === 'ok', 8000);
  const adminId = (await st0(A)).id, qId = (await st0(Q)).id;
  check('A link with c= instead of a= makes a quiet admin: admin on, quiet on, joined the team', (await st0(Q)).admin === true && (await st0(Q)).quiet === true && (await st0(Q)).team === TEAM);
  check('...it is named "Skyson\'s phone" (not the organiser name) and the key leaves the address bar', (await st0(Q)).label === QLABEL && !/c=|a=/.test(await Q.evaluate(() => location.href)), (await st0(Q)).label);
  check('...it has the ADMIN pill and the organiser console button', await Q.isVisible('.pill.adm') && await Q.isVisible('[data-act=admin-open]'));
  await tap(Q, '[data-act=summary]'); await Q.waitForSelector('#label');
  check('Summary: the quiet admin phone name box is locked to that name', await Q.evaluate(() => document.querySelector('#label').disabled) === true && await Q.evaluate(() => document.querySelector('#label').value) === QLABEL);
  await openAdminFromSummary(Q);
  check('The organiser console opens on the quiet admin phone and says "You are an admin"', /You are an admin/.test(await bodyText(Q)));
  // it does not take over the organiser identity
  await wait(4000);
  const rec = mock.get(['events', TEAM, 'admin']);
  check('The shared organiser record still names the real organiser phone, not the quiet admin', rec && rec.id === adminId && rec.l === ADMLABEL, JSON.stringify(rec));
  const mine = mock.get(['events', TEAM, 'epochs']);
  check('The quiet admin is stored like any other phone: no admin marker in its record', JSON.stringify(mine).indexOf(qId) > 0 && !/admin/i.test(JSON.stringify(Object.values(Object.values(mine || {})[0]?.devices || {}).find(d => d.l === QLABEL) || {})));
  // what volunteers see
  const rows = async p => (await p.$$eval('#phones .kv', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim())));
  await tap(V, '[data-act=summary]'); await V.waitForSelector('#phones');
  await until(async () => (await rows(V)).some(x => /^Skyson's phone/.test(x)), 16000);
  const rV = await rows(V);
  check('Volunteer Summary lists the quiet admin as a normal phone with online status, and only the real organiser as admin', rV.some(x => /^Skyson's phone\s+online/.test(x)) && rV.filter(x => /Admin/.test(x)).length === 1 && /^Joseph's Phone \(Admin\)/.test(rV[0]), JSON.stringify(rV));
  // what the real organiser phone sees
  await tap(A, '[data-act=summary]'); await A.waitForSelector('#phones');
  await until(async () => (await rows(A)).some(x => /^Skyson's phone/.test(x)), 16000);
  const rA = await rows(A);
  check('The organiser phone sees it as a normal phone too, after itself', /^Joseph's Phone \(Admin\) \(you\)/.test(rA[0]) && rA.some(x => /^Skyson's phone\s+online/.test(x)) && !rA.some(x => /Skyson's phone.*Admin/.test(x)), JSON.stringify(rA));
  // its own list: organiser first, then itself
  await tap(Q, '[data-act=back-home]').catch(() => {}); await tap(Q, '[data-act=summary]').catch(() => {}); await Q.waitForSelector('#phones');
  await until(async () => (await rows(Q)).length >= 3, 16000);
  const rQ = await rows(Q);
  check('The quiet admin sees the organiser phone first, then itself "(you)", then the rest', /^Joseph's Phone \(Admin\)/.test(rQ[0]) && /^Skyson's phone \(you\)/.test(rQ[1]), JSON.stringify(rQ));
  // admin powers
  await Q.evaluate(() => CC.adminSet({ paused: true })); 
  check('The quiet admin can pause the stall for everyone (reaches the shared settings)', await cloudCtlIs(c => c.paused === true));
  await until(async () => await V.evaluate(() => !!(CC.state().ctl && CC.state().ctl.paused)), 16000);
  check('...and a volunteer phone sees the pause', await V.evaluate(() => CC.state().ctl && CC.state().ctl.paused === true));
  check('...while the quiet admin phone itself is not blocked', await Q.evaluate(() => CC.state().admin === true));
  await Q.evaluate(() => CC.adminSet({ paused: false, msg: { id: 'qmsg1', t: 'Hello from Q', k: 'info' } }));
  check('The quiet admin can send a message to every phone', await cloudCtlIs(c => c.msg && c.msg.t === 'Hello from Q'));
  // staying quiet admin
  await Q.reload(); await Q.waitForSelector('#app *'); await wait(800);
  check('A reload keeps it a quiet admin with the same name', (await st0(Q)).admin === true && (await st0(Q)).quiet === true && (await st0(Q)).label === QLABEL);
  check('The long-lived admin marks are tagged quiet, so wiped data comes back as quiet, not as the organiser', await Q.evaluate(() => /:q$/.test(localStorage.getItem('ecomsoc-admin-lock') || '') && /ecomsoc_admin=[^;]*%3Aq/.test(document.cookie)));
  await Q.evaluate(() => { localStorage.removeItem('ecomsoc-checkout-challenge-v1'); }); await Q.reload(); await Q.waitForSelector('#app *'); await wait(800);
  check('If the main saved data is wiped, it comes back as a quiet admin (never as the named organiser)', (await st0(Q)).admin === true && (await st0(Q)).quiet === true && (await st0(Q)).label === QLABEL, (await st0(Q)).label);
  // a normal admin link still makes the named organiser phone
  const A2 = await mkAdmin();
  check('The normal a= link still makes the named organiser phone (not quiet)', (await st0(A2)).admin === true && (await st0(A2)).quiet === false && (await st0(A2)).label === ADMLABEL);
  check('A wrong key with c= grants nothing', await (async () => { const W = await phone('', { join: false, ...hashOpts }); await W.goto('about:blank'); await W.goto(BASE + '#t=' + TEAM + '&c=' + OTHERKEY); await W.waitForSelector('#app *'); await wait(900); return (await st0(W)).admin === false && !(await W.$('[data-act=admin-open]')); })());
  check('No JS errors', noErr([A, V, Q, A2]), errs([A, V, Q, A2]));
  await reset();
}

/* ================= newer organiser controls: modes, questions, per phone, speed, delivery, reserve, undo ================= */
const toQ = async p => { await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await p.waitForSelector('[data-act=member-new], [data-act=reveal]'); if (await p.$('[data-act=member-new]')) await tap(p, '[data-act=member-new]'); await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 4000 }); await wait(450); };
const idOf = async p => (await st0(p)).id;
const volCtl = (p, f) => until(async () => p.evaluate(f), 16000);
const rowOf = (A, id) => A.locator('#adm-live [data-act=adm-phone][data-id="' + id + '"]');
const toastText = p => p.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
const noOverflow = p => p.evaluate(() => { const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('hscroll'); document.querySelectorAll('#app button, #app textarea, #layer button, #layer textarea').forEach(b => { const r = b.getBoundingClientRect(); if (!r.width) return; if (r.height < 47.5) bad.push('small:' + (b.textContent || b.id).trim().slice(0, 14)); if (r.right > innerWidth + 1 || r.left < -1) bad.push('wide:' + (b.textContent || b.id).trim().slice(0, 14)); }); return bad.join(','); });

/* ---------- L. stall modes: several settings in one tap ---------- */
if (want('L')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A);
  const chips = await A.$$eval('[data-act=adm-mode]', els => els.map(e => e.textContent.trim() + (e.classList.contains('on') ? '*' : '')));
  check('Console: four stall modes are listed, and Normal is the active one on a new team', chips.join('|') === 'Normal*|Rush hour|Quiet time|Clear the stock', chips.join('|'));
  const rev0 = (ctlCloud() || {}).rev || 0;
  await tap(A, '[data-act=adm-mode][data-m=rush]');
  check('Rush hour sets the membership step off, 90% easy and no retry in ONE write', await cloudCtlIs(c => c.mem === false && c.hot === 90 && c.retries === 0 && c.rev === rev0 + 1), JSON.stringify(ctlCloud()));
  check('...the Rush hour button is highlighted and the line under it explains the mode', await A.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=rush]').classList.contains('on') && /Rush hour:/.test(document.querySelector('#modesub').textContent)));
  check('...the volunteer phone gets all three settings together, within a few seconds', await volCtl(V, () => { const c = CC.state().ctl; return c && c.mem === false && c.hot === 90 && c.retries === 0; }));
  await tap(V, '[data-act=next]'); await tap(V, '[data-act=follow-new]'); await V.waitForSelector('[data-act=reveal]');
  check('...a customer then goes Follow, Reveal deal (step 2 of 4): the membership screen is skipped', /step 2 of 4/i.test(await bodyText(V)) && !(await V.$('#qrm')));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  await tap(A, '[data-act=adm-mode][data-m=clear]');
  check('Clear the stock: membership off, 100% easy, 2 retries', await cloudCtlIs(c => c.mem === false && c.hot === 100 && c.retries === 2));
  await volCtl(V, () => CC.state().ctl.hot === 100);
  const dd = await V.evaluate(() => Array.from({ length: 30 }, () => { const id = CC.drawQuestion(); return CC.QUESTIONS.find(q => q.id === id).difficulty; }));
  check('...and every question drawn is a HOT DEAL (easy) one', dd.every(d => d === 'easy'));
  await tap(A, '[data-act=adm-mode][data-m=quiet]');
  check('Quiet time: membership on, 50% easy, 2 retries', await cloudCtlIs(c => c.mem === true && c.hot === 50 && c.retries === 2));
  await tap(A, '[data-act=adm-mode][data-m=normal]');
  check('Normal returns to the everyday settings (membership on, 70%, 1 retry)', await cloudCtlIs(c => c.mem === true && c.hot === 70 && c.retries === 1));
  await tap(A, '[data-act="adm-hot+"]');
  check('Changing any single setting by hand shows "Custom settings" and no mode is highlighted', await until(async () => /Custom settings/.test(await A.innerText('#modesub')) && (await A.$$('[data-act=adm-mode].on')).length === 0, 4000));
  check('The change list (visible on the console) records the modes, newest first', await until(async () => /Easy question chance 80%/.test(await A.innerText('#adm-log')) && /Normal mode on/.test(await A.innerText('#adm-log')), 6000), (await A.innerText('#adm-log')).replace(/\n/g, ' | '));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- M. question pool: switch single questions off ---------- */
if (want('M')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A);
  check('Question pool: collapsed at first, saying 20 of 20 are on', /20 of 20 questions on \(10 easy, 10 hard\)/.test(await A.innerText('[data-act=adm-q-open]')) && (await A.$$('[data-act=adm-q]')).length === 0);
  await tap(A, '[data-act=adm-q-open]');
  check('...opening it lists all 20 questions with their id, kind and text', (await A.$$('[data-act=adm-q]')).length === 20 && /E03 · HOT DEAL/.test(await A.innerText('[data-act=adm-q][data-id=E03]')) && /What does BNPL stand for/.test(await A.innerText('[data-act=adm-q][data-id=E04]')));
  await tap(A, '[data-act=adm-q][data-id=E03]'); await tap(A, '[data-act=adm-q][data-id=H02]');
  check('Switching two questions off reaches the database as a sorted list', await cloudCtlIs(c => c.qoff === 'E03,H02'), JSON.stringify(ctlCloud()));
  check('...the rows say OFF and the heading says 18 of 20', /OFF/.test(await A.innerText('[data-act=adm-q][data-id=E03]')) && /18 of 20 questions on \(9 easy, 9 hard\)/.test(await A.innerText('[data-act=adm-q-open]')));
  await volCtl(V, () => (CC.state().ctl.qoff || []).length === 2);
  const seen = await V.evaluate(() => { const o = []; for (let i = 0; i < 300; i++) o.push(CC.drawQuestion()); return o; });
  check('The volunteer phone never draws a switched-off question (300 draws) but still uses all the others', !seen.includes('E03') && !seen.includes('H02') && new Set(seen).size === 18, new Set(seen).size + ' different');
  // a customer already holding a question keeps it
  await toQ(V); const held = await V.evaluate(() => CC.state().cur.qid);
  await A.evaluate(id => { const c = CC.state().ctl; CC.adminSet({ qoff: c.qoff.concat(id) }); }, held);
  await cloudCtlIs(c => c.qoff.split(',').includes(held)); await wait(1800);
  check('A question switched off while a customer is looking at it stays on that customer\'s screen', (await V.evaluate(() => CC.state().cur.qid)) === held && !!(await V.$('.ans[data-act=answer]')));
  await answer(V, true); await tap(V, '#servebtn'); await V.waitForSelector('[data-act=next]');
  // at least one of each kind stays on
  await tap(A, '[data-act=adm-q-all]'); await cloudCtlIs(c => !c.qoff);
  check('Turn all questions on removes the list from the database', !ctlCloud().qoff && /20 of 20/.test(await A.innerText('[data-act=adm-q-open]')));
  const easy = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09'];
  for (const id of easy) await tap(A, `[data-act=adm-q][data-id=${id}]`);
  await cloudCtlIs(c => (c.qoff || '').split(',').length === 9);
  await tap(A, '[data-act=adm-q][data-id=E10]'); await wait(300);
  check('The last HOT DEAL question cannot be switched off (a message says why)', /Keep at least one HOT DEAL/.test(await toastText(A)) && (ctlCloud().qoff || '').split(',').length === 9 && /ON/.test(await A.innerText('[data-act=adm-q][data-id=E10]')));
  await A.evaluate(() => CC.adminSet({ hot: 100 })); await volCtl(V, () => CC.state().ctl.hot === 100 && CC.state().ctl.qoff.length === 9);
  const only = await V.evaluate(() => Array.from({ length: 40 }, () => CC.drawQuestion()));
  check('...so with only E10 left, every easy draw is E10', only.every(x => x === 'E10'), [...new Set(only)].join(','));
  await A.evaluate(() => CC.adminSet({ hot: 70, qoff: [] })); await volCtl(V, () => CC.state().ctl.qoff.length === 0);
  // tampered list in the database
  mock.db().events[TEAM].ctl = { rev: 700, paused: false, locked: false, mem: true, hot: 70, retries: 1, qoff: 'E01,<script>,,E02,   E03,E01,' + 'X'.repeat(30) };
  await volCtl(V, () => CC.state().ctl.rev === 700);
  const qo = await V.evaluate(() => CC.state().ctl.qoff);
  check('A tampered list is cleaned: only real-looking ids, no duplicates, no HTML', JSON.stringify(qo) === '["E01","E02"]', JSON.stringify(qo));
  mock.db().events[TEAM].ctl = { rev: 701, paused: false, locked: false, mem: true, hot: 100, retries: 1, qoff: easy.concat('E10').join(',') };
  await volCtl(V, () => CC.state().ctl.rev === 701);
  const fall = await V.evaluate(() => Array.from({ length: 30 }, () => CC.drawQuestion()));
  check('If every question of a kind were switched off in the database, the phone still draws questions (the switches are ignored)', fall.length === 30 && fall.every(x => /^E\d\d$/.test(x)));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- N. per-phone controls: hold, message one phone, hide ---------- */
if (want('N')) {
  const A = await mkAdmin(), V1 = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2'), V3 = await mkVol('Volunteer 3');
  const [i1, i2, i3] = [await idOf(V1), await idOf(V2), await idOf(V3)];
  await openAdmin(A);
  await until(async () => (await A.$$('#adm-live [data-act=adm-phone]')).length === 3, 16000);
  check('Console: every other phone is a tappable row (the admin phone itself is not)', (await A.$$('#adm-live [data-act=adm-phone]')).length === 3 && (await A.$$('#adm-phones .kv:not(.phonebtn)')).length === 1);
  await rowOf(A, i1).click(); await A.waitForSelector('#layer [data-act=adm-hold]');
  check('Tapping a phone opens its controls: name, status, numbers, hold, message, hide', /Volunteer 1/.test(await A.innerText('#layer h3')) && /Put this phone on hold/.test(await A.innerText('#layer')) && !!(await A.$('#dmmsg')) && /Hide this phone/.test(await A.innerText('#layer')));
  await A.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-phone-controls.png') });
  await tap(A, '#layer [data-act=adm-hold]');
  check('Hold reaches the database with that phone\'s id only', await cloudCtlIs(c => c.hold === i1), JSON.stringify(ctlCloud()));
  check('...the dialog now offers Resume', /Resume this phone/.test(await A.innerText('#layer')));
  await tap(A, '#layer [data-act=modal-close]');
  check('...the phone row shows an ON HOLD tag', /ON HOLD/.test(await A.innerText(`#adm-live [data-id="${i1}"]`)));
  check('The phone on hold shows "This phone is on hold" and its Next customer button is disabled (and says why)', await until(async () => /This phone is on hold/.test(await bodyText(V1)) && /On hold by organiser/.test(await V1.innerText('[data-act=next]')) && await V1.evaluate(() => !!document.querySelector('[data-act=next][disabled]')), 16000));
  await V1.click('[data-act=next]', { force: true, timeout: 1500 }).catch(() => {}); await wait(300);
  check('...pressing it anyway starts nothing', (await st0(V1)).cur === null);
  check('Other phones are not affected', await V2.evaluate(() => !document.querySelector('[data-act=next][disabled]')) && !/on hold/i.test(await bodyText(V2)));
  await V1.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-phone-on-hold.png') });
  // hold while a customer is in progress: it can finish
  await toQ(V2);
  await A.evaluate(id => { const h = CC.state().ctl.hold.concat(id); CC.adminSet({ hold: h }); }, i2);
  await volCtl(V2, () => CC.state().ctl.hold.length === 2);
  await answer(V2, true);
  check('A customer already in progress on a phone put on hold can still finish and be served', !!(await V2.$('#servebtn')));
  await tap(V2, '#servebtn'); await V2.waitForSelector('[data-act=next]');
  check('...and then that phone is held too', await V2.evaluate(() => !!document.querySelector('[data-act=next][disabled]')));
  await A.evaluate(() => CC.adminSet({ hold: [] }));
  check('Resuming (both) enables Next customer again on the phones, in place', await until(async () => await V1.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')) && await V2.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')), 16000));
  const many = await A.evaluate(() => { CC.adminSet({ hold: Array.from({ length: 40 }, (_, i) => 'phone' + String(i).padStart(6, '0')) }); return CC.state().ctl.hold.length; });
  check('A list of 40 held phones is limited to 14', many === 14);
  await A.evaluate(() => CC.adminSet({ hold: [] })); await cloudCtlIs(c => !c.hold);
  // direct message
  await rowOf(A, i2).click(); await A.waitForSelector('#dmmsg');
  await tap(A, '#layer [data-act=adm-dm]');
  check('Sending an empty message to one phone is refused', /Type a message first/.test(await toastText(A)) && !(ctlCloud() || {}).dm);
  await tap(A, '#layer [data-act=adm-dm-preset][data-t="Come and see me"]');
  check('A quick message fills the box', (await A.inputValue('#dmmsg')) === 'Come and see me');
  await tap(A, '#layer [data-act=adm-dm-kind][data-k=warn]'); await tap(A, '#layer [data-act=adm-dm]');
  check('The message is stored under that phone only, with its style', await cloudCtlIs(c => c.dm && Object.keys(c.dm).length === 1 && c.dm[i2] && c.dm[i2].t === 'Come and see me' && c.dm[i2].k === 'warn'), JSON.stringify((ctlCloud() || {}).dm));
  check('...only that phone shows it, as an important message for this phone', await volCtl(V2, () => !!document.querySelector('#bcast.warn')) && /Important: message for this phone/i.test(await V2.innerText('#bcast')) && !(await V1.$('#bcast')) && !(await V3.$('#bcast')));
  check('...the admin sees it has not been read yet', await until(async () => (await A.evaluate(() => CC.deliveryInfo().dmWaiting)).join() === 'Volunteer 2', 6000) && /not yet seen by Volunteer 2/.test(await A.innerText('#adm-deliv')));
  await tap(A, '#layer [data-act=modal-close]');
  // a message for everyone arrives while this one is open: this phone's own message comes first
  await A.evaluate(() => CC.adminSet({ msg: { id: 'allmsg01', t: 'Hello everyone', k: 'info' } }));
  await volCtl(V1, () => !!document.querySelector('#bcast'));
  await wait(3500);
  check('A phone with a message of its own and one for everyone shows its own first, then the shared one', /Come and see me/.test(await V2.innerText('#bcast')));
  await tap(V2, '[data-act=bcast-ok]'); await wait(300);
  check('...tapping Got it shows the shared message next', /Hello everyone/.test(await V2.innerText('#bcast')));
  await tap(V2, '[data-act=bcast-ok]'); await wait(300);
  check('...and then the screen is clear', !(await V2.$('#bcast')));
  check('The admin sees that phone has read its message', await until(async () => (await A.evaluate(() => CC.deliveryInfo().dmWaiting)).length === 0 && cloudDevices()[i2] && cloudDevices()[i2].dk, 8000), JSON.stringify(cloudDevices()[i2] && cloudDevices()[i2].dk));
  await V2.reload(); await V2.waitForSelector('#app *'); await wait(2800);
  check('A message already read does not come back after a reload', !(await V2.$('#bcast')));
  await rowOf(A, i2).click(); await A.waitForSelector('#layer [data-act=adm-dm-clear]');
  await tap(A, '#layer [data-act=adm-dm-clear]');
  check('Clear it removes the stored message', await cloudCtlIs(c => !c.dm));
  await tap(A, '#layer [data-act=modal-close]');
  // hide a phone
  await fakeServe(V3, 3); await until(async () => (await rem(A)) === 76 && (await rem(V1)) === 76, 20000);
  const foodBefore = await rem(A);
  const onlineTile = async p => (await p.innerText('#livegrid')).replace(/\s+/g, ' ');
  await rowOf(A, i3).click(); await A.waitForSelector('#layer [data-act=adm-hide]');
  await tap(A, '#layer [data-act=adm-hide]'); await cloudCtlIs(c => c.gone === i3);
  await tap(A, '#layer [data-act=modal-close]');
  check('Hiding a phone moves it from the Phones list to a "Hidden phones" list on the console', await until(async () => (await A.$$('#adm-phones [data-act=adm-phone]')).length === 2 && /Hidden phones \(1\)/.test(await A.innerText('#adm-live')), 8000));
  check('...every phone leaves it out of the Phones list and the phones-online count', await until(async () => !/Volunteer 3/.test(await V1.evaluate(() => CC.teamPhones().map(r => r.name).join()))  && /2\/2 Phones online/.test(await onlineTile(V1)), 16000), await onlineTile(V1));
  check('...but its 3 serves still count in the team totals and the food left (76 = 80 - 1 - 3), unchanged by hiding', foodBefore === 76 && (await rem(V1)) === foodBefore && (await rem(A)) === foodBefore, foodBefore + ' / ' + await rem(V1));
  check('...and the "Shared: N phones online" line does not count it', /Shared: 2 phones online/.test(await V1.innerText('#syncrow')), await V1.innerText('#syncrow'));
  await V3.ctx.close(); phones.splice(phones.indexOf(V3), 1);
  await A.evaluate(id => { const k = id; CC.net.seen[k] && (CC.net.seen[k].t = Date.now() - 90000); }, i3); await wait(500);
  check('A hidden phone that goes offline raises no "went offline" alert', !(await A.evaluate(() => CC.adminAlerts().some(a => /Volunteer 3/.test(a.t)))));
  check('The CSV table still lists the hidden phone and counts its serves in the total', /Volunteer 3,[^\n]*,3,/.test(await A.evaluate(() => CC.adminCsv())) || /Volunteer 3/.test(await A.evaluate(() => CC.adminCsv())));
  await A.locator('#adm-hidden [data-act=adm-phone]').click(); await A.waitForSelector('#layer [data-act=adm-hide]');
  await tap(A, '#layer [data-act=adm-hide]'); await cloudCtlIs(c => !c.gone);
  await tap(A, '#layer [data-act=modal-close]');
  check('Showing it again puts it back in the Phones list', await until(async () => (await A.$$('#adm-phones [data-act=adm-phone]')).length === 3 && !/Hidden phones/.test(await A.innerText('#adm-live')), 8000));
  const selfModal = await A.evaluate(id => { CC.state(); return document.querySelector('#layer').innerHTML; }, i1);
  check('A phone cannot hold or hide itself or the organiser: no phone dialog for the admin phone', !(await A.$$('#adm-phones .kv:not(.phonebtn) [data-act]')).length);
  check('No JS errors', noErr([A, V1, V2]), errs([A, V1, V2]));
  await reset();
}

/* ---------- O. update speed and the network load ---------- */
if (want('O')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A);
  check('Auto speed: 2 s for up to 12 phones, then slower as the team grows (3, 5, 8, 12 s)', await A.evaluate(() => [1, 12, 13, 24, 25, 40, 41, 70, 71, 150].map(n => CC.autoPollSecs(n)).join()) === '2,2,3,3,5,5,8,8,12,12');
  check('...so two phones check every 2 seconds', (await V.evaluate(() => CC.pollEveryMs())) === 2000);
  // an idle phone must not keep rewriting its saved data (cleaning an already clean record must give the same record)
  await V.evaluate(() => { window.__w = 0; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k) { if (k === 'ecomsoc-checkout-challenge-v1') window.__w++; return o.apply(this, arguments); }; });
  await wait(13000);
  const writes = await V.evaluate(() => window.__w);
  check('An idle phone does not rewrite its saved data on every check (' + writes + ' writes in 13 seconds, at most 4)', writes <= 4, String(writes));
  await tap(A, '[data-act=adm-poll][data-s="8"]');
  check('Choosing 8 s reaches the database and the volunteer phone', await cloudCtlIs(c => c.poll === 8) && await volCtl(V, () => CC.pollEveryMs() === 8000));
  check('...the 8 s button is highlighted', await A.evaluate(() => document.querySelector('[data-act=adm-poll][data-s="8"]').classList.contains('on')));
  const cnt = async ms => { const t0 = Date.now(); const before = mock.stats.log.length; await wait(ms); return mock.stats.log.slice(before).filter(r => r.m === 'GET' && /devices$/.test(r.p)).length; };
  await wait(9000);
  const slow = await cnt(16000);
  await A.evaluate(() => CC.adminSet({ poll: 2 })); await volCtl(V, () => CC.pollEveryMs() === 2000); await wait(9000);
  const fast = await cnt(16000);
  check('At 8 s the two phones read the team numbers far less often than at 2 s (' + slow + ' vs ' + fast + ' reads in 16 s)', slow <= 8 && fast >= slow * 2, slow + ' vs ' + fast);
  await A.evaluate(() => CC.adminSet({ poll: 15 })); await volCtl(V, () => CC.pollEveryMs() === 15000);
  const tSlow = Date.now(); await A.evaluate(() => CC.adminSet({ paused: true }));
  const gotPause = await until(async () => await V.evaluate(() => !!(CC.state().ctl && CC.state().ctl.paused)), 14000);
  check('Even with updates slowed to 15 s, an organiser change reaches a phone within a few seconds (the settings are checked on their own short timer): ' + (Date.now() - tSlow) + ' ms', gotPause && Date.now() - tSlow < 9500, (Date.now() - tSlow) + ' ms');
  check('...and the team numbers are still checked only every 15 s', (await V.evaluate(() => CC.pollEveryMs())) === 15000);
  await A.evaluate(() => CC.adminSet({ paused: false }));
  await tap(A, '[data-act=adm-poll][data-s="0"]'); await cloudCtlIs(c => c.poll === undefined);
  check('Auto removes the setting from the database', ctlCloud().poll === undefined && await volCtl(V, () => CC.pollEveryMs() === 2000));
  // a large team slows itself down
  const ep = (mock.get(['events', TEAM, 'meta']) || {}).epoch || 'e0';
  const now = Date.now();
  for (let i = 0; i < 30; i++) mock.db().events[TEAM].epochs[ep].devices['synth' + String(i).padStart(6, '0')] = { l: 'Synth ' + (i + 1), c: { customers: 1, served: 1 }, adj: 0, rev: 1, hb: now, app: 3 };
  check('With 32 phones online Auto slows to 5 s on its own', await volCtl(V, () => CC.livePhones() >= 31 && CC.pollEveryMs() === 5000) , String(await V.evaluate(() => CC.livePhones() + ' phones, ' + CC.pollEveryMs())));
  await openAdmin(A).catch(() => {});
  check('The console lists all 32 phones and is still quick to answer a tap', await until(async () => (await A.$$('#adm-phones [data-act=adm-phone]')).length >= 31, 16000));
  const t0 = Date.now(); await A.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=rush]').click()); const dt = Date.now() - t0;
  check('...a mode change on the console takes effect on screen at once even with 32 phones (' + dt + ' ms)', dt < 400 && await A.evaluate(() => document.querySelector('[data-act=adm-mode][data-m=rush]').classList.contains('on')));
  await wait(2500);
  const load = await A.innerText('#adm-load');
  check('Network load card: phones checking in, update speed, KB per minute and an estimate for the whole team', /Phones checking in\s*\d+/.test(load) && /Update speed\s*every \d+ s/.test(load) && /downloads\s*[\d.]+ (KB|bytes) a minute/.test(load) && /MB an hour/.test(load) && /10 GB a month/.test(load), load.replace(/\n/g, ' | '));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- P. did it arrive? delivery tracking, battery, versions, refresh all phones ---------- */
if (want('P')) {
  const A = await mkAdmin(), V1 = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2');
  const [i1, i2] = [await idOf(V1), await idOf(V2)];
  await openAdmin(A);
  await A.evaluate(() => CC.adminSet({ hot: 60 }));
  check('After a change, the console reports that every online phone has the newest settings', await until(async () => { const d = await A.evaluate(() => CC.deliveryInfo()); return d.online === 2 && d.applied === 2 && d.waiting.length === 0; }, 20000) && /is on 2 of 2 phones ✓/.test(await A.innerText('#adm-deliv')), (await A.innerText('#adm-deliv')).replace(/\n/g, ' | '));
  check('...each phone reported the settings revision it applied (cr) and its app level', !!ctlCloud() && Object.values(cloudDevices()).every(d => d.cr === ctlCloud().rev && d.app === 3), JSON.stringify(Object.values(cloudDevices()).map(d => [d.cr, d.app])));
  // a phone that does not get the settings
  await V2.evaluate(() => { CC.net.ctlPollAt = Date.now() + 1e9; });
  await A.evaluate(() => CC.adminSet({ hot: 50 }));
  await cloudCtlIs(c => c.hot === 50);
  check('A phone that has not received the change yet is named as waiting', await until(async () => (await A.evaluate(() => CC.deliveryInfo().waiting)).join() === 'Volunteer 2', 20000) && /waiting: Volunteer 2/.test(await A.innerText('#adm-deliv')), (await A.innerText('#adm-deliv')).replace(/\n/g, ' | '));
  check('...with a "getting settings" hint on its row', /getting settings/.test(await A.innerText(`#adm-live [data-id="${i2}"]`)));
  await A.evaluate(() => { CC.net.ctlSentAt = Date.now() - 40000; });
  check('...and after 25 seconds the alerts say it still has not received your changes', await until(async () => await A.evaluate(() => CC.adminAlerts().some(a => /not received your latest changes yet: Volunteer 2/.test(a.t))), 6000));
  await V2.evaluate(() => { CC.net.ctlPollAt = 0; });
  check('When the phone catches up, the warning goes away by itself', await until(async () => (await A.evaluate(() => CC.deliveryInfo().waiting)).length === 0 && !(await A.evaluate(() => CC.adminAlerts().some(a => /not received/.test(a.t)))), 20000));
  // message seen
  await A.fill('#bmsg', 'Seen test'); await tap(A, '[data-act=adm-send]');
  await volCtl(V1, () => !!document.querySelector('#bcast')); await volCtl(V2, () => !!document.querySelector('#bcast'));
  await tap(V1, '[data-act=bcast-ok]');
  check('The console counts who has tapped Got it (1 of 2) and names the other phone', await until(async () => { const d = await A.evaluate(() => CC.deliveryInfo()); return d.msgSeen === 1 && d.msgWaiting.join() === 'Volunteer 2'; }, 12000) && /1 of 2 seen \(not yet: Volunteer 2\)/.test(await A.innerText('#adm-deliv')));
  await tap(V2, '[data-act=bcast-ok]');
  check('...and shows 2 of 2 when both have', await until(async () => /2 of 2 seen ✓/.test(await A.innerText('#adm-deliv')), 12000));
  // battery
  await V1.evaluate(() => { CC.net.bat = { p: 12, chg: false }; CC.net.reportDirty = true; });
  check('A phone with 12% battery that is not charging raises a low-battery alert and shows on its row', await until(async () => await A.evaluate(() => CC.adminAlerts().some(a => /Low battery: Volunteer 1 12%/.test(a.t))), 12000) && /battery 12%/.test(await A.innerText(`#adm-live [data-id="${i1}"]`)));
  await V1.evaluate(() => { CC.net.bat = { p: 12, chg: true }; CC.net.reportDirty = true; });
  check('...no alert once it is charging', await until(async () => !(await A.evaluate(() => CC.adminAlerts().some(a => /Low battery/.test(a.t)))), 12000));
  await V1.evaluate(() => { CC.net.bat = { p: 80, chg: false }; CC.net.reportDirty = true; });
  // older app copy
  const ep = (mock.get(['events', TEAM, 'meta']) || {}).epoch || 'e0';
  mock.db().events[TEAM].epochs[ep].devices['oldcopy000001'] = { l: 'Old phone', c: { customers: 0, served: 0 }, adj: 0, rev: 1, hb: Date.now(), app: 2 };
  const keepAlive = setInterval(() => { try { mock.db().events[TEAM].epochs[ep].devices['oldcopy000001'].hb = Date.now(); mock.db().events[TEAM].epochs[ep].devices['oldcopy000001'].rev++; } catch (e) {} }, 3000);
  check('A phone on an older copy of the app is listed separately and the alert says to refresh', await until(async () => { const d = await A.evaluate(() => CC.deliveryInfo()); return d.legacy.join() === 'Old phone'; }, 16000) && await A.evaluate(() => CC.adminAlerts().some(a => /Old phone runs an older copy/.test(a.t))) && /older copy on Old phone/.test(await A.innerText('#adm-deliv')));
  clearInterval(keepAlive);
  // refresh all phones
  await V1.evaluate(() => { window.__mark = 1; }); await V2.evaluate(() => { window.__mark = 1; }); await A.evaluate(() => { window.__mark = 1; });
  await toQ(V2);                                         // V2 is in the middle of a customer
  await tap(A, '[data-act=adm-refresh]'); await A.waitForSelector('[data-act=adm-refresh-yes]');
  check('Refresh all phones asks first (nothing is sent until confirmed)', !(ctlCloud() || {}).rl);
  await tap(A, '[data-act=adm-refresh-yes]');
  check('The refresh request reaches the database', await cloudCtlIs(c => typeof c.rl === 'string' && c.rl.length >= 1));
  check('An idle volunteer phone reloads itself within a few seconds', await until(async () => (await V1.evaluate(() => window.__mark)) !== 1 && (await V1.$('[data-act=next]')), 14000));
  await wait(1500);
  check('...a phone in the middle of a customer does NOT reload (its question is still on screen)', (await V2.evaluate(() => window.__mark)) === 1 && !!(await V2.$('.ans[data-act=answer]')));
  await answer(V2, true); await tap(V2, '#servebtn'); await V2.waitForSelector('[data-act=next]');
  check('...it reloads as soon as the customer is finished and it is idle again', await until(async () => (await V2.evaluate(() => window.__mark)) !== 1, 14000));
  check('...the admin phone itself does not reload', (await A.evaluate(() => window.__mark)) === 1);
  const o1 = await V1.evaluate(() => { window.__mark2 = 1; return performance.timeOrigin; }); await wait(9000);
  const noLoop = (await V1.evaluate(() => window.__mark2)) === 1, servedV2 = await V2.evaluate(() => CC.state().c.served);
  check('A reloaded phone does not reload again (no loop) and keeps its tallies', noLoop && servedV2 === 1, 'no second reload: ' + noLoop + ', V2 served: ' + servedV2 + ', timeOrigin ' + o1 + ' -> ' + await V1.evaluate(() => performance.timeOrigin));
  const V3 = await mkVol('Volunteer 3'); await V3.evaluate(() => { window.__mark = 1; }); await wait(9000);
  check('A phone that joins after the request was sent does not reload for it', (await V3.evaluate(() => window.__mark)) === 1);
  // database rules older than this version of the app
  await reset();
  const A2 = await mkAdmin(), W = await mkVol('Volunteer W');
  mock.ctl.legacyRules = true;
  await W.evaluate(() => { CC.state().label = 'Legacy W'; CC.commit(); });
  await fakeServe(W, 2);
  check('If the database rules are older, phones fall back to the basic record and keep sharing (no "Sharing problem")', await until(async () => (await unsent(W)) === 0 && (await st(W)) === 'ok' && cloudServed() === 2, 16000), (await st(W)) + ' unsent ' + (await unsent(W)));
  const wId = await idOf(W);
  check('...and what that phone sends then has none of the newer fields', await until(async () => { const d = cloudDevices()[wId]; return d && d.cr === undefined && d.ack === undefined && d.bat === undefined && d.app === 3; }, 12000), JSON.stringify(cloudDevices()[wId]));
  await A2.evaluate(() => CC.adminSet({ paused: true, keep: 5 }));
  check('The organiser\'s basic settings still land (pause) while the newer ones (reserve) cannot, with a clear alert to publish the rules', await cloudCtlIs(c => c.paused === true && c.keep === undefined) && await until(async () => await A2.evaluate(() => CC.adminAlerts().some(a => /database rules are older/.test(a.t))), 8000));
  await A2.evaluate(() => CC.adminSet({ paused: false }));
  mock.ctl.legacyRules = false;
  await A2.evaluate(() => { CC.net.ctlSlimUntil = 0; CC.net.slimUntil = 0; }); await W.evaluate(() => { CC.net.slimUntil = 0; CC.net.reportDirty = true; });
  await A2.evaluate(() => CC.adminSet({ keep: 5 }));
  check('Once the rules are published the newer fields work again by themselves', await cloudCtlIs(c => c.keep === 5) && await until(async () => Object.values(cloudDevices()).some(d => d.app === 3 && d.cr !== undefined), 16000));
  check('No JS errors', noErr([A, V1, V2, V3, A2, W]), errs([A, V1, V2, V3, A2, W]));
  await reset();
}

/* ---------- Q. keep the last portions back ---------- */
if (want('Q')) {
  const A = await mkAdmin(), V1 = await mkVol('Volunteer 1'), V2 = await mkVol('Volunteer 2');
  await fakeServe(V1, 68); await until(async () => (await rem(A)) === 12, 20000);
  await openAdmin(A);
  await tap(A, '[data-act=adm-keep-set][data-n="10"]');
  check('Keeping 10 back reaches the database', await cloudCtlIs(c => c.keep === 10));
  await volCtl(V1, () => CC.state().ctl.keep === 10);
  check('With 12 left, volunteer phones can still start customers', await V1.evaluate(() => !document.querySelector('[data-act=next][disabled]')) && (await V1.evaluate(() => CC.blockInfo())) === null);
  await toQ(V2); await answer(V2, true);                 // V2 has a customer who won, 12 left
  await fakeServe(V1, 2);
  check('When the food left reaches 10, volunteer phones stop taking new customers (no pause needed)', await until(async () => /Stall closed to new customers/.test(await bodyText(V1)) && /Kept back by organiser/.test(await V1.innerText('[data-act=next]')) && await V1.evaluate(() => !!document.querySelector('[data-act=next][disabled]')), 16000), (await bodyText(V1)).slice(0, 200));
  check('...the banner tells them why', /last 10 portions are kept back/.test(await bodyText(V1)));
  await V1.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-reserve-volunteer.png') });
  check('A customer already at the Serve screen on another phone can still be served', !!(await V2.$('#servebtn')));
  await tap(V2, '#servebtn'); await V2.waitForSelector('[data-act=next]');
  check('...then that phone is closed too (9 left)', await V2.evaluate(() => !!document.querySelector('[data-act=next][disabled]')) && (await rem(V2)) === 9);
  await goHome(A).catch(() => {}); await A.waitForSelector('[data-act=next]');
  check('The admin phone is never stopped by the reserve, and its Home says so', await until(async () => /Reserve reached: volunteers stopped at 10 left/.test(await bodyText(A)), 14000) && await A.evaluate(() => !document.querySelector('[data-act=next][disabled]')), (await bodyText(A)).slice(0, 200));
  await tap(A, '[data-act=next]'); await A.waitForSelector('[data-act=follow-new]');
  check('...it can start a customer (to hand out the kept-back food)', !!(await A.$('[data-act=follow-new]')));
  await A.evaluate(() => { CC.state().cur = null; CC.commit(); }); await A.reload(); await A.waitForSelector('[data-act=next]');
  await openAdmin(A);
  check('The console raises a "Reserve reached" alert', await A.evaluate(() => CC.adminAlerts().some(a => /Reserve reached: volunteer phones stopped at 10 left/.test(a.t))));
  await tap(A, '[data-act=adm-keep-]'); await cloudCtlIs(c => c.keep === 9);
  check('Lowering it to 9 (with 9 left) is still closed; to 8 opens the stall again on volunteer phones', await volCtl(V1, () => CC.state().ctl.keep === 9) && await V1.evaluate(() => !!document.querySelector('[data-act=next][disabled]')));
  await tap(A, '[data-act=adm-keep-]'); await cloudCtlIs(c => c.keep === 8);
  check('...Next customer is enabled again on its own', await until(async () => await V1.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')), 16000));
  await tap(A, '[data-act=adm-keep-set][data-n="0"]'); await cloudCtlIs(c => c.keep === undefined);
  check('Off removes the setting', ctlCloud().keep === undefined && /Off/.test(await A.innerText('#keepv')));
  await wait(4500);                                  // so the three taps below start a new undo step
  const undo0 = await A.evaluate(() => CC.undoStack().length);
  for (let i = 0; i < 3; i++) await A.evaluate(() => document.querySelector('[data-act="adm-keep+"]').click());
  await cloudCtlIs(c => c.keep === 3);
  check('The +1 button counts up, and three quick taps are a single undo step', (await A.evaluate(() => CC.state().ctl.keep)) === 3 && (await A.evaluate(() => CC.undoStack().length)) === undo0 + 1, undo0 + ' -> ' + await A.evaluate(() => CC.undoStack().length));
  mock.db().events[TEAM].ctl = { rev: 900, paused: false, locked: false, mem: true, hot: 70, retries: 1, keep: 9999 };
  await volCtl(V1, () => CC.state().ctl.rev === 900);
  check('A silly reserve in the database is limited to 200', (await V1.evaluate(() => CC.state().ctl.keep)) === 200);
  check('No JS errors', noErr([A, V1, V2]), errs([A, V1, V2]));
  await reset();
}

/* ---------- R. undo, the change list, two organiser phones, the table export ---------- */
if (want('R')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  await openAdmin(A);
  check('Undo: disabled and says "Nothing to undo" at the start', await A.evaluate(() => { const b = document.querySelector('[data-act=adm-undo]'); return b.disabled && /Nothing to undo/.test(b.textContent); }));
  await tap(A, '[data-act=adm-mode][data-m=rush]'); await cloudCtlIs(c => c.mem === false);
  check('After a change the button names it: "Undo: Rush hour mode on"', await until(async () => /Undo: Rush hour mode on/.test(await A.innerText('[data-act=adm-undo]')), 3000));
  await tap(A, '[data-act=adm-undo]');
  check('Undo puts all three settings back in one go (membership on, 70%, 1 retry)', await cloudCtlIs(c => c.mem === true && c.hot === 70 && c.retries === 1) && await volCtl(V, () => CC.state().ctl.mem === true && CC.state().ctl.hot === 70));
  check('...the change list says what happened', await until(async () => /Undid: Rush hour mode on/.test(await A.innerText('#adm-log')), 6000));
  await tap(A, '[data-act=adm-pause]'); await cloudCtlIs(c => c.paused === true);
  await A.fill('#bmsg', 'Undo me'); await tap(A, '[data-act=adm-send]'); await volCtl(V, () => !!document.querySelector('#bcast'));
  await tap(A, '[data-act=adm-undo]');
  check('Undo of a sent message takes it off the volunteer phones, the pause stays', await cloudCtlIs(c => !c.msg && c.paused === true) && await until(async () => !(await V.$('#bcast')), 16000));
  await tap(A, '[data-act=adm-undo]');
  check('A second undo lifts the pause', await cloudCtlIs(c => c.paused === false));
  await tap(A, '[data-act=adm-mode][data-m=quiet]'); await cloudCtlIs(c => c.retries === 2 && c.hot === 50);
  await A.reload(); await A.waitForSelector('#app *'); await openAdmin(A);
  check('The undo list is remembered after the page is reloaded', await until(async () => await A.evaluate(() => { const b = document.querySelector('[data-act=adm-undo]'); return !b.disabled && /Undo: Quiet time mode on/.test(b.textContent); }), 4000));
  await tap(A, '[data-act=adm-undo]'); await cloudCtlIs(c => c.retries === 1 && c.hot === 70);
  const before = await A.evaluate(() => CC.state().ctl.hot);
  for (let i = 0; i < 3; i++) await A.evaluate(() => document.querySelector('[data-act="adm-hot-"]').click());
  await cloudCtlIs(c => c.hot === before - 30);
  await tap(A, '[data-act=adm-undo]');
  check('Three quick taps on one setting are a single undo step', await cloudCtlIs(c => c.hot === before));
  // the change list
  for (let i = 0; i < 12; i++) { await A.evaluate(i => CC.adminSet({ keep: i + 1 }, 'Reserve step ' + i), i); await A.evaluate(() => 0); await wait(30); }
  await cloudCtlIs(c => (c.log || '').split('\n').length <= 8 && /Reserve step/.test(c.log || ''));
  const lines = (ctlCloud().log || '').split('\n');
  check('The change list keeps only the 8 newest entries, newest first, as "time|who|what"', lines.length <= 8 && /^\d{13}\|Joseph\|/.test(lines[0]) && /Reserve step 11/.test(lines[0]), lines[0]);
  const lg = await A.innerText('#adm-log');
  check('...and the console shows them with the time and who made the change', /Joseph/.test(lg) && /Reserve step 11/.test(lg), lg.replace(/\n/g, ' | ').slice(0, 160));
  // two organiser phones
  const Q = await phone('', { join: false, ...hashOpts }); await Q.goto('about:blank'); await Q.goto(BASE + '#t=' + TEAM + '&c=' + TESTKEY); await Q.waitForSelector('#app *');
  await until(async () => (await st(Q)) === 'ok', 8000); await until(async () => await Q.evaluate(() => CC.state().admin === true), 6000);
  await Q.evaluate(() => { CC.net.ctlPollAt = Date.now() + 1e9; });                 // this phone has not yet seen the other organiser's changes
  await A.evaluate(() => CC.adminSet({ keep: 7, qoff: ['E05'] }, 'Reserve 7 and question E05 off')); await cloudCtlIs(c => c.keep === 7 && c.qoff === 'E05');
  await Q.evaluate(() => CC.adminSet({ hot: 50 }, 'Easy chance 50 from Q'));
  check('Two organiser phones: a change from a phone that had not seen the other\'s changes does not wipe them (reserve 7 and question E05 stay)', await cloudCtlIs(c => c.hot === 50 && c.keep === 7 && c.qoff === 'E05'), JSON.stringify(ctlCloud()));
  check('...and the change list shows both organisers\' entries', /Skyson/.test((ctlCloud().log || '')) && /Joseph/.test((ctlCloud().log || '')));
  // a change made while the database cannot be reached survives a restart
  mock.ctl.refuse = true;
  await A.evaluate(() => CC.adminSet({ poll: 4 }, 'Updates every 4 s')); await wait(1500);
  const pendBefore = await A.evaluate(() => Object.keys(CC.state().cp || {}).join());
  await A.reload(); await A.waitForSelector('#app *'); await wait(900);
  check('An organiser change that could not be sent is still waiting after the page is closed and opened again', pendBefore === 'poll' && (await A.evaluate(() => Object.keys(CC.state().cp || {}).join())) === 'poll');
  mock.ctl.refuse = false;
  check('...and it is sent by itself once the database is reachable', await cloudCtlIs(c => c.poll === 4) && (await A.evaluate(() => Object.keys(CC.state().cp || {}).length)) === 0);
  // csv
  await V.evaluate(() => { CC.state().label = 'Phone, "A"'; CC.commit(); });
  await until(async () => (await A.evaluate(() => CC.adminCsv())).includes('"Phone, ""A"""'), 16000);
  const csv =await A.evaluate(() => CC.adminCsv()), rows = csv.split('\n');
  check('Phone table (CSV): a header, one line per phone and a TOTAL line; names with commas and quotes are quoted', /^phone,customers,follows/.test(rows[0]) && /TOTAL,/.test(rows[rows.length - 1]) && csv.includes('"Phone, ""A"""') && rows.length >= 4, rows.slice(0, 3).join(' / '));
  const rep = await A.evaluate(() => CC.adminReport());
  check('The admin report now also lists mode, reserve, update speed, switched-off questions and the recent changes', /mode (Normal|custom|Quiet time|Rush hour|Clear the stock)/.test(rep) && /reserve 7 kept back/.test(rep) && /updates every 4 s/.test(rep) && /questions off: E05/.test(rep) && /Recent changes:/.test(rep), rep.split('\n').filter(l => /Settings now/.test(l)).join());
  check('No JS errors', noErr([A, V, Q]), errs([A, V, Q]));
  await reset();
}

/* ---------- S. odd and old data ---------- */
if (want('S')) {
  const A = await mkAdmin(), V = await mkVol('Volunteer 1');
  // the stored settings were written by the first organiser version (none of the newer fields)
  mock.db().events[TEAM].ctl = { rev: 40, paused: false, locked: true, mem: true, hot: 80, retries: 2 };
  await volCtl(V, () => CC.state().ctl && CC.state().ctl.rev === 40);
  check('Settings from the first organiser version are read with sensible defaults for the newer fields', await V.evaluate(() => { const c = CC.state().ctl; return c.poll === 0 && c.keep === 0 && c.qoff.length === 0 && c.hold.length === 0 && c.gone.length === 0 && Object.keys(c.dm).length === 0 && c.rl === '' && c.log.length === 0; }));
  await volCtl(A, () => CC.state().ctl && CC.state().ctl.rev === 40);
  await A.evaluate(() => CC.adminSet({ keep: 4 }));
  check('A new change on top of old settings keeps every old setting (locked, 80%, 2 retries)', await cloudCtlIs(c => c.keep === 4 && c.locked === true && c.hot === 80 && c.retries === 2 && c.rev === 41), JSON.stringify(ctlCloud()));
  // junk in every new field
  mock.db().events[TEAM].ctl = { rev: 60, paused: false, locked: false, mem: true, hot: 70, retries: 1, poll: 'fast', keep: -5, qoff: 5, hold: { a: 1 }, gone: ['ok1234567', 7, '<b>'], dm: [1, 2], rl: { x: 1 }, log: 12 };
  await volCtl(V, () => CC.state().ctl.rev === 60);
  const j = await V.evaluate(() => CC.state().ctl);
  check('Wrong types in the newer fields fall back to safe values (no speed change, no reserve, no switched-off questions, nobody held, no messages, no refresh)', j.poll === 0 && j.keep === 0 && j.qoff.length === 0 && j.hold.length === 0 && JSON.stringify(j.gone) === '["ok1234567"]' && Object.keys(j.dm).length === 0 && j.rl === '' && j.log.length === 0, JSON.stringify(j));
  mock.db().events[TEAM].ctl = { rev: 61, paused: false, locked: false, mem: true, hot: 70, retries: 1, poll: 99, keep: 12.6,
    dm: { short: { id: 'a', t: 'x', k: 'info' }, abcdef123456: { id: 'ok', t: 'y'.repeat(300), k: 'loud' }, abcdef123457: { id: 'bad id!', t: 'z', k: 'info' }, abcdef123458: 'text' },
    log: '1700000000000|Joe|did a thing\nnonsense\n0|x|y\n1700000001000|A|B|C' };
  await volCtl(V, () => CC.state().ctl.rev === 61);
  const k = await V.evaluate(() => CC.state().ctl);
  check('Out-of-range numbers are limited (speed to 30 s, reserve rounded) and bad messages are dropped or shortened', k.poll === 30 && k.keep === 13 && Object.keys(k.dm).join() === 'abcdef123456' && k.dm.abcdef123456.t.length === 140 && k.dm.abcdef123456.k === 'info', JSON.stringify(k.dm));
  check('A damaged change list keeps only the good lines', k.log.length === 2 && k.log[0].s === 'did a thing' && k.log[1].s === 'B C', JSON.stringify(k.log));
  // the largest possible settings record still fits what the database accepts
  const big = await A.evaluate(() => {
    const ids = n => Array.from({ length: n }, (_, i) => 'abcdef' + String(100000 + i));
    const dm = {}; ids(12).forEach((id, i) => { dm[id] = { id: 'm' + i, t: 'x'.repeat(140), k: 'warn' }; });
    const body = CC.ctlBody(CC.cleanPatch({ hold: ids(14), gone: ids(14), qoff: CC.QUESTIONS.map(q => q.id), dm, poll: 30, keep: 200, rl: 'abcdefghij', msg: { id: 'm1', t: 'x'.repeat(140), k: 'warn' } }), 5);
    body.log = Array.from({ length: 8 }, (_, i) => (1700000000000 + i) + '|Joseph|' + 'y'.repeat(60)).join('\n');
    return { len: JSON.stringify(body).length, body };
  });
  const put = await fetch(`${mock.url}/events/${TEAM}/ctl.json?print=silent`, { method: 'PUT', body: JSON.stringify({ ...big.body, rev: 5000 }), headers: { 'content-type': 'application/json' } });
  check('The biggest possible settings record (14 held, 14 hidden, 12 messages, 8 log lines...) is under 8 KB and accepted by the database rules', big.len < 8000 && put.status === 204, big.len + ' bytes, HTTP ' + put.status);
  await volCtl(V, () => CC.state().ctl.rev === 5000);
  const back = await V.evaluate(() => { const c = CC.state().ctl; return { hold: c.hold.length, gone: c.gone.length, dm: Object.keys(c.dm).length, log: c.log.length, poll: c.poll, keep: c.keep, rev: c.rev }; });
  check('...and a phone reads it all back without trouble', back.hold === 14 && back.gone === 14 && back.dm === 12 && back.log === 8 && back.poll === 30 && back.keep === 200, JSON.stringify(back));
  const sneaky = await V.evaluate(() => [CC.adminSet({ keep: 5 }), CC.adminSet({ hold: ['abcdef123456'] }), CC.adminSet({ rl: 'x' }), CC.undoLast()]);
  await wait(1200);
  check('A volunteer phone cannot use any of the newer controls even by calling the app functions', sneaky.every(x => x === false) && (ctlCloud().rev === 5000));
  // delete the record: phones go back to normal
  delete mock.db().events[TEAM].ctl;
  check('If the settings record is deleted all the newer controls reset to normal on every phone', await volCtl(V, () => CC.state().ctl === null && CC.blockInfo() === null && CC.pollEveryMs() === 2000));
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

/* ---------- T. the longer console on the smallest phone ---------- */
if (want('T')) {
  const sm = { ctx: { viewport: { width: 320, height: 568 } } };
  const A = await mkAdmin(sm), V = await mkVol('Volunteer 1', sm);
  await A.setViewportSize({ width: 320, height: 568 }); await V.setViewportSize({ width: 320, height: 568 });
  await openAdmin(A); await tap(A, '[data-act=adm-q-open]'); await wait(400);
  check('Console with the question list open on 320 x 568: no sideways scroll, every button 48 px or more, nothing outside the screen', (await noOverflow(A)) === '', await noOverflow(A));
  await A.evaluate(() => document.querySelector('[data-act=adm-refresh]').scrollIntoView()); await wait(200);
  check('...the last controls (Refresh all phones, Report, CSV) can be scrolled to', await A.evaluate(() => { const m = document.querySelector('.main'); m.scrollTop = 1e6; const b = document.querySelector('[data-act=adm-csv]').getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= 0; }));
  await A.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-console-questions-320.png') });
  await A.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
  const i1 = await idOf(V);
  await until(async () => (await A.$$('#adm-live [data-act=adm-phone]')).length === 1, 16000);
  await A.locator('#adm-live [data-act=adm-phone]').first().click(); await A.waitForSelector('#layer #dmmsg'); await wait(300);
  const dlg = await A.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return { top: s.top, bottom: s.bottom, vh: innerHeight, scrolls: document.querySelector('.sheet').scrollHeight > document.querySelector('.sheet').clientHeight }; });
  check('The phone dialog fits 320 x 568 (it scrolls inside the screen if needed) and has no tiny or sideways-cut buttons', dlg.top >= 0 && dlg.bottom <= dlg.vh + 1 && (await noOverflow(A)) === '', JSON.stringify(dlg) + ' ' + await noOverflow(A));
  await A.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-phone-dialog-320.png') });
  await tap(A, '#layer [data-act=adm-hold]'); await cloudCtlIs(c => c.hold === i1);
  await tap(A, '#layer [data-act=modal-close]');
  await V.waitForSelector('#pausebanner', { timeout: 16000 });
  const vlay = await V.evaluate(() => { const b = document.querySelector('#pausebanner').getBoundingClientRect(), n = document.querySelector('[data-act=next]').getBoundingClientRect(); return { hs: document.documentElement.scrollWidth > innerWidth + 1, bTop: b.top, bBottom: b.bottom, nTop: n.top, nBottom: n.bottom, nh: n.height, vh: innerHeight }; });
  check('The "on hold" banner and the disabled button fit a 320 px volunteer screen', !vlay.hs && vlay.bTop >= 0 && vlay.nBottom <= vlay.vh + 1 && vlay.nh >= 47.5 && vlay.bBottom <= vlay.nTop + 1, JSON.stringify(vlay));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-hold-volunteer-320.png') });
  await A.evaluate(() => CC.adminSet({ hold: [] }, 'x'));
  await A.evaluate(() => CC.adminSet({ msg: { id: 'dm320', t: 'y'.repeat(140), k: 'warn' }, dm: (() => { const o = {}; o[CC.teamPhones().find(r => !r.me && !r.admin).id] = { id: 'dm320b', t: 'z'.repeat(140), k: 'warn' }; return o; })() }));
  await V.waitForSelector('#bcast', { timeout: 16000 }); await wait(500);
  const bl = await V.evaluate(() => { const r = document.querySelector('#bcast').getBoundingClientRect(), b = document.querySelector('#bcast button').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth, bh: b.height, h: document.querySelector('#bcast .h').textContent }; });
  check('A 140-character message for one phone fits the 320 px screen with a 48 px Got it button', bl.top >= 0 && bl.left >= 0 && bl.right <= bl.vw && bl.bottom <= bl.vh && bl.bh >= 47.5 && /for this phone/.test(bl.h), JSON.stringify(bl));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-dm-volunteer-320.png') });
  check('No JS errors', noErr([A, V]), errs([A, V]));
  await reset();
}

await closeAll(); check('No unhandled promise rejections on any phone in any section', rejs.length === 0, rejs.slice(0, 3).join(' | ')); await browser.close(); web.close(); await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} admin checks passed (${process.env.BROWSER || 'chromium'})`);
process.exit(failed.length ? 1 : 0);
