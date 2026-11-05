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
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
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
const toQuestion = async p => { await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 4000 }); await wait(450); };
const answer = async (p, ok = true) => { const q = await p.evaluate(() => CC.QUESTIONS.find(x => x.id === CC.state().cur.qid)); const pick = ok ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer); await p.click(`.ans[data-k=${pick}]`); await p.waitForSelector('#result'); };
const cloudDevices = () => { const m = mock.get(['events', TEAM, 'meta']); return mock.get(['events', TEAM, 'epochs', (m && m.epoch) || 'e0', 'devices']) || {}; };
const cloudServed = () => Object.values(cloudDevices()).reduce((a, d) => a + d.c.served, 0);
const noErr = ps => ps.every(p => p.errors.length === 0);
const errs = ps => ps.flatMap(p => p.errors).join(' | ');

/* ---------- 1. Back button / edge swipe ---------- */
{
  const p = await phone('A'); await until(async () => (await st(p)) === 'ok');
  const onApp = () => p.url().startsWith(BASE);
  await tap(p, '[data-act=summary]'); await p.waitForSelector('#stats'); await p.goBack(); await wait(400);
  check('Back on Summary goes to Home', await p.isVisible('[data-act=next]') && onApp());
  await tap(p, '[data-act=help]'); await p.waitForSelector('ol.how'); await p.goBack(); await wait(400);
  check('Back on How to run it goes to Home', await p.isVisible('[data-act=next]') && onApp());
  await tap(p, '[data-act=next]'); await p.waitForSelector('[data-act=follow-new]'); await p.goBack(); await wait(400);
  check('Back on the Follow step cancels the customer and goes Home', await p.isVisible('[data-act=next]') && (await p.evaluate(() => CC.state().cur)) === null);
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
{
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
  await tap(p, '[data-act=follow-new]'); await p.waitForSelector('[data-act=reveal]'); rows.push(await report('reveal'));
  await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]'); await wait(450); rows.push(await report('question'));
  await answer(p, false); rows.push(await report('result-retry'));
  check('Landscape: no sideways scrolling and every button can be scrolled into reach on every screen', rows.every(r => r.endsWith(':ok')), rows.join(' | '));
  await p.setViewportSize({ width: 375, height: 667 }); await wait(300);
  check('Rotating back to portrait restores the layout without losing the customer', !!(await p.$('[data-act=retry]')));
  check('No JS errors', noErr([p]), errs([p])); await reset();
}

/* ---------- 3. corrupted or odd saved data ---------- */
{
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
{
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
{
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
{
  const A = await phone('Ahead 3h', { offsetMs: 3 * 3600e3 }), B = await phone('Behind 3h', { offsetMs: -3 * 3600e3 }), C = await phone('On time');
  await until(async () => (await Promise.all([A, B, C].map(st))).every(s => s === 'ok'), 12000);
  await fakeServe(A, 2); await fakeServe(B, 3); await fakeServe(C, 4);
  check('Phones with clocks 3 hours fast and slow still agree on the totals (71 left)', await until(async () => (await Promise.all([A, B, C].map(rem))).every(r => r === 71), 10000), (await Promise.all([A, B, C].map(rem))).join(','));
  check('All three show as online after a heartbeat or two', await until(async () => /3 phones online/.test(await C.innerText('#syncrow')) && /3 phones online/.test(await A.innerText('#syncrow')), 25000), (await C.innerText('#syncrow')).replace(/\n/g, ' '));
  check('No JS errors', noErr([A, B, C]), errs([A, B, C])); await reset();
}

/* ---------- 7. the network answers, but not with the database ---------- */
{
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
{
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
{
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

/* ---------- 10. monkey test: random chaos ---------- */
{
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
  check(`Monkey test (${acts} random actions on 2 phones): no JavaScript errors`, noErr([A, B]), errs([A, B]));
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
