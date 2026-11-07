// Organiser (admin) phone: who is the admin, messages to every phone, pause and lock, shared event settings,
// delivery under failures and odd data, live numbers and alerts, small screens, and the Instagram browser.
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
async function closeAll() { for (const p of phones.splice(0)) await p.ctx.close().catch(() => {}); }
async function reset() { await closeAll(); mock.reset(); TEAM = newTeam(); }
const rem = p => p.evaluate(() => CC.remaining()); const st = p => p.evaluate(() => CC.syncState()); const unsent = p => p.evaluate(() => CC.unsent());
const tap = async (p, sel) => { await p.waitForSelector(sel, { state: 'visible' }); await wait(330); await p.click(sel); };
const fakeServe = (p, n) => p.evaluate(n => { const S = CC.state(); for (let i = 0; i < n; i++) { S.c.customers++; S.c.follows++; S.c.correct++; S.c.won++; S.c.hot++; S.c.served++; S.first = S.first || Date.now(); S.last = Date.now(); CC.commit(); } }, n);
const toQuestion = async p => { await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await tap(p, '[data-act=member-new]'); await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 4000 }); await wait(450); };
const answer = async (p, ok = true) => { const q = await p.evaluate(() => CC.QUESTIONS.find(x => x.id === CC.state().cur.qid)); const pick = ok ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer); await p.click(`.ans[data-k=${pick}]`); await p.waitForSelector('#result'); };
const cloudDevices = () => { const m = mock.get(['events', TEAM, 'meta']); return mock.get(['events', TEAM, 'epochs', (m && m.epoch) || 'e0', 'devices']) || {}; };
const cloudServed = () => Object.values(cloudDevices()).reduce((a, d) => a + d.c.served, 0);
const noErr = ps => ps.every(p => p.errors.length === 0);
const errs = ps => ps.flatMap(p => p.errors).join(' | ');


