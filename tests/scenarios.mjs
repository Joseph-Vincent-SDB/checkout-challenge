// Edge-case scenarios against the mock database: Back button, rotation, corrupt or wiped storage, a reset in the
// middle of a customer, wrong phone clocks, a Wi-Fi login page answering instead of the database, odd data,
// Serve while the network hangs, unusual phone names, and a random "monkey" test.
//   node scenarios.mjs            (BROWSER=webkit node scenarios.mjs for the Safari engine)
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

/* ---------- 1. Back button / edge swipe ---------- */
if (want('1')) {
  const p = await phone('A'); await until(async () => (await st(p)) === 'ok');
  const onApp = () => p.url().startsWith(BASE);
  await tap(p, '[data-act=summary]'); await p.waitForSelector('#stats'); await p.goBack(); await wait(400);
  check('Back on Summary goes to Home', await p.isVisible('[data-act=next]') && onApp());
  await tap(p, '[data-act=help]'); await p.waitForSelector('ol.how'); await p.goBack(); await wait(400);
  check('Back on How to run it goes to Home', await p.isVisible('[data-act=next]') && onApp());
  await tap(p, '[data-act=next]'); await p.waitForSelector('[data-act=follow-new]'); await p.goBack(); await wait(400);
  check('Back on the Follow step cancels the customer and goes Home', await p.isVisible('[data-act=next]') && (await p.evaluate(() => CC.state().cur)) === null);
  await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await p.waitForSelector('#qrm'); await p.goBack(); await wait(400);
  check('Back on the membership page asks "Cancel this customer?" instead of leaving', /Cancel this customer/.test(await p.innerText('.sheet').catch(() => '')) && onApp());
  await tap(p, '[data-act=modal-close]'); await tap(p, '[data-act=cancel]'); await tap(p, '[data-act=cancel-yes]'); await p.waitForSelector('[data-act=next]');
  await toQuestion(p); await p.goBack(); await wait(400);
  check('Back mid-question asks "Cancel this customer?" instead of leaving', /Cancel this customer/.test(await p.innerText('.sheet').catch(() => '')) && onApp());
  await p.goBack(); await wait(400);
  check('Back again closes the question and keeps the customer', !(await p.$('.sheet')) && !!(await p.$('.ans[data-act=answer]')));
  await answer(p, true); await p.goBack(); await wait(400);
  check('Back on the result screen does nothing (customer is not lost, food not given away)', !!(await p.$('#servebtn')) && onApp());
  await tap(p, '#servebtn'); await p.waitForSelector('[data-act=next]');
  for (let i = 0; i < 3; i++) { await p.goBack().catch(() => {}); await wait(300); }
  check('Pressing Back many times on Home never leaves the app', onApp() && await p.isVisible('[data-act=next]'));
  check('No JS errors', noErr([p]), errs([p])); await reset();
}

/* ---------- 2. Rotation to landscape ---------- */
if (want('2')) {
  const p = await phone('A'); await until(async () => (await st(p)) === 'ok');
  await p.setViewportSize({ width: 667, height: 375 }); await wait(300);
  const report = async name => p.evaluate(async name => {
    const vw = innerWidth, vh = innerHeight; const bad = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push('h-scroll');
    for (const b of document.querySelectorAll('#app [data-act], #app input')) {
      const r0 = b.getBoundingClientRect(); if (!r0.width) continue; b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect(); if (r.top < -1 || r.bottom > vh + 1 || r.left < -1 || r.right > vw + 1) bad.push('unreachable:' + (b.textContent || b.id).trim().slice(0, 14));
    }
    return name + ':' + (bad.join(',') || 'ok');
  }, name);
  const rows = [];
  rows.push(await report('home'));
  await tap(p, '[data-act=summary]'); await p.waitForSelector('#stats'); rows.push(await report('summary')); await tap(p, '[data-act=back-home]');
  await tap(p, '[data-act=next]'); await p.waitForSelector('#qr'); rows.push(await report('follow'));
  await tap(p, '[data-act=follow-new]'); await p.waitForSelector('[data-act=member-new]'); rows.push(await report('membership'));
  await tap(p, '[data-act=member-new]'); await p.waitForSelector('[data-act=reveal]'); rows.push(await report('reveal'));
  await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]'); await wait(450); rows.push(await report('question'));
  await answer(p, false); rows.push(await report('result-retry'));
  check('Landscape: no sideways scrolling and every button can be scrolled into reach on every screen', rows.every(r => r.endsWith(':ok')), rows.join(' | '));
  await p.setViewportSize({ width: 375, height: 667 }); await wait(300);
  check('Rotating back to portrait restores the layout without losing the customer', !!(await p.$('[data-act=retry]')));
  check('No JS errors', noErr([p]), errs([p])); await reset();
}

