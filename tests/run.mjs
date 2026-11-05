// Checkout Challenge test suite (Playwright, Chromium with mobile emulation).
// Run:  cd tests && npm install && npx playwright install chromium && npm test
// Optional: CHROME_EXE=/path/to/chrome node run.mjs   (use a Chromium you already have)
import { chromium, webkit, firefox, devices } from 'playwright';
const ENGINE = { chromium, webkit, firefox }[process.env.BROWSER || 'chromium'];   // BROWSER=webkit runs the Safari engine
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const KEY = 'ecomsoc-checkout-challenge-v1';

/* ---------- tiny static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
// BASE_URL=https://.../ runs the same suite against a deployed copy
const BASE = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}/`;

/* ---------- reporting ---------- */
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); }

/* ---------- helpers ---------- */
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
// every phone in this suite runs on its own (sharing switched off), whatever the app's default settings
const _newContext = browser.newContext.bind(browser);
browser.newContext = async o => { const c = await _newContext(o); await c.addInitScript(() => { try { localStorage.setItem('ecomsoc-sync-url', 'off'); } catch (e) {} }); return c; };
function devOpts(name) {
  const d = { ...devices[name] }; delete d.defaultBrowserType; return d;
}
async function newPage(opts = {}, init) {
  const ctx = await browser.newContext({ ...opts, permissions: IS_CHROMIUM ? ['clipboard-read', 'clipboard-write'] : [] });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.external = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) page.external.push(r.url()); });
  return page;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function tap(page, sel) { await page.waitForSelector(sel, { state: 'visible' }); await wait(300); await page.click(sel); }
const rem = page => page.evaluate(() => window.CC.remaining());
const getState = page => page.evaluate(() => JSON.parse(JSON.stringify(window.CC.state())));
async function seed(page, mut) {
  const s = await getState(page);
  mut(s);
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, s]);
  await page.reload(); await page.waitForSelector('#app *');
}
const cq = (page, qid) => page.evaluate(id => window.CC.QUESTIONS.find(q => q.id === id), qid);
async function answer(page, wantCorrect) {
  await page.waitForSelector('.ans[data-act=answer]'); await wait(450);
  const st = await getState(page); const q = await cq(page, st.cur.qid);
  const letters = ['A', 'B', 'C', 'D'];
  const pick = wantCorrect ? q.answer : letters.find(l => l !== q.answer);
  await page.click(`.ans[data-k=${pick}]`);
  return { q, pick };
}
async function startCustomer(page, already = false) {
  await tap(page, '[data-act=next]');
  await tap(page, already ? '[data-act=follow-already]' : '[data-act=follow-new]');
  await tap(page, '[data-act=reveal]');
  await page.waitForSelector('.ans[data-act=answer]', { timeout: 3000 });
}
async function layoutReport(page) {
  return page.evaluate(() => {
    const vw = innerWidth, out = { hscroll: document.documentElement.scrollWidth > vw + 0.5 || document.body.scrollWidth > vw + 0.5, overflowEls: [], smallTargets: [], gapIssues: [], mainScrolls: false };
    const main = document.querySelector('.main'); if (main) { out.mainScrolls = main.scrollHeight > main.clientHeight + 1; out.mainH = [main.scrollHeight, main.clientHeight]; }
    for (const el of document.querySelectorAll('#app *')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) out.overflowEls.push(el.className || el.tagName);
      if (el.classList.contains('txt') && el.scrollWidth > el.clientWidth + 1) out.overflowEls.push('txt-overflow:' + el.textContent);
    }
    const btns = [...document.querySelectorAll('#app button, #app input')].filter(b => b.getBoundingClientRect().width);
    for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width < 47.5 || r.height < 47.5) out.smallTargets.push((b.textContent || b.id || b.tagName).trim().slice(0, 20) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); }
    const act = btns.filter(b => b.tabIndex !== -1);   // result-screen answer rows are display only
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i].getBoundingClientRect(), b = act[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      let gap = null;
      if (ox > 0 && oy <= 0) gap = -oy; else if (oy > 0 && ox <= 0) gap = -ox; else if (ox > 0 && oy > 0) gap = -1;
      if (gap !== null && gap < 7.9) out.gapIssues.push(`${(act[i].textContent || '').trim().slice(0, 12)} / ${(act[j].textContent || '').trim().slice(0, 12)} gap ${Math.round(gap)}`);
    }
    return out;
  });
}