/* ================= organiser (admin) phone tests ================= */
import crypto from 'node:crypto';
const TESTKEY = (() => { let k = ''; for (let i = 0; i < 24; i++) k += chars[crypto.randomInt(32)]; return k; })();
const OTHERKEY = (() => { let k = ''; for (let i = 0; i < 24; i++) k += chars[crypto.randomInt(32)]; return k; })();
const TESTHASH = crypto.createHash('sha256').update(TESTKEY).digest('hex');
const ADMLABEL = "Joseph's Phone (Admin)";
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
async function goHome(A) { await tap(A, '[data-act=back-home]'); await A.waitForSelector('[data-act=next]'); }
const bodyText = p => p.innerText('#app').then(t => t.replace(/\n/g, ' '));
const cloudCtlIs = (pred) => until(async () => { const c = ctlCloud(); return c && pred(c); }, 9000);

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
  await tap(V, '[data-act=admin-out]'); await tap(V, '[data-act=admin-out-yes]'); await wait(500);
  check('Signing out of admin makes it a normal volunteer phone again (name cleared)', (await st0(V)).admin === false && (await st0(V)).label === '' && !(await V.$('[data-act=admin-open]')));
  check('No JS errors (volunteer, wrong-key, malformed and sign-in phones)', noErr([V, W, M, N]), errs([V, W, M, N]));
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
  check('...both volunteer phones show it as a banner within a few seconds', await until(async () => (await V.isVisible('#bcast')) && (await V2.isVisible('#bcast')), 9000));
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
  check('A new (important) message shows again on a phone that dismissed the old one, even in the middle of a customer', await until(async () => await V.isVisible('#bcast.warn'), 9000) && !!(await V.$('.ans[data-act=answer]')));
  await tap(V, '[data-act=bcast-ok]'); await wait(300);
  await answer(V, true);
  check('Dismissing it mid-customer does not disturb the customer', !!(await V.$('#servebtn')) && !(await V.$('#bcast')));
  await tap(V, '#servebtn'); await V.waitForSelector('[data-act=next]');
  // clear
  await tap(A, '[data-act=adm-clear]');
  check('Clear message removes it from the database and from phones that had not dismissed it', await cloudCtlIs(c => !c.msg) && await until(async () => !(await V2.$('#bcast')), 9000));
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
  await until(async () => (await V.evaluate(() => (CC.state().ctl || {}).rev)) === 500, 9000);
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
  check('Volunteer Home shows "Stall paused" and the Next customer button is disabled', await until(async () => /Stall paused/.test(await bodyText(V)) && await V.evaluate(() => !!document.querySelector('[data-act=next][disabled]')), 9000));
  await V.click('[data-act=next]', { force: true, timeout: 1500 }).catch(() => {}); await wait(400);
  check('Pressing it anyway does not start a customer', (await st0(V)).cur === null && !(await V.$('[data-act=follow-new]')));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-paused-volunteer.png') });
  await V.reload(); await V.waitForSelector('#app *'); await wait(500);
  check('The pause is remembered after a reload', /Stall paused/.test(await bodyText(V)));
  await goHome(A).catch(() => {}); await A.waitForSelector('[data-act=next]');
  check('The admin phone is not blocked while paused (and says so)', await A.evaluate(() => !document.querySelector('[data-act=next][disabled]')) && /paused for volunteers/.test(await bodyText(A)));
  await openAdmin(A); await tap(A, '[data-act=adm-pause]');
  check('Resume enables Next customer again on volunteer phones', await until(async () => await V.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')) && !/Stall paused/.test(await bodyText(V)), 9000));

  await tap(A, '[data-act=adm-lock]');
  check('Lock reaches the database', await cloudCtlIs(c => c.locked === true));
  await tap(V, '[data-act=summary]'); await V.waitForSelector('#stats');
  check('Locked: the volunteer Summary shows a locked note and no food +/-, total or reset controls', await until(async () => !!(await V.$('#lockednote')) && !(await V.$('[data-act="stock+"]')) && !(await V.$('[data-act="start+"]')) && !(await V.$('[data-hold]')), 9000));
  check('...but the volunteer can still copy the summary and change this phone\'s name', !!(await V.$('[data-act=copy]')) && await V.evaluate(() => !document.querySelector('#label').disabled));
  await tap(A, '[data-act=back-home]'); await tap(A, '[data-act=summary]'); await A.waitForSelector('#stats');
  check('The admin phone keeps all of them while locked', !!(await A.$('[data-act="stock+"]')) && !!(await A.$('[data-hold]')));
  await V.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'admin-locked-volunteer.png') });
  await tap(A, '[data-act=back-home]'); await openAdmin(A); await tap(A, '[data-act=adm-lock]');
  check('Unlock gives the volunteer their controls back', await until(async () => !!(await V.$('[data-act="stock+"]')) && !!(await V.$('[data-hold]')) && !(await V.$('#lockednote')), 9000));
  // a reset by a volunteer does not wipe the organiser's settings
  await tap(A, '[data-act=adm-pause]'); await cloudCtlIs(c => c.paused === true);
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
  check('Switching the membership step off reaches the database and the volunteer phone', await cloudCtlIs(c => c.mem === false) && await until(async () => (await V.evaluate(() => CC.state().ctl && CC.state().ctl.mem)) === false, 9000));
  await tap(V, '[data-act=next]'); await tap(V, '[data-act=follow-new]'); await V.waitForSelector('[data-act=reveal]');
  check('With it off, Follow goes straight to Reveal deal and the steps say 2 of 4', !(await V.$('#qrm')) && /step 2 of 4/i.test(await bodyText(V)));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  // the organiser switches it back on while a customer is waiting at the follow step
  await tap(V, '[data-act=next]'); await V.waitForSelector('[data-act=follow-new]');
  await tap(A, '[data-act=adm-mem]'); await cloudCtlIs(c => c.mem === true); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === true, 9000);
  await tap(V, '[data-act=follow-new]');
  check('Switching it back on: the next customer sees the membership QR (step 2 of 5)', await V.waitForSelector('#qrm', { timeout: 4000 }).then(() => true).catch(() => false) && /step 2 of 5/i.test(await bodyText(V)));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  // switching off while a customer is on the membership step
  await tap(V, '[data-act=next]'); await tap(V, '[data-act=follow-new]'); await V.waitForSelector('#qrm');
  await tap(A, '[data-act=adm-mem]'); await cloudCtlIs(c => c.mem === false); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === false, 9000);
  await V.reload(); await V.waitForSelector('#app *'); await wait(400);
  check('If the step is switched off while a customer is on it, the customer moves on to Reveal deal', !!(await V.$('[data-act=reveal]')) && !(await V.$('#qrm')));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  await A.evaluate(() => CC.adminSet({ mem: true })); await cloudCtlIs(c => c.mem === true); await until(async () => (await V.evaluate(() => CC.state().ctl.mem)) === true, 9000);
  // hot deal chance
  for (let i = 0; i < 4; i++) await tap(A, '[data-act="adm-hot+"]');
  check('HOT DEAL chance: +10 steps stop at 100 and reach the database', await cloudCtlIs(c => c.hot === 100) && /100%/.test(await A.innerText('#adm-ctl')));
  await until(async () => (await V.evaluate(() => CC.state().ctl.hot)) === 100, 9000);
  const diffs = await V.evaluate(() => Array.from({ length: 24 }, () => { const id = CC.drawQuestion(); return CC.QUESTIONS.find(q => q.id === id).difficulty; }));
  check('At 100% every draw is a HOT DEAL (easy) question', diffs.every(d => d === 'easy'), diffs.join(','));
  await A.evaluate(() => CC.adminSet({ hot: 0 })); await until(async () => (await V.evaluate(() => CC.state().ctl.hot)) === 0, 9000);
  const diffs0 = await V.evaluate(() => Array.from({ length: 24 }, () => { const id = CC.drawQuestion(); return CC.QUESTIONS.find(q => q.id === id).difficulty; }));
  check('At 0% every draw is a FULL PRICE (hard) question', diffs0.every(d => d === 'hard'), diffs0.join(','));
  await A.evaluate(() => CC.adminSet({ hot: 70 }));
  // retries
  await A.evaluate(() => CC.adminSet({ retries: 0 })); await until(async () => (await V.evaluate(() => CC.state().ctl.retries)) === 0, 9000);
  await toQuestion(V); await answer(V, false);
  check('With 0 retries a wrong answer ends the turn: no "try one more" button, counted as lost', !(await V.$('[data-act=retry]')) && (await st0(V)).c.lost === 1, await V.evaluate(() => document.querySelector('.foot').innerText.replace(/\n/g, ' | ')));
  await V.evaluate(() => { CC.state().cur = null; CC.commit(); }); await V.reload(); await V.waitForSelector('[data-act=next]');
  await A.evaluate(() => CC.adminSet({ retries: 2 })); await until(async () => (await V.evaluate(() => CC.state().ctl.retries)) === 2, 9000);
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
  await until(async () => (await V.evaluate(() => CC.state().ctl && CC.state().ctl.paused === false && CC.state().ctl.hot === 70)), 9000);
  mock.db().events[TEAM].ctl = 'garbage';
  await wait(2800);
  check('Text instead of a settings record is ignored by phones', (await V.evaluate(() => CC.state().ctl)) !== null && (await V.evaluate(() => CC.state().ctl.paused)) === false);
  mock.db().events[TEAM].ctl = { rev: 600, paused: 'yes', locked: 1, mem: 'no', hot: 'lots', retries: 99, msg: { id: '<script>', t: 5, k: 'x' } };
  await until(async () => (await V.evaluate(() => CC.state().ctl.rev)) === 600, 9000);
  const cl = await V.evaluate(() => CC.state().ctl);
  check('Wrong types and out-of-range values are cleaned (not paused, not locked, membership on, 70%, at most 2 retries, bad message dropped)', cl.paused === false && cl.locked === false && cl.mem === true && cl.hot === 70 && cl.retries === 2 && cl.msg === null, JSON.stringify(cl));
  delete mock.db().events[TEAM].ctl;
  check('If the settings record is deleted, phones go back to the normal defaults', await until(async () => (await V.evaluate(() => CC.state().ctl)) === null, 9000) && (await V.evaluate(() => CC.CONFIG.hotDealPercent)) === 70);
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
  await until(async () => (await rem(A)) === 70, 9000);
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
  await fakeServe(V, 58); await until(async () => (await rem(A)) === 12, 9000);
  check('Alert: "Running low" at 15 or fewer', await A.evaluate(() => CC.adminAlerts().some(a => /Running low: 12/.test(a.t))));
  await A.evaluate(() => { const k = Object.keys(CC.state().peers)[0]; CC.net.seen[k].t = Date.now() - 80000; });
  check('Alert: a phone that was online and went quiet is reported by name', await A.evaluate(() => CC.adminAlerts().some(a => /went offline/.test(a.t))));
  await A.evaluate(() => { const s = CC.samples(); s.length = 0; });
  // report
  const rep = await A.evaluate(() => CC.adminReport());
  check('Admin report: contains the normal summary plus pace, win rate, settings and every phone', /EcomSoc Checkout Challenge summary/.test(rep) && /ADMIN REPORT/.test(rep) && /Settings now: stall open, volunteer settings unlocked, membership step on, HOT DEAL chance 70%, retries 1/.test(rep) && /Volunteer 2: /.test(rep) && /Win rate/.test(rep), rep.split('\n').slice(-8).join(' / '));
  // sold out and over-served
  await fakeServe(V, 12); await until(async () => (await rem(A)) === 0, 9000);
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
  await until(async () => await V.isVisible('#bcast'), 9000); await wait(600);
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

await closeAll(); await browser.close(); web.close(); await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} admin checks passed (${process.env.BROWSER || 'chromium'})`);
process.exit(failed.length ? 1 : 0);