/* ---------- 3. corrupted or odd saved data ---------- */
if (want('3')) {
  const key = 'ecomsoc-checkout-challenge-v1';
  const variants = {
    'broken JSON': '{"v":2,"c":',
    'the text null': 'null',
    'an array': '[1,2,3]',
    'a number': '5',
    'wrong types everywhere': JSON.stringify({ v: 2, c: 'x', peers: [], cur: 5, bags: 'no', adj: '5', team: 123, startStock: 'x', label: { a: 1 }, id: 77, epoch: [] }),
    'huge numbers': JSON.stringify({ v: 2, team: 'K7MQX2PA', id: 'abcdef123456', c: { served: 1e12, customers: -5, won: 1e50 }, adj: 1e308, startStock: 1e9, rev: 3, acked: 9e99 }),
    'a customer on a question that no longer exists': JSON.stringify({ v: 2, team: 'K7MQX2PA', id: 'abcdef123456', cur: { step: 'question', qid: 'Z99', attempt: 1 } }),
    'peers with junk keys': JSON.stringify({ v: 2, team: 'K7MQX2PA', id: 'abcdef123456', peers: { '__proto__': { c: {} }, 'a': { c: { served: 5 } }, 'abcdefabcdef': { c: { served: 'x' } } } })
  };
  for (const [name, val] of Object.entries(variants)) {
    const p = await phone('', { join: false, init: ([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, initArg: [key, val] });
    await wait(900);
    const home = await p.$('[data-act=next], [data-act=join-go]');
    const s = await p.evaluate(() => { const S = CC.state(); return { adj: S.adj, served: S.c.served, cust: S.c.customers, start: S.startStock, rem: CC.remaining(), peers: Object.keys(S.peers).length }; }).catch(() => null);
    let usable = false;
    if (home && await p.$('[data-act=join-skip]')) { await tap(p, '[data-act=join-skip]'); }
    if (await p.$('[data-act=next]')) { await toQuestion(p); await answer(p, true); usable = !!(await p.$('#result')); }
    const sane = s && Math.abs(s.adj) <= 5000 && s.served <= 100000 && s.cust >= 0 && s.start <= 5000 && Number.isFinite(s.rem);
    check(`Corrupt saved data (${name}): app starts, values are made safe, a customer can still be served`, !!home && sane && (usable || name.includes('no longer exists')) && noErr([p]), JSON.stringify(s) + ' ' + errs([p]));
    await p.ctx.close(); phones.pop();
  }
  // huge numbers with sharing on: after clamping the database accepts the record (no "Sharing problem")
  const p = await phone('', { join: false, init: ([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, initArg: [key, variants['huge numbers']] });
  check('Values that were clamped are accepted by the database (no "Sharing problem")', await until(async () => (await st(p)) === 'ok' && (await unsent(p)) === 0, 12000), 'state=' + await st(p));
  await reset();
}

/* ---------- 4. reset on another phone in the middle of a customer ---------- */
if (want('4')) {
  const A = await phone('A'), B = await phone('B'); await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await fakeServe(B, 5); await until(async () => (await rem(A)) === 75);
  await toQuestion(A);
  await B.evaluate(() => CC.reset()); await until(async () => (await rem(A)) === 80 && (await rem(B)) === 80, 10000);
  check('A reset from another phone while a customer is mid-question: that customer is still on screen', !!(await A.$('.ans[data-act=answer]')));
  await answer(A, true); await tap(A, '#servebtn'); await A.waitForSelector('[data-act=next]');
  check('...and finishing it counts in the new count (79 left on both phones)', await until(async () => (await rem(A)) === 79 && (await rem(B)) === 79, 8000), `A=${await rem(A)} B=${await rem(B)}`);
  check('No JS errors', noErr([A, B]), errs([A, B])); await reset();
}

/* ---------- 5. a phone's storage is wiped in the middle of the event ---------- */
if (want('5')) {
  const A = await phone('A'), B = await phone('B'); await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await fakeServe(A, 3); await until(async () => (await rem(B)) === 77);
  await A.evaluate(() => { localStorage.removeItem('ecomsoc-checkout-challenge-v1'); }); await A.goto('about:blank'); await A.goto(BASE); await A.waitForSelector('#app *');
  check('After the storage is cleared the phone asks to join again (no crash)', await A.isVisible('#code') || await A.isVisible('[data-act=join-go]'));
  check('The team\'s food count is unaffected by the wipe (B still 77)', (await rem(B)) === 77);
  await A.goto(BASE + '#t=' + TEAM); await A.waitForSelector('#app *');
  check('Re-joining with the link restores the shared count on that phone (77)', await until(async () => (await st(A)) === 'ok' && (await rem(A)) === 77, 9000), 'A=' + await rem(A));
  await fakeServe(A, 1);
  check('Serving after re-joining counts correctly for everyone (76), old serves are kept', await until(async () => (await rem(B)) === 76 && cloudServed() === 4, 8000), `B=${await rem(B)} cloud=${cloudServed()}`);
  check('No JS errors', noErr([A, B]), errs([A, B])); await reset();
}

/* ---------- 6. phones with the wrong clock ---------- */
if (want('6')) {
  const A = await phone('Ahead 3h', { offsetMs: 3 * 3600e3 }), B = await phone('Behind 3h', { offsetMs: -3 * 3600e3 }), C = await phone('On time');
  await until(async () => (await Promise.all([A, B, C].map(st))).every(s => s === 'ok'), 12000);
  await fakeServe(A, 2); await fakeServe(B, 3); await fakeServe(C, 4);
  check('Phones with clocks 3 hours fast and slow still agree on the totals (71 left)', await until(async () => (await Promise.all([A, B, C].map(rem))).every(r => r === 71), 10000), (await Promise.all([A, B, C].map(rem))).join(','));
  check('All three show as online after a heartbeat or two', await until(async () => /3 phones online/.test(await C.innerText('#syncrow')) && /3 phones online/.test(await A.innerText('#syncrow')), 25000), (await C.innerText('#syncrow')).replace(/\n/g, ' '));
  check('No JS errors', noErr([A, B, C]), errs([A, B, C])); await reset();
}

/* ---------- 7. the network answers, but not with the database ---------- */
if (want('7')) {
  const A = await phone('A'), B = await phone('B'); await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  mock.ctl.garbage = true; await fakeServe(A, 2);
  await until(async () => (await st(A)) === 'offline', 14000);
  check('A Wi-Fi login page answering instead of the database is treated as offline, not as data', (await st(A)) === 'offline' && (await rem(A)) === 78 && noErr([A]), errs([A]));
  mock.ctl.garbage = false;
  check('...and it recovers by itself (B sees 78)', await until(async () => (await rem(B)) === 78 && (await unsent(A)) === 0, 12000));
  for (const weird of [[1, 2, 3], 'hello', 42, {}, { epoch: 5, startStock: 'x' }, { a: { b: { c: 1 } } }]) {
    mock.ctl.weird = weird; await wait(3000);
    check(`Odd but valid JSON from the server (${JSON.stringify(weird).slice(0, 30)}) is ignored safely`, noErr([A, B]) && (await rem(A)) === 78, 'rem=' + await rem(A) + ' ' + errs([A, B]));
  }
  mock.ctl.weird = null; check('Normal service resumes', await until(async () => (await st(A)) === 'ok' && (await rem(B)) === 78, 9000));
  await reset();
}

/* ---------- 8. Serve while the network hangs ---------- */
if (want('8')) {
  const A = await phone('A'), B = await phone('B'); await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  await A.evaluate(() => { CC.state().adj = -70; CC.commit(); }); await until(async () => (await rem(B)) === 10);
  await A.evaluate(() => { const S = CC.state(); S.cur = { step: 'result', follow: 'new', qid: 'E01', attempt: 1, counted: true, picked: 'A', ok: true }; CC.commit(); }); await A.reload(); await A.waitForSelector('#servebtn');
  mock.ctl.hang = true; await wait(1200);
  const t0 = Date.now(); await A.click('#servebtn'); await A.waitForSelector('[data-act=next]', { timeout: 8000 }); const took = Date.now() - t0;
  check('Tapping Serve while the network hangs still completes within 3 seconds', took < 3000, took + ' ms');
  check('The serve was counted on the phone (9 left) and queued to send', (await rem(A)) === 9 && (await unsent(A)) > 0);
  mock.ctl.hang = false;
  check('When the network answers again every phone shows 9', await until(async () => (await rem(B)) === 9 && (await unsent(A)) === 0, 14000), 'B=' + await rem(B));
  check('No JS errors', noErr([A, B]), errs([A, B])); await reset();
}

/* ---------- 9. unusual phone names ---------- */
if (want('9')) {
  const names = ['小小小小小小小小小小小小', '🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜', '<img src=x onerror=_x()>', 'A'.repeat(24), 'Zoë & Ahmed "Stall"'];
  const A = await phone('A', { init: () => { window._xss = 0; window._x = () => { window._xss++; }; } }), B = await phone('B', { init: () => { window._xss = 0; window._x = () => { window._xss++; }; } });
  await until(async () => (await st(A)) === 'ok');
  let okAll = true, detail = [];
  for (const n of names) {
    await A.evaluate(n => { CC.state().label = n.slice(0, 24); CC.commit(); }, n);
    const seen = await until(async () => (await B.evaluate(() => Object.values(CC.state().peers).map(p => p.l))).includes(n.slice(0, 24)), 6000);
    if (!seen) { okAll = false; detail.push('not shared: ' + n); }
  }
  await tap(B, '[data-act=summary]'); await B.waitForSelector('#phones'); await wait(300);
  const xss = await B.evaluate(() => window._xss) + await A.evaluate(() => window._xss);
  check('Phone names with Chinese, emoji, quotes, ampersands and 24 characters are all accepted and shared', okAll && (await st(A)) === 'ok', detail.join(', '));
  check('A phone name containing HTML is shown as plain text and never runs', xss === 0, 'xss=' + xss);
  check('No JS errors', noErr([A, B]), errs([A, B])); await reset();
}

/* ---------- 9b. links opened inside Instagram and other in-app browsers ---------- */
if (want('9b')) {
  const UA = {
    igIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)',
    igAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.28.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_AU; 640110043)',
    fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/460.0.0.45.113;FBBV/580123456;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
    messenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/MessengerForiOS;FBAV/460.0.0.45.113;FBBV/580123456;FBDV/iPhone14,5]',
    fbAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.45.113;]',
    tiktok: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 trill_340000 BytedanceWebview/d8a21c6',
    snapchat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.90.0.37 (like Safari/8617.1.17.10.9, panda)',
    safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
    firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'
  };
  const probe = await phone('', { join: false });
  const det = await probe.evaluate(u => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, window.CC.detectIab(v)])), UA);
  const want = { igIos: ['Instagram', 'ios'], igAndroid: ['Instagram', 'android'], fbIos: ['Facebook or Messenger', 'ios'], messenger: ['Facebook or Messenger', 'ios'], fbAndroid: ['Facebook or Messenger', 'android'], tiktok: ['TikTok', 'android'], snapchat: ['Snapchat', 'ios'] };
  const okDet = Object.entries(want).every(([k, [n, o]]) => det[k] && det[k].name === n && det[k].os === o);
  const okNone = ['safariIos', 'chromeAndroid', 'chromeIos', 'firefoxAndroid', 'samsung'].every(k => det[k] === null);
  check('In-app browsers are recognised (Instagram, Facebook, Messenger, TikTok, Snapchat on iPhone and Android)', okDet, JSON.stringify(det));
  check('Normal browsers are never mistaken for one (Safari, Chrome, Chrome on iPhone, Firefox, Samsung Internet)', okNone);
  await probe.ctx.close(); phones.pop();

  const ctxOpts = ua => ({ userAgent: ua, ...(IS_CHROMIUM ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  const shot = path.join(ROOT, 'tests', 'screenshots'); fs.mkdirSync(shot, { recursive: true });
  // --- Instagram on iPhone, opened from a join link
  const I = await phone('', { join: false, ctx: ctxOpts(UA.igIos) }); await I.goto('about:blank'); await I.goto(BASE + '#t=' + TEAM); await I.waitForSelector('#app *'); await wait(500);
  const txt = await I.innerText('#app');
  check('Instagram on iPhone: the app stops and says "Open this in Safari" with the steps', /Instagram's browser/.test(txt) && /Open this in Safari/.test(txt) && /Open in Safari/.test(txt) && !(await I.$('[data-act=next]')), txt.replace(/\n/g, ' ').slice(0, 120));
  check('...it shows the team code from the link so it can be typed if copying fails', txt.includes(TEAM.slice(0, 4) + '-' + TEAM.slice(4)));
  check('...it did NOT join the team or write anything to the database from inside Instagram', (await I.evaluate(() => CC.state().team)) === '' && mock.get(['events', TEAM]) === null);
  check('...the join link is kept in the address so reloading does not lose it', new URL(I.url()).hash === '#t=' + TEAM);
  await I.screenshot({ path: path.join(shot, 'iab-instagram-ios.png') });
  await I.setViewportSize({ width: 320, height: 568 }); await wait(200);
  const lay = await I.evaluate(() => { const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('hscroll'); document.querySelectorAll('#app button').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.height < 47.5 || r.width < 47.5)) bad.push(b.textContent.trim().slice(0, 12)); }); return bad.join(','); });
  check('The screen fits the smallest phone (320 wide) with 48 px buttons', lay === '', lay);
  await I.setViewportSize({ width: 375, height: 667 });
  await tap(I, '[data-act=iab-copy]'); await wait(500);
  if (IS_CHROMIUM) { const clip = await I.evaluate(() => navigator.clipboard.readText()); check('Copy link puts the full join link (with the team code) on the clipboard', clip === BASE + '#t=' + TEAM, clip); }
  else check('Copy link gives feedback (toast or copy-by-hand box)', !!(await I.$('#toast, #manual')));
  await I.reload(); await I.waitForSelector('#app *');
  check('Reloading inside Instagram shows the screen again (and still holds the code)', /Open this in Safari/.test(await I.innerText('#app')) && (await I.innerText('#app')).includes(TEAM.slice(0, 4)));
  await tap(I, '[data-act=iab-continue]');
  check('"Continue here anyway" joins the team and warns on Home that this is not the best browser', await until(async () => (await I.evaluate(() => CC.state().team)) === TEAM && /Inside Instagram's browser/.test(await I.innerText('#app')), 8000), (await I.innerText('#app')).replace(/\n/g, ' ').slice(0, 140));
  check('...and the join code is removed from the address bar', new URL(I.url()).hash === '');
  await I.screenshot({ path: path.join(shot, 'iab-banner-home.png') });
  await I.reload(); await I.waitForSelector('#app *'); await wait(400);
  check('After choosing to continue, a reload goes straight Home (no nagging) and stays on the team', !!(await I.$('[data-act=next]')) && (await I.evaluate(() => CC.state().team)) === TEAM);
  await tap(I, '.iabbar'); check('Tapping the warning shows the instructions again', /Open this in Safari/.test(await I.innerText('#app')));
  await tap(I, '[data-act=iab-continue]'); check('...and Continue returns Home', !!(await I.$('[data-act=next]')));
  check('Running a customer inside the in-app browser still works', await (async () => { await toQuestion(I); await answer(I, true); return !!(await I.$('#servebtn')); })());
  check('No JS errors', noErr([I]), errs([I])); await I.ctx.close(); phones.pop(); mock.reset(); TEAM = newTeam();

  // --- Instagram on Android, plain link without a code
  const A = await phone('', { join: false, ctx: ctxOpts(UA.igAndroid) }); await A.goto('about:blank'); await A.goto(BASE); await A.waitForSelector('#app *'); await wait(400);
  const ta = await A.innerText('#app');
  check('Instagram on Android: says "Open this in Chrome" with Android steps and shows no team code when the link has none', /Open this in Chrome/.test(ta) && /Open in Chrome/.test(ta) && !/Your team code/.test(ta), ta.replace(/\n/g, ' ').slice(0, 100));
  await A.screenshot({ path: path.join(shot, 'iab-instagram-android.png') });
  await tap(A, '[data-act=iab-copy]'); await wait(400);
  if (IS_CHROMIUM) check('Copy link on a plain link copies the plain address', (await A.evaluate(() => navigator.clipboard.readText())) === BASE);
  await tap(A, '[data-act=iab-continue]'); check('Continue (no code) goes to the Join screen so the code can be typed', await until(async () => await A.isVisible('#code'), 4000));
  check('No JS errors', noErr([A]), errs([A])); await A.ctx.close(); phones.pop();

  // --- other in-app browsers show the screen too; normal browsers never do
  for (const k of ['fbIos', 'tiktok', 'snapchat']) {
    const P = await phone('', { join: false, ctx: ctxOpts(UA[k]) }); await P.goto('about:blank'); await P.goto(BASE + '#t=' + TEAM); await P.waitForSelector('#app *'); await wait(300);
    check(`${k}: shows the "open in your browser" screen`, /Open this in (Safari|Chrome)/.test(await P.innerText('#app'))); await P.ctx.close(); phones.pop();
  }
  for (const k of ['safariIos', 'chromeAndroid', 'chromeIos']) {
    const P = await phone('', { join: false, ctx: ctxOpts(UA[k]) }); await P.goto('about:blank'); await P.goto(BASE + '#t=' + TEAM); await P.waitForSelector('#app *'); await wait(300);
    check(`${k}: normal browser joins straight away, no warning`, await until(async () => (await P.evaluate(() => CC.state().team)) === TEAM, 6000) && !/Open this in/.test(await P.innerText('#app')) && !(await P.$('.iabbar')));
    await P.ctx.close(); phones.pop();
  }
  await reset();
}

/* ---------- 9c. handing off from Instagram's browser to the default browser ---------- */
if (want('9c')) {
  const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
  const IGA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.28.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_AU; 640110043)';
  const TT = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 trill_340000 BytedanceWebview/d8a21c6';
  const SAF = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const hook = () => { window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); }; };
  const navs = p => p.evaluate(() => window.__navs || []);
  const pure = await phone('', { join: false });
  const urls = await pure.evaluate(() => ({
    ios: CC.buildHandoff('ios', 'https://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP'),
    iosPlain: CC.buildHandoff('ios', 'https://joseph-vincent-sdb.github.io/checkout-challenge/'),
    iosHttp: CC.buildHandoff('ios', 'http://127.0.0.1:8080/'),
    igIos: CC.buildHandoff('ios', 'https://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP', 'Instagram'),
    fbIosApp: CC.buildHandoff('ios', 'https://x.test/', 'Facebook or Messenger'),
    igAndroidApp: CC.buildHandoff('android', 'https://x.test/', 'Instagram'),
    android: CC.buildHandoff('android', 'https://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP'),
    other: CC.buildHandoff('other', 'https://x.test/')
  }));
  check('iPhone handoff link is x-safari-https://... and keeps the team code', urls.ios === 'x-safari-https://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP' && urls.iosPlain === 'x-safari-https://joseph-vincent-sdb.github.io/checkout-challenge/' && urls.iosHttp === 'x-safari-http://127.0.0.1:8080/', JSON.stringify(urls.ios));
  check('Instagram on iPhone uses its own instagram://extbrowser/?url=... link (x-safari is blocked there) with the encoded team code; other apps keep x-safari; Android is unchanged by the app name',
    urls.igIos === 'instagram://extbrowser/?url=' + encodeURIComponent('https://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP') && urls.fbIosApp === 'x-safari-https://x.test/' && urls.igAndroidApp.startsWith('intent://x.test/#Intent;scheme=https;'), urls.igIos);
  check('Android handoff link is an intent:// link for the default browser (no package forced) and keeps the team code', /^intent:\/\/joseph-vincent-sdb\.github\.io\/checkout-challenge\/#t=QWERTYUP#Intent;scheme=https;S\.browser_fallback_url=https%3A%2F%2Fjoseph-vincent-sdb\.github\.io%2Fcheckout-challenge%2F%23QWERTYUP;end$/.test(urls.android.replace('%23t%3D','%23QWERTYUP')) || (urls.android.startsWith('intent://joseph-vincent-sdb.github.io/checkout-challenge/#t=QWERTYUP#Intent;scheme=https;') && urls.android.endsWith(';end') && !/package=/.test(urls.android)), urls.android);
  check('Unknown systems get no handoff link', urls.other === '');
  await pure.ctx.close(); phones.pop();

  // iPhone Instagram: nothing automatic (only a tap is accepted), the button uses Instagram's own link, and a refusal is reported
  const hookShare = () => { window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); }; navigator.share = d => { window.__shared = d; return Promise.resolve(); }; };
  const hookNoShare = () => { window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); }; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); };
  const I = await phone('', { join: false, ctx: { userAgent: IGI }, init: hookNoShare }); await I.evaluate(() => sessionStorage.clear()); await I.goto('about:blank'); await I.goto(BASE + '#t=' + TEAM); await I.waitForSelector('#app *'); await wait(1200);
  check('Instagram on iPhone: nothing is attempted automatically (Instagram only accepts a tap, and an automatic try could blank the page)', (await navs(I)).length === 0);
  check('...the guide is on screen with the Open in Safari button, the three steps and Copy link', /Open this in Safari/.test(await I.innerText('#app')) && !!(await I.$('[data-act=iab-open]')) && !!(await I.$('[data-act=iab-copy]')) && (await I.$$('ol.how li')).length === 3);
  check('...no "did not open" warning before anything was tried, and no Share button when the phone cannot share', !(await I.$('#iabfail')) && !(await I.$('[data-act=iab-share]')));
  await tap(I, '[data-act=iab-open]'); await wait(300);
  const n2 = await navs(I);
  check('Tapping "Open in Safari" opens instagram://extbrowser/?url=<link> in the main window', n2.length === 1 && n2[0][1] === 'main' && n2[0][0].startsWith('instagram://extbrowser/?url=') && decodeURIComponent(n2[0][0].slice('instagram://extbrowser/?url='.length)) === BASE + '#t=' + TEAM, JSON.stringify(n2));
  await wait(2200);
  const failTxt = (await I.innerText('#app')).replace(/\n/g, ' ');
  check('If the page is still there ~2 s later it says "did not open Safari" and points to the menu and Copy link', !!(await I.$('#iabfail')) && /did not open Safari/.test(failTxt) && /Copy link/.test(failTxt), failTxt.slice(0, 160));
  await I.screenshot({ path: path.join(ROOT, 'tests', 'screenshots', 'iab-instagram-ios-failed.png') });
  await I.setViewportSize({ width: 320, height: 568 }); await wait(200);
  const lay0 = await I.evaluate(() => { const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('hscroll'); document.querySelectorAll('#app button').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.height < 47.5 || r.width < 47.5)) bad.push(b.textContent.trim().slice(0, 12)); }); const f = document.querySelector('.foot'); if (f && f.getBoundingClientRect().bottom > innerHeight + 1) bad.push('foot-offscreen'); return bad.join(','); });
  check('The guide with the warning fits the smallest phone (320 x 568), all buttons 48 px, buttons on screen', lay0 === '', lay0);
  await I.setViewportSize({ width: 375, height: 667 });
  await I.reload(); await I.waitForSelector('#app *'); await wait(800);
  check('After a reload the guide is back without a stale warning and nothing was tried again', !(await I.$('#iabfail')) && (await navs(I)).length === 0);
  check('No JS errors', noErr([I]), errs([I])); await I.ctx.close(); phones.pop();

  // the page really does leave: the warning must not appear
  const L = await phone('', { join: false, ctx: { userAgent: IGI }, init: () => { window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); setTimeout(() => window.dispatchEvent(new Event('pagehide')), 200); }; } });
  await L.goto('about:blank'); await L.goto(BASE + '#t=' + TEAM); await L.waitForSelector('#app *'); await wait(500);
  await tap(L, '[data-act=iab-open]'); await wait(2600);
  check('When the jump works (the page is hidden), no "did not open" warning is shown', !(await L.$('#iabfail')) && (await navs(L)).length === 1);
  await L.ctx.close(); phones.pop();

  // phones that can share get a Share link button
  const S = await phone('', { join: false, ctx: { userAgent: IGI }, init: hookShare }); await S.goto('about:blank'); await S.goto(BASE + '#t=' + TEAM); await S.waitForSelector('#app *'); await wait(500);
  check('A phone that supports sharing gets a Share link button', !!(await S.$('[data-act=iab-share]')));
  await tap(S, '[data-act=iab-share]'); await wait(300);
  const shared = await S.evaluate(() => window.__shared);
  check('...and it shares the clean link with the team code', shared && shared.url === BASE + '#t=' + TEAM, JSON.stringify(shared));
  check('No JS errors', noErr([S]), errs([S])); await S.ctx.close(); phones.pop();

  // Android Instagram: automatic try goes through a hidden frame (cannot break the page), the button uses the main window
  const A = await phone('', { join: false, ctx: { userAgent: IGA }, init: hook }); await A.evaluate(() => sessionStorage.clear()); await A.goto('about:blank'); await A.goto(BASE + '#t=' + TEAM); await A.waitForSelector('#app *'); await wait(1200);
  const an = await navs(A);
  check('Instagram on Android: tries by itself once, through a hidden frame so the page can never be replaced by an error', an.length === 1 && an[0][1] === 'frame' && an[0][0].startsWith('intent://') && an[0][0].includes('#t=' + TEAM + '#Intent;scheme=http;') && !/package=/.test(an[0][0]), JSON.stringify(an).slice(0, 220));
  await tap(A, '[data-act=iab-open]'); await wait(300);
  const an2 = await navs(A);
  check('...and the button uses the main window (needed by some apps)', an2.length === 2 && an2[1][1] === 'main');
  check('No JS errors', noErr([A]), errs([A])); await A.ctx.close(); phones.pop();

  // with nothing stubbed: if the app does not understand the link, the guide must stay on screen and nothing may break
  for (const [label, ua] of [['iPhone', IGI], ['Android', IGA]]) {
    const R = await phone('', { join: false, ctx: { userAgent: ua } }); await R.evaluate(() => sessionStorage.clear()); await R.goto('about:blank'); await R.goto(BASE + '#t=' + TEAM); await R.waitForSelector('#app *'); await wait(1800);
    const still1 = /Open this in (Safari|Chrome)/.test(await R.innerText('#app')) && !!(await R.$('[data-act=iab-open]'));
    await R.click('[data-act=iab-open]').catch(() => {}); await wait(2600);
    const still2 = await R.evaluate(() => /Open this in (Safari|Chrome)/.test(document.body.innerText) && !!document.querySelector('[data-act=iab-open]'));
    check(`Instagram on ${label}, real navigation with nothing stubbed: the guide is still there after any automatic try and after tapping the button`, still1 && still2, `auto=${still1} tap=${still2} url=${R.url().slice(0, 60)}`);
    check(`...and no errors`, noErr([R]), errs([R])); await R.ctx.close(); phones.pop();
  }
  // other in-app browsers: no automatic attempt (unknown behaviour), but the button works
  const T = await phone('', { join: false, ctx: { userAgent: TT }, init: hook }); await T.goto('about:blank'); await T.goto(BASE + '#t=' + TEAM); await T.waitForSelector('#app *'); await wait(1200);
  check('TikTok: no automatic attempt', (await navs(T)).length === 0);
  await tap(T, '[data-act=iab-open]'); await wait(300);
  check('TikTok: the button still tries', (await navs(T)).length === 1);
  await T.ctx.close(); phones.pop();

  // choosing "Continue anyway" ends the attempts; normal browsers are never touched
  const C = await phone('', { join: false, ctx: { userAgent: IGI }, init: hook }); await C.goto('about:blank'); await C.goto(BASE + '#t=' + TEAM); await C.waitForSelector('#app *'); await wait(900);
  await tap(C, '[data-act=iab-continue]'); await wait(300);
  await C.evaluate(() => sessionStorage.clear()); await C.reload(); await C.waitForSelector('#app *'); await wait(1200);
  check('After "Continue anyway" it never tries to leave again, even in a new session', (await navs(C)).length === 0 && !!(await C.$('[data-act=next]')));
  await C.ctx.close(); phones.pop();
  const N = await phone('', { join: false, ctx: { userAgent: SAF }, init: hook }); await N.goto('about:blank'); await N.goto(BASE + '#t=' + TEAM); await N.waitForSelector('#app *'); await wait(1200);
  check('A normal browser (Safari) is never redirected or warned, and joins the team', (await navs(N)).length === 0 && !(await N.$('[data-act=iab-open]')) && await until(async () => (await N.evaluate(() => CC.state().team)) === TEAM, 6000));
  await N.ctx.close(); phones.pop();
  await reset();
}