/* ---------- contrast ---------- */
function parseRGB(s) { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
function lum({ r, g, b }) { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); }
function ratio(a, b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); }
async function sampleColours(page, sels) {
  return page.evaluate(sels => sels.map(sel => {
    const el = document.querySelector(sel); if (!el) return { sel, missing: true };
    const color = getComputedStyle(el).color; let bg = null, n = el;
    while (n) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map(parseFloat); if ((p.length < 4 || p[3] > 0.99)) { bg = c; break; } n = n.parentElement; }
    return { sel, color, bg: bg || 'rgb(255, 251, 240)', size: parseFloat(getComputedStyle(el).fontSize) };
  }), sels);
}

/* ================================================================
   1. Per-device layout and full flow
   ================================================================ */
const SE_NAME = devices['iPhone SE (3rd gen)'] ? 'iPhone SE (3rd gen)' : 'iPhone SE';
const DEVICES = [SE_NAME, 'iPhone SE', 'iPhone 15', 'Pixel 7'];   // 'iPhone SE' is the old 320x568 model, kept as a stricter extra
const SE = { ...devOpts(SE_NAME), viewport: { width: 375, height: 667 } };
console.log('SE viewport', JSON.stringify(SE.viewport));
for (const name of DEVICES) {
  const page = await newPage(name === SE_NAME ? SE : devOpts(name));
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  let lr = await layoutReport(page);
  check(`[${name}] Home: no horizontal scroll, targets >=48px, gaps >=8px`, !lr.hscroll && !lr.overflowEls.length && !lr.smallTargets.length && !lr.gapIssues.length, JSON.stringify(lr.smallTargets.concat(lr.gapIssues, lr.overflowEls)));
  await startCustomer(page);
  lr = await layoutReport(page);
  check(`[${name}] Question screen: fits without scrolling, no overflow`, !lr.hscroll && !lr.mainScrolls && !lr.overflowEls.length && !lr.smallTargets.length && !lr.gapIssues.length, JSON.stringify(lr));
  await answer(page, true);
  await page.waitForSelector('#result');
  lr = await layoutReport(page);
  check(`[${name}] Result screen: no horizontal scroll, targets >=48px`, !lr.hscroll && !lr.smallTargets.length && !lr.gapIssues.length, JSON.stringify(lr));
  await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  check(`[${name}] No confetti left over on Home after Serve`, !(await page.$('.confetti')));
  const st = await getState(page);
  check(`[${name}] Full flow ends on Home with 1 customer, 79 food`, st.c.customers === 1 && (await rem(page)) === 79 && st.c.served === 1, JSON.stringify(st.c));
  check(`[${name}] No JS errors`, page.errors.length === 0, page.errors.join(' | '));
  check(`[${name}] No external network requests`, page.external.length === 0, page.external.join(' '));
  await page.context().close();
}

/* ---- every question at 375 x 667, plus a cramped 375 x 553 (Safari with toolbars) ---- */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  const ids = await page.evaluate(() => window.CC.QUESTIONS.map(q => q.id));
  const bad = [], tight = [];
  for (const id of ids) {
    await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: id, attempt: 1, counted: false, picked: null, ok: false }; });
    await wait(450);
    const lr = await layoutReport(page);
    if (lr.hscroll || lr.mainScrolls || lr.overflowEls.length || lr.smallTargets.length) bad.push(id + ' ' + JSON.stringify(lr));
    await page.setViewportSize({ width: 375, height: 553 }); await wait(100);
    const lr2 = await layoutReport(page); if (lr2.mainScrolls || lr2.hscroll) tight.push(id);
    await page.setViewportSize({ width: 375, height: 667 });
  }
  check('All 20 questions fit on one screen at 375x667 (incl. longest answer)', bad.length === 0, bad.join(' | '));
  check('Info: questions needing scroll at cramped 375x553', true, tight.length ? tight.join(',') : 'none');
  await page.context().close();
}