/* ---------- 9d. the team code in a ?t= link (in case a chat app drops the # part) ---------- */
if (want('9d')) {
  const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
  const SAF = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const hook = () => { window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); }; };
  const ctxOpts = ua => ({ userAgent: ua, ...(IS_CHROMIUM ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  const N = await phone('', { join: false, ctx: ctxOpts(SAF) }); await N.goto('about:blank'); await N.goto(BASE + '?t=' + TEAM); await N.waitForSelector('#app *');
  check('Normal browser: a ?t=CODE link joins the team and removes the code from the address', await until(async () => (await N.evaluate(() => CC.state().team)) === TEAM, 6000) && new URL(N.url()).search === '' && new URL(N.url()).hash === '', N.url());
  await N.ctx.close(); phones.pop();
  const K = await phone('', { join: false, ctx: ctxOpts(SAF) }); await K.goto('about:blank'); await K.goto(BASE + '?utm=chat&t=' + TEAM.slice(0, 4) + '-' + TEAM.slice(4)); await K.waitForSelector('#app *');
  check('Other parts of the link are kept and a dashed or lower-case code works too', await until(async () => (await K.evaluate(() => CC.state().team)) === TEAM, 6000) && new URL(K.url()).search === '?utm=chat', K.url());
  await K.ctx.close(); phones.pop();
  await reset();   // a fresh team, so "nothing was written for it" is meaningful
  const I = await phone('', { join: false, ctx: ctxOpts(IGI), init: hook }); await I.evaluate(() => sessionStorage.clear()); await I.goto('about:blank'); await I.goto(BASE + '?t=' + TEAM); await I.waitForSelector('#app *'); await wait(1200);
  const txt = await I.innerText('#app'); const navs = await I.evaluate(() => window.__navs || []);
  check('Instagram browser: a ?t=CODE link shows the guide with the team code and does not join', /Open this in Safari/.test(txt) && txt.includes(TEAM.slice(0, 4) + '-' + TEAM.slice(4)) && (await I.evaluate(() => CC.state().team)) === '' && mock.get(['events', TEAM]) === null);
  check('...nothing is tried automatically on iPhone', navs.length === 0, JSON.stringify(navs));
  await tap(I, '[data-act=iab-open]'); await wait(300);
  const navs2 = await I.evaluate(() => window.__navs || []);
  check('...the Open in Safari button carries the code in the # part of the link (not the ?t= form)', navs2.length === 1 && navs2[0][0].startsWith('instagram://extbrowser/?url=') && decodeURIComponent(navs2[0][0].slice(28)) === BASE + '#t=' + TEAM, JSON.stringify(navs2));
  if (IS_CHROMIUM) { await tap(I, '[data-act=iab-copy]'); await wait(400); const clip = await I.evaluate(() => navigator.clipboard.readText()); check('...and Copy link gives the clean #t= form', clip === BASE + '#t=' + TEAM, clip); }
  await tap(I, '[data-act=iab-continue]');
  check('...and Continue anyway joins the team and removes the code from the address', await until(async () => (await I.evaluate(() => CC.state().team)) === TEAM, 6000) && new URL(I.url()).search === '', I.url());
  check('No JS errors', noErr([I]), errs([I])); await I.ctx.close(); phones.pop();
  await reset();
}

/* ---------- 10. monkey test: random chaos ---------- */
if (want('10')) {
  const A = await phone('Monkey A'), B = await phone('Monkey B'); await until(async () => (await st(A)) === 'ok' && (await st(B)) === 'ok');
  const end = Date.now() + (+process.env.MONKEY_S || 60) * 1000; let acts = 0;
  const rndi = n => Math.floor(Math.random() * n);
  async function monkey(p) {
    while (Date.now() < end) {
      const r = Math.random(); acts++;
      try {
        if (r < 0.55) { const els = await p.$$('#app [data-act]:not([data-hold]), #layer [data-act]'); if (els.length) await els[rndi(els.length)].click({ timeout: 800, noWaitAfter: true }).catch(() => {}); }
        else if (r < 0.7) { await p.mouse.click(rndi(375), rndi(667)); }
        else if (r < 0.76) { const el = await p.$('#code, #label'); if (el) await el.fill(['', 'abc', 'K7MQ-X2PA', '<b>x</b>', '小小小'][rndi(5)]).catch(() => {}); }
        else if (r < 0.82) { await p.goBack().catch(() => {}); }
        else if (r < 0.86) { await p.reload().catch(() => {}); await p.waitForSelector('#app *', { timeout: 4000 }).catch(() => {}); }
        else if (r < 0.9) { await p.setViewportSize(Math.random() < 0.5 ? { width: 667, height: 375 } : { width: 375, height: 667 }); }
        else if (r < 0.94) { await p.ctx.setOffline(true); await wait(rndi(3500)); await p.ctx.setOffline(false); }
        else if (r < 0.97) { const el = await p.$('#servebtn, [data-act=answer]'); if (el) { await el.click({ clickCount: 3, delay: 20, timeout: 800 }).catch(() => {}); } }
        else { mock.ctl.failRate = Math.random() < 0.5 ? 0.5 : 0; mock.ctl.delayMs = rndi(400); }
      } catch (e) { /* the page may be mid reload */ }
      await wait(rndi(200));
    }
  }
  await Promise.all([monkey(A), monkey(B)]);
  mock.ctl.failRate = 0; mock.ctl.delayMs = 0; for (const p of [A, B]) { await p.ctx.setOffline(false); await p.setViewportSize({ width: 375, height: 667 }); }
  // some of the monkey's clicks may have left a modal or a customer on screen: finish cleanly
  for (const p of [A, B]) { for (let i = 0; i < 4; i++) { const m = await p.$('[data-act=modal-close]'); if (m) await m.click().catch(() => {}); await wait(200); } }
  const rej = (await Promise.all([A, B].map(p => p.evaluate(() => window.__rej || []).catch(() => [])))).flat();
  check(`Monkey test (${acts} random actions on 2 phones): no uncaught promise rejections`, rej.length === 0, rej.slice(0, 3).join(' | '));
  const realErrs = [A, B].flatMap(p => p.errors).filter(e => !/due to access control checks|Fetch API cannot load/.test(e));   // WebKit logs a cancelled or offline fetch like this even though the app handles it
  const noise = [A, B].flatMap(p => p.errors).length - realErrs.length;
  console.log(`  (monkey info: ${noise} WebKit-logged handled network failure(s), ${rej.length} uncaught rejection(s))`);
  check(`Monkey test: no JavaScript errors (apart from WebKit logging handled network failures)`, realErrs.length === 0, realErrs.join(' | '));
  const settled = await until(async () => (await Promise.all([A, B].map(async p => (await st(p)) === 'ok' && (await unsent(p)) === 0))).every(Boolean), 20000);
  check('Both phones reconnect and have nothing unsent', settled);
  await wait(5000);
  const snap = await Promise.all([A, B].map(p => p.evaluate(() => { const S = CC.state(); return { id: S.id, c: S.c, adj: S.adj, rem: CC.remaining(), tot: CC.totals().c.served }; })));
  check('All numbers are valid after the chaos (whole numbers, not negative, adjustment in range)', snap.every(s => Object.values(s.c).every(v => Number.isInteger(v) && v >= 0 && v <= 100000) && Math.abs(s.adj) <= 5000));
  check('Both phones agree with each other and with the database', snap[0].rem === snap[1].rem && snap.every(s => cloudDevices()[s.id] && cloudDevices()[s.id].c.served === s.c.served) && cloudServed() === snap[0].tot, JSON.stringify(snap.map(s => [s.rem, s.tot])) + ' cloud=' + cloudServed());
  await reset();
}

await closeAll(); await browser.close(); web.close(); await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenario checks passed (${process.env.BROWSER || 'chromium'})`);
process.exit(failed.length ? 1 : 0);