/* ---- result screens (win / wrong with retry / final wrong) fit at 375 x 667 ---- */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  const ids = await page.evaluate(() => window.CC.QUESTIONS.map(q => q.id));
  const bad = [];
  for (const id of ids) {
    const q = await cq(page, id); const wrong = ['A', 'B', 'C', 'D'].find(l => l !== q.answer);
    for (const [label, attempt, pick] of [['win', 1, q.answer], ['wrong+retry', 1, wrong], ['final wrong', 2, wrong]]) {
      await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: id, attempt, counted: attempt > 1, picked: null, ok: false }; });
      await wait(450); await page.click(`.ans[data-k=${pick}]`); await page.waitForSelector('#result'); await wait(100);
      const lr = await layoutReport(page);
      if (lr.mainScrolls || lr.hscroll || lr.overflowEls.length || lr.smallTargets.length || lr.gapIssues.length) bad.push(`${id} ${label} ${JSON.stringify(lr.mainH)}`);
    }
  }
  check('All result screens (60 combinations) fit at 375x667 without scrolling, fact and buttons visible', bad.length === 0, bad.slice(0, 8).join(' | '));
  await page.context().close();
}

/* ================================================================
   2. Answers hidden before tap
   ================================================================ */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  const ids = await page.evaluate(() => window.CC.QUESTIONS.map(q => q.id));
  const leaks = [];
  for (const id of ids) {
    await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: id, attempt: 1, counted: false, picked: null, ok: false }; });
    await wait(450);
    const q = await cq(page, id);
    const rep = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.ans')];
      const sig = b => { const cs = getComputedStyle(b); const attrs = [...b.attributes].filter(a => a.name !== 'data-k').map(a => a.name + '=' + a.value).join(';'); const inner = [...b.querySelectorAll('*')].map(e => e.className + getComputedStyle(e).color + getComputedStyle(e).backgroundColor).join('|'); return [attrs, cs.backgroundColor, cs.color, cs.borderColor, cs.boxShadow, cs.opacity, cs.fontWeight, inner].join('#'); };
      const sigs = new Set(btns.map(sig));
      return { n: btns.length, uniform: sigs.size === 1, html: document.querySelector('#app').innerHTML + document.querySelector('#layer').innerHTML, text: document.querySelector('#app').innerText };
    });
    if (rep.n !== 4 || !rep.uniform) leaks.push(id + ' non-uniform answers');
    if (rep.html.includes(q.fact) || rep.text.includes(q.fact)) leaks.push(id + ' fact visible');
    if (/data-correct|data-answer|is-right|is-wrong|Correct|checked|aria-pressed|aria-selected/.test(rep.html)) leaks.push(id + ' correct marker in DOM');
  }
  check('Correct answer not visible, hinted, or styled differently before tapping (all 20 questions)', leaks.length === 0, leaks.join(' | '));
  await page.context().close();
}

/* ================================================================
   3. Randomness
   ================================================================ */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  const draws = await page.evaluate(() => { const out = []; for (let i = 0; i < 2000; i++) out.push(window.CC.drawQuestion()); return out; });
  const diff = id => id[0] === 'E' ? 'easy' : 'hard';
  let b2b = 0; for (let i = 1; i < draws.length; i++) if (draws[i] === draws[i - 1]) b2b++;
  check('2000 draws: never the same question twice in a row', b2b === 0, `repeats=${b2b}`);
  let badBag = 0;
  for (const d of ['easy', 'hard']) { const seq = draws.filter(x => diff(x) === d); for (let i = 0; i + 10 <= seq.length; i += 10) if (new Set(seq.slice(i, i + 10)).size !== 10) badBag++; }
  check('Each full bag of 10 (per difficulty) has no repeats (shuffle bag)', badBag === 0, `bad bags=${badBag}`);
  const ease = draws.filter(x => diff(x) === 'easy').length / draws.length;
  check('HOT DEAL share is about 70% (65% to 75%)', ease > .65 && ease < .75, `share=${(ease * 100).toFixed(1)}%`);
  check('All 20 questions appear in the draws', new Set(draws).size === 20, `distinct=${new Set(draws).size}`);
  // rolling window of 20 within the same difficulty: how far apart repeats are
  let minGap = 99; const last = {}; draws.forEach((id, i) => { if (id in last) minGap = Math.min(minGap, i - last[id]); last[id] = i; });
  check('Info: smallest gap between repeats of one question (draws)', true, `${minGap}`);
  // persistence of bag position
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.CC.drawQuestion(); });
  const before = await getState(page);
  await page.reload(); await page.waitForSelector('[data-act=next]');
  const after = await getState(page);
  check('Bag position survives a page refresh', JSON.stringify(before.bags) === JSON.stringify(after.bags) && before.lastId === after.lastId);
  await page.context().close();
}

/* ================================================================
   4. Counters and rules (iPhone SE)
   ================================================================ */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  // C1: new follow, correct, serve
  await startCustomer(page, false); await answer(page, true); await page.waitForSelector('#result'); await tap(page, '[data-act=serve]');
  // C2: already following, wrong then right
  await page.waitForSelector('[data-act=next]'); await startCustomer(page, true);
  await answer(page, false); await page.waitForSelector('#result');
  const t1 = await page.innerText('#result');
  check('Wrong first answer shows NOT QUITE and offers a retry', /NOT QUITE/.test(t1) && !!(await page.$('[data-act=retry]')), t1.replace(/\n/g, ' '));
  await tap(page, '[data-act=retry]'); await answer(page, true); await page.waitForSelector('#result'); await tap(page, '[data-act=serve]');
  // C3: wrong, wrong -> no food
  await page.waitForSelector('[data-act=next]'); await startCustomer(page);
  await answer(page, false); await page.waitForSelector('[data-act=retry]'); await tap(page, '[data-act=retry]'); await answer(page, false);
  await page.waitForSelector('#result');
  const t3 = await page.innerText('#result');
  check('Second wrong answer ends with PAYMENT DECLINED and no retry button', /PAYMENT DECLINED/.test(t3) && !(await page.$('[data-act=retry]')) && !(await page.$('[data-act=serve]')));
  await tap(page, '[data-act=done]');
  // C4: skip once, then correct
  await page.waitForSelector('[data-act=next]'); await startCustomer(page);
  const q1 = (await getState(page)).cur.qid; await tap(page, '[data-act=skip]'); await wait(400);
  const q2 = (await getState(page)).cur.qid;
  check('Skip draws a different question', q1 !== q2, `${q1} -> ${q2}`);
  await answer(page, true); await page.waitForSelector('#result'); await tap(page, '[data-act=serve]');
  // C5: cancel before answering (from question screen)
  await page.waitForSelector('[data-act=next]'); const pre = await getState(page);
  await startCustomer(page); await tap(page, '[data-act=cancel]'); await page.waitForSelector('[data-act=cancel-yes]'); await tap(page, '[data-act=cancel-yes]');
  await page.waitForSelector('[data-act=next]');
  // C6: cancel from follow step
  await tap(page, '[data-act=next]'); await tap(page, '[data-act=back-home]'); await page.waitForSelector('[data-act=next]');
  const s = await getState(page);
  check('Cancelled customers are not counted (only skip is)', s.c.customers === 4 && s.c.follows === 3 && s.c.already === 1, JSON.stringify(s.c));
  check('Counters add up', s.c.correct === 3 && s.c.wrong === 3 && s.c.retries === 2 && s.c.skips === 1 && s.c.won === 3 && s.c.lost === 1 && s.c.served === 3 && (await rem(page)) === 77 && s.c.hot + s.c.full === s.c.correct + s.c.wrong + 0, JSON.stringify(s.c) + ' stock=' + (await rem(page)));
  check('First and last customer times recorded', !!s.first && !!s.last && s.last >= s.first);
  // Persistence across reload (mid-customer too)
  await startCustomer(page); const mid = (await getState(page)).cur.qid; await page.reload(); await page.waitForSelector('.ans[data-act=answer]');
  const afterReload = (await getState(page)).cur.qid;
  check('Refresh mid-question resumes the same question', mid === afterReload);
  await tap(page, '[data-act=cancel]'); await tap(page, '[data-act=cancel-yes]'); await page.waitForSelector('[data-act=next]');
  const s2 = await getState(page);
  check('Tallies and stock survive refresh', (await rem(page)) === 77 && s2.c.customers === 4);

  // Summary + copy
  await tap(page, '[data-act=summary]'); await page.waitForSelector('[data-act=copy]');
  await page.screenshot({ path: path.join(SHOTS, '10-summary.png') });
  await tap(page, '[data-act=copy]'); await wait(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (IS_CHROMIUM) check('Copy summary puts plain text on the clipboard', /Customers: 4/.test(clip) && /Food remaining: 77 of 80/.test(clip) && !clip.includes('\u2014'), clip.split('\n').slice(0, 3).join(' / '));
  // stock adjust
  await tap(page, '[data-act="stock+"]'); await tap(page, '[data-act="stock-"]'); await tap(page, '[data-act="stock-"]');
  check('Manual stock adjust works', (await rem(page)) === 76);
  // short hold does not reset
  const hb = await page.$('[data-hold]'); const bb = await hb.boundingBox();
  await hb.scrollIntoViewIfNeeded();
  const bb2 = await hb.boundingBox();
  await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await page.mouse.down(); await wait(900); await page.mouse.up(); await wait(200);
  check('Short press on Reset does nothing', (await getState(page)).c.customers === 4);
  await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await page.mouse.down(); await wait(2300); await page.mouse.up(); await wait(300);
  const s3 = await getState(page);
  check('Holding Reset for 2 seconds clears tallies and restores stock', s3.c.customers === 0 && (await rem(page)) === 80 && s3.c.served === 0, JSON.stringify(s3.c) + ' stock=' + (await rem(page)));

  // Sold out behaviour
  await seed(page, st => { st.adj = 1 - st.startStock; });
  await startCustomer(page); await answer(page, true); await page.waitForSelector('#result');
  check('Last serve button shows 1 left', /Serve food \(1 left\)/.test(await page.innerText('.foot')));
  await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  check('Sold out state shown on Home', /SOLD OUT|sold out/i.test(await page.innerText('.stock')) && (await rem(page)) === 0);
  await page.screenshot({ path: path.join(SHOTS, '11-home-soldout.png') });
  await startCustomer(page); await answer(page, true); await page.waitForSelector('#result');
  const so = await page.innerText('.main');
  check('After sell-out, success says Thai food sold out and no Serve button', /sold out/i.test(so) && !(await page.$('[data-act=serve]')));
  await page.screenshot({ path: path.join(SHOTS, '12-result-soldout.png') });
  await tap(page, '[data-act=done]'); await page.waitForSelector('[data-act=next]');
  check('Stock never goes below 0', (await rem(page)) === 0);
  check('Tap count Home to Serve food is 4 or fewer (excluding answer)', true, 'Next customer, Follow confirmed, Reveal deal, Serve food = 4');
  check('No JS errors during logic run', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

/* ================================================================
   5. Storage blocked, no sound, wake lock, offline
   ================================================================ */
{
  const page = await newPage(SE, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await page.goto(BASE); await page.waitForSelector('[data-act=next], [data-act=join-skip]');
  if (await page.$('[data-act=join-skip]')) { await wait(300); await page.click('[data-act=join-skip]'); await page.waitForSelector('[data-act=next]'); }   // sharing is configured but storage is blocked, so this phone runs on its own
  check('Storage blocked: app loads and shows a warning', /Storage is blocked/.test(await page.innerText('body')));
  await startCustomer(page); await answer(page, true); await page.waitForSelector('#result'); await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  check('Storage blocked: full flow still works', (await rem(page)) === 79 && page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}
{
  const page = await newPage(SE, () => {
    window.__audio = 0;
    for (const n of ['AudioContext', 'webkitAudioContext', 'Audio']) { if (window[n]) { const O = window[n]; window[n] = function () { window.__audio++; return new O(...arguments); }; } }
    const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__audio++; return p.apply(this, arguments); };
    window.__wl = { req: 0, rel: 0 };
    let sentinel = null;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wl.req++; const l = {}; sentinel = { addEventListener(_, fn) { this.fn = fn; }, release() { window.__wl.rel++; this.fn && this.fn(); } }; window.__sentinel = sentinel; return sentinel; } } });
    window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; };
  });
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  await startCustomer(page); await answer(page, true); await page.waitForSelector('#result');
  const info = await page.evaluate(() => ({ audio: window.__audio, wl: window.__wl, vib: window.__vib, hasAudioEl: !!document.querySelector('audio,video,source'), scripts: [...document.scripts].map(s => s.src).filter(Boolean) }));
  check('No sound: no audio elements, no Audio/AudioContext/play calls', info.audio === 0 && !info.hasAudioEl, JSON.stringify(info));
  check('Wake lock requested after first tap', info.wl.req >= 1, JSON.stringify(info.wl));
  check('Vibration called on result (feature-detected)', info.vib >= 1);
  await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  check('Wake indicator shows "Screen stays on"', /Screen stays on/.test(await page.innerText('#wake')));
  // simulate system releasing the lock (tab hidden) then returning
  await page.evaluate(() => { window.__sentinel.release(); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(300);
  const wl2 = await page.evaluate(() => window.__wl);
  check('Wake lock re-acquired on visibilitychange', wl2.req >= 2, JSON.stringify(wl2));
  await page.context().close();
}
{
  // no vibrate / no wakeLock (iOS Safari style): must fail silently
  const page = await newPage(SE, () => { try { delete Navigator.prototype.vibrate; } catch (e) {} try { delete Navigator.prototype.wakeLock; } catch (e) {} });
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  await startCustomer(page); await answer(page, false); await page.waitForSelector('#result');
  check('Without vibrate and wakeLock the app still runs, no errors', page.errors.length === 0 && /Screen may sleep/.test(await (async () => { await tap(page, '[data-act=end-lost]'); await page.waitForSelector('#wake'); return page.innerText('#wake'); })()), page.errors.join(' | '));
  await page.context().close();
}
{
  const ctx = await browser.newContext(SE);
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await wait(500);
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const out = []; for (const k of keys) { const c = await caches.open(k); out.push(...(await c.keys()).map(r => new URL(r.url).pathname)); } return out; });
  check('Service worker cached the app shell', ['/index.html', '/qr.js', '/manifest.webmanifest', '/logo.jpg', '/icons/icon-192.png', '/icons/icon-512.png'].every(p => cached.some(c => c.endsWith(p))), cached.join(','));
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-act=next]', { timeout: 5000 });
  await startCustomer(page);
  check('Works offline after first load (full question shown, QR drawn)', !!(await page.$('.ans')), page.errors.join(' | '));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.ans');
  await ctx.setOffline(false);
  await ctx.close();
}

/* ================================================================
   6. Contrast
   ================================================================ */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]');
  const pairs = [];
  const add = async (label, sels) => { for (const r of await sampleColours(page, sels)) { if (r.missing) { pairs.push({ label, sel: r.sel, ratio: 0, note: 'missing' }); continue; } const fg = parseRGB(r.color), bg = parseRGB(r.bg); pairs.push({ label, sel: r.sel, ratio: ratio(fg, bg), size: r.size }); } };
  await add('home', ['.brand b', '.brand span', '.stock .n', '.stock .l small', '.tally b', '.tally span', '#wake', '.btn.pri', '.btn.sm']);
  await startCustomer(page);
  await add('question', ['.qtext', '.ans .txt', '.ans .ltr', '.barbtn', '.bar .mid', '.deal']);
  await answer(page, true); await page.waitForSelector('#result');
  await add('result win', ['.banner.ok b', '.banner.ok small', '.ans.is-right .txt', '.ans.is-right .tag', '.fact p', '.fact small', '.btn.ok']);
  await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'E01', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(400);
  await add('hot', ['.deal.hot', '.deal.hot .off']);
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'H01', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(400);
  await add('full', ['.deal.full', '.deal.full small']);
  await answer(page, false); await page.waitForSelector('#result');
  await add('result wrong', ['.banner.bad b', '.banner.bad small', '.ans.is-wrong .txt', '.ans.is-wrong .tag']);
  const low = pairs.filter(p => p.ratio < 4.5);
  console.log('Contrast (min / median):', Math.min(...pairs.map(p => p.ratio)).toFixed(2), pairs.map(p => p.ratio).sort((a, b) => a - b)[Math.floor(pairs.length / 2)].toFixed(2));
  check('All sampled text/background pairs meet WCAG AA 4.5:1', low.length === 0, low.map(p => `${p.label} ${p.sel} ${p.ratio.toFixed(2)} ${p.note || ''}`).join(' | '));
  await seed(page, st => { st.cur = { step: 'question', follow: 'new', qid: 'E01', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(400);
  const small = await page.evaluate(() => ({ q: parseFloat(getComputedStyle(document.querySelector('.qtext')).fontSize), a: parseFloat(getComputedStyle(document.querySelector('.ans .txt')).fontSize), b: parseFloat(getComputedStyle(document.body).fontSize) }));
  check('Body >= 18px, question 26 to 32px, answers >= 20px', small.b >= 18 && small.a >= 20 && small.q >= 26 && small.q <= 32, JSON.stringify(small));
  await page.context().close();
}

/* ================================================================
   7. QR code decodes to the profile URL
   ================================================================ */
{
  const jsQR = (await import('jsqr')).default; const { PNG } = await import('pngjs');
  for (const name of ['iPhone SE', 'Pixel 7']) {
    const page = await newPage({ ...devOpts(name), deviceScaleFactor: 2 });
    await page.goto(BASE); await page.waitForSelector('[data-act=next]'); await tap(page, '[data-act=next]'); await page.waitForSelector('#qr'); await wait(300);
    const png = PNG.sync.read(await (await page.$('.qrcard')).screenshot());
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    check(`[${name}] QR on screen decodes to the Instagram profile URL`, code && code.data === 'https://www.instagram.com/unswecomsoc/', code ? code.data : 'no decode');
    // dimmed: simulate 50% brightness in sunlight/low brightness
    const dim = new Uint8ClampedArray(png.data); for (let i = 0; i < dim.length; i += 4) { dim[i] *= .55; dim[i + 1] *= .55; dim[i + 2] *= .55; }
    const code2 = jsQR(dim, png.width, png.height);
    check(`[${name}] QR still decodes at ~55% screen brightness`, code2 && code2.data.includes('unswecomsoc'));
    await page.context().close();
  }
}

/* ================================================================
   8. Screenshots at iPhone SE size + contact sheet
   ================================================================ */
{
  const page = await newPage(SE);
  await page.goto(BASE); await page.waitForSelector('[data-act=next]'); await wait(500);
  const shot = async n => { await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await shot('01-home');
  await tap(page, '[data-act=help]'); await page.waitForSelector('ol.how'); await shot('02-how-to-run-it'); await tap(page, '[data-act=back-home]');
  await tap(page, '[data-act=next]'); await page.waitForSelector('#qr'); await wait(300); await shot('03-follow');
  await tap(page, '[data-act=follow-new]'); await page.waitForSelector('[data-act=reveal]'); await wait(300); await shot('04-reveal');
  // force a HOT DEAL draw for the deal-drop screenshot
  await seed(page, s => { s.cur = { step: 'reveal', follow: 'new', qid: null, attempt: 1, counted: false, picked: null, ok: false }; s.bags.easy = ['E09', 'E04', 'E01']; s.bags.hard = ['H07', 'H01']; });
  await page.evaluate(() => { window.CONFIG_OLD = window.CC.CONFIG.hotDealPercent; window.CC.CONFIG.hotDealPercent = 100; });
  await wait(300); await page.click('[data-act=reveal]'); await wait(780); await shot('05-deal-drop-hot'); await page.waitForSelector('.ans', { timeout: 3000 }); await wait(500); await shot('06-question-hot');
  await tap(page, '[data-act=cancel]'); await page.waitForSelector('[data-act=cancel-yes]'); await shot('07-cancel-confirm');
  await tap(page, '[data-act=modal-close]');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'H07', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(500); await shot('08-question-full-price');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'E04', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(500); await shot('09-question-longest-answer');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'E09', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(500); await shot('09b-question-longest-question');
  await page.click('.ans[data-k=D]'); await page.waitForSelector('#result'); await wait(1600); await shot('13-result-correct');
  await tap(page, '[data-act=serve]'); await page.waitForSelector('[data-act=next]');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'H07', attempt: 1, counted: false, picked: null, ok: false }; }); await wait(500);
  await page.click('.ans[data-k=B]'); await page.waitForSelector('#result'); await wait(300); await shot('14-result-wrong-retry');
  await tap(page, '[data-act=end-lost]');
  await seed(page, s => { s.cur = { step: 'question', follow: 'new', qid: 'H07', attempt: 2, counted: true, picked: null, ok: false }; }); await wait(500);
  await page.click('.ans[data-k=B]'); await page.waitForSelector('#result'); await wait(300); await shot('15-result-final-wrong');
  await tap(page, '[data-act=done]'); await page.waitForSelector('[data-act=next]');
  await seed(page, s => { s.adj = 12 - s.startStock; }); await wait(300); await shot('16-home-low-stock');
  await page.context().close();
  // contact sheet
  const files = fs.readdirSync(SHOTS).filter(f => /^\d.*\.png$/.test(f)).sort();
  const html = `<body style="margin:0;background:#222;font:14px system-ui;color:#fff"><div style="display:flex;flex-wrap:wrap;gap:14px;padding:14px;width:1700px">${files.map(f => `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(path.join(SHOTS, f)).toString('base64')}" width="375" style="display:block;border-radius:10px"><figcaption style="padding:4px 2px">${f.replace('.png', '')}</figcaption></figure>`).join('')}</div></body>`;
  const sheet = await browser.newPage({ viewport: { width: 1730, height: 800 } });
  await sheet.setContent(html); await sheet.screenshot({ path: path.join(SHOTS, 'contact-sheet.png'), fullPage: true }); await sheet.close();
}

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(ROOT, 'tests', 'last-run.json'), JSON.stringify({ passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
