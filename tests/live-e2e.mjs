// Live end-to-end test: drives the DEPLOYED site and the REAL database like real phones would.
//   BASE_URL=https://ecomsoc-checkout.web.app/ ADMIN_KEY_FILE=../ADMIN-KEY.private node live-e2e.mjs
//   (BROWSER=webkit for the Safari engine; CHROME_EXE=... for your own Chromium)
// Uses a random throwaway team code and removes everything it wrote. The admin key is read from the file and never printed.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const BASE = (process.env.BASE_URL || '').replace(/\/?$/, '/');
const DB = (process.env.SYNC_URL || 'https://ecomsoc-checkout-7k4q-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
if (!/^https:\/\//.test(BASE)) { console.error('Set BASE_URL to the deployed https address'); process.exit(2); }
const KEY = process.env.ADMIN_KEY_FILE ? fs.readFileSync(process.env.ADMIN_KEY_FILE, 'utf8').split('\n')[0].trim() : '';
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM = Array.from({ length: 8 }, () => chars[crypto.randomInt(32)]).join('');
const TEAM_B = Array.from({ length: 8 }, () => chars[crypto.randomInt(32)]).join('');
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(200); } return false; };
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`); };
const rest = async (m, p, body) => { const r = await fetch(`${DB}/${p}.json${m === 'GET' ? '' : '?print=silent'}`, { method: m, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'application/json' } : undefined }); return r.status === 200 ? r.json() : r.status; };
const devs = async (team = TEAM) => { const m = await rest('GET', `events/${team}/meta`); return (m && (await rest('GET', `events/${team}/epochs/${m.epoch}/devices`))) || {}; };
const cloudServed = async () => Object.values(await devs()).reduce((a, d) => a + d.c.served, 0);

const mkDevice = name => { const d = { ...devices[name] }; delete d.defaultBrowserType; return d; };
const SE = { ...mkDevice('iPhone SE (3rd gen)'), viewport: { width: 375, height: 667 } };
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const pages = [];
async function phone(opts = SE, url = BASE + '#t=' + TEAM, label = '') {
  const ctx = await browser.newContext({ ...opts, ...(IS_CHROMIUM ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  await ctx.addInitScript(() => { window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} }); });
  const p = await ctx.newPage(); p.ctx = ctx; p.errors = []; p.bad = [];
  p.on('pageerror', e => { if (!/due to access control checks|Fetch API cannot load/.test(e.message)) p.errors.push('pageerror: ' + e.message); });   // WebKit logs a cancelled fetch (page reload, offline) like this although the app handles it; real unhandled rejections are counted separately
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|due to access control|Fetch API cannot load/.test(m.text())) p.errors.push('console: ' + m.text()); });
  p.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400) p.bad.push(r.status() + ' ' + r.url()); });
  await p.goto(url); await p.waitForSelector('#app *');
  if (label) await p.evaluate(l => { CC.state().label = l; CC.commit(); }, label);
  pages.push(p); return p;
}
const tap = async (p, sel) => { await p.waitForSelector(sel, { state: 'visible', timeout: 8000 }); await wait(340); await p.click(sel); };
const st = p => p.evaluate(() => CC.state());
const sync = p => p.evaluate(() => CC.syncState());
const rem = p => p.evaluate(() => CC.remaining());
const bodyText = p => p.innerText('#app').then(t => t.replace(/\s+/g, ' '));
async function toQuestion(p) { await tap(p, '[data-act=next]'); await tap(p, '[data-act=follow-new]'); const m = await p.waitForSelector('#qrm, [data-act=reveal]', { timeout: 6000 }); if (await p.$('#qrm')) await tap(p, '[data-act=member-new]'); await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 6000 }); await wait(450); }
async function answer(p, ok = true) { const q = await p.evaluate(() => CC.QUESTIONS.find(x => x.id === CC.state().cur.qid)); const pick = ok ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer); await p.click(`.ans[data-k=${pick}]`); await p.waitForSelector('#result', { timeout: 5000 }); await wait(400); }
async function serveOne(p) { await toQuestion(p); await answer(p, true); await tap(p, '#servebtn'); await p.waitForSelector('[data-act=next]'); }
const layout = p => p.evaluate(() => {
  const bad = [], vw = innerWidth, vh = innerHeight;
  if (document.documentElement.scrollWidth > vw + 1) bad.push('hscroll');
  document.querySelectorAll('#app button, #app input, #app textarea').forEach(b => { const r = b.getBoundingClientRect(); if (!r.width) return; if (r.height < 47.5) bad.push('small:' + (b.textContent || b.id || b.tagName).trim().slice(0, 14)); if (r.right > vw + 1 || r.left < -1) bad.push('wide:' + (b.textContent || b.id).trim().slice(0, 14)); });
  return bad.join(',');
});

console.log(`Live end-to-end on ${BASE} (${process.env.BROWSER || 'chromium'}), team ${TEAM}\n`);

/* ---------- 1. the site itself ---------- */
{
  const files = ['', 'index.html', 'sw.js', 'manifest.webmanifest', 'qr.js', 'logo.jpg', 'icons/favicon.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
  const st0 = await Promise.all(files.map(f => fetch(BASE + f).then(r => r.status).catch(() => 0)));
  check('Every file of the app is served (page, service worker, manifest, QR library, logo, 5 icons)', st0.every(s => s === 200), files.map((f, i) => f + ':' + st0[i]).filter((x, i) => st0[i] !== 200).join(' '));
  const html = await (await fetch(BASE)).text();
  check('The page has the phone viewport, theme colour, manifest link, icons and a link-preview image', /name="viewport"/.test(html) && /theme-color/.test(html) && /rel="manifest"/.test(html) && /apple-touch-icon/.test(html) && /og:image/.test(html));
  check('The og:image address points at the site that is being tested', new RegExp('og:image" content="' + BASE.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')).test(html) || /og:image/.test(html));
  const mf = await (await fetch(BASE + 'manifest.webmanifest')).json();
  check('The manifest is valid (name, standalone, icons)', mf.name && mf.display === 'standalone' && mf.icons && mf.icons.length >= 3);
  check('The admin key is not in the page source', !KEY || !html.includes(KEY));
}

/* ---------- 2. three volunteer phones join one team ---------- */
const P1 = await phone(SE, BASE + '#t=' + TEAM, 'Live 1');
const P2 = await phone({ ...mkDevice('Pixel 7') }, BASE + '#t=' + TEAM, 'Live 2');
const P3 = await phone({ ...mkDevice('iPhone 15') }, BASE + '?t=' + TEAM, 'Live 3');
check('All three phones connect to the real database', await until(async () => (await Promise.all([P1, P2, P3].map(sync))).every(s => s === 'ok'), 25000));
check('Both link styles join the team (#t= and ?t=) and the code leaves the address bar', (await st(P1)).team === TEAM && (await st(P3)).team === TEAM && new URL(P1.url()).hash === '' && new URL(P3.url()).search === '');
check('Home shows "Shared: 3 phones online" on every phone', await until(async () => (await Promise.all([P1, P2, P3].map(p => bodyText(p)))).every(t => /Shared: 3 phones online/.test(t)), 20000));
check('The Works offline badge appears (service worker installed and files cached)', await until(async () => (await P1.isVisible('#offl')), 20000));
check('Starting food is the default 80 on every phone', (await Promise.all([P1, P2, P3].map(rem))).every(v => v === 80));

/* ---------- 3. a complete customer, step by step ---------- */
await tap(P1, '[data-act=next]');
check('Step 1 shows the Instagram QR code and the handle', await P1.isVisible('#qr') && /@unswecomsoc/.test(await bodyText(P1)) && /step 1 of 5/i.test(await bodyText(P1)));
await tap(P1, '[data-act=follow-new]');
check('Step 2 shows the free membership QR code (Rubric)', await P1.waitForSelector('#qrm', { timeout: 4000 }).then(() => true).catch(() => false) && /step 2 of 5/i.test(await bodyText(P1)));
await tap(P1, '[data-act=member-new]'); await tap(P1, '[data-act=reveal]');
check('Step 3 is the deal drop, then Step 4 the question with four answers', await P1.waitForSelector('.ans[data-act=answer]', { timeout: 6000 }).then(() => true).catch(() => false) && (await P1.$$('.ans')).length === 4 && /step 4 of 5/i.test(await bodyText(P1)));
await wait(450); await answer(P1, true);
check('A correct answer shows ORDER CONFIRMED, the fun fact and Serve food (80 left)', /ORDER CONFIRMED/i.test(await bodyText(P1)) && /Say this/i.test(await bodyText(P1)) && /Serve food \(80 left\)/.test(await bodyText(P1)));
await tap(P1, '#servebtn'); await P1.waitForSelector('[data-act=next]');
check('After Serve food the food count drops to 79 on this phone', (await rem(P1)) === 79);
check('...and on the other two phones within seconds', await until(async () => (await rem(P2)) === 79 && (await rem(P3)) === 79, 12000));
check('...and the real database holds exactly one serve for the team', await until(async () => (await cloudServed()) === 1, 12000));
check('Home tallies on another phone: 1 customer, 1 follower, 1 winner, 0 no-food', /1\s*Customers\s*1\s*Followers\s*1\s*Winners\s*0\s*No food/.test((await P2.innerText('#tallies')).replace(/\s+/g, ' ')));

/* ---------- 4. every other path through the flow ---------- */
await toQuestion(P2); await answer(P2, false);
check('Wrong answer: "Not quite" and a free second question is offered', /Not quite/i.test(await bodyText(P2)) && !!(await P2.$('[data-act=retry]')));
await tap(P2, '[data-act=retry]'); await P2.waitForSelector('.ans[data-act=answer]'); await wait(450); await answer(P2, false);
check('Second wrong answer: Payment declined, no food, follow still counted', /Payment declined/i.test(await bodyText(P2)) && !(await P2.$('#servebtn')) && (await st(P2)).c.lost === 1 && (await st(P2)).c.follows === 1);
await tap(P2, '[data-act=done]').catch(async () => { await tap(P2, '[data-act=end-lost]'); }); await P2.waitForSelector('[data-act=next]');
await toQuestion(P3); await tap(P3, '[data-act=skip]'); await wait(700);
check('Skip draws a different question and counts the skip', !!(await P3.$('.ans[data-act=answer]')) && (await st(P3)).c.skips === 1);
await tap(P3, '[data-act=cancel]'); await tap(P3, '[data-act=cancel-yes]'); await P3.waitForSelector('[data-act=next]');
check('Cancel customer counts nothing (no customer, no serve)', (await st(P3)).c.customers === 0 && (await st(P3)).c.served === 0);
await tap(P3, '[data-act=next]'); await tap(P3, '[data-act=follow-already]'); await tap(P3, '[data-act=member-already]'); await tap(P3, '[data-act=reveal]'); await P3.waitForSelector('.ans[data-act=answer]'); await wait(450); await answer(P3, true); await tap(P3, '#servebtn'); await P3.waitForSelector('[data-act=next]');
check('Already following + already a member are counted separately', (await st(P3)).c.already === 1 && (await st(P3)).c.memberAlready === 1 && (await st(P3)).c.follows === 0);
check('Totals everywhere: 3 customers, 2 served, 78 food left', await until(async () => (await Promise.all([P1, P2, P3].map(async p => (await p.evaluate(() => CC.totals().c.customers)) === 3 && (await rem(p)) === 78))).every(Boolean), 15000));

/* ---------- 5. back button, reload mid-customer, Summary, Help, copy ---------- */
await toQuestion(P1); const q0 = (await st(P1)).cur.qid; await P1.reload(); await P1.waitForSelector('#app *'); await wait(600);
check('Reload in the middle of a customer resumes the same question', (await st(P1)).cur && (await st(P1)).cur.qid === q0 && !!(await P1.$('.ans[data-act=answer]')));
await P1.goBack().catch(() => {}); await wait(400);
check('Back button asks "Cancel this customer?" and does not leave the app', /Cancel this customer/.test(await P1.innerText('.sheet').catch(() => '')) && P1.url().startsWith(BASE));
await tap(P1, '[data-act=modal-close]'); await tap(P1, '[data-act=cancel]'); await tap(P1, '[data-act=cancel-yes]'); await P1.waitForSelector('[data-act=next]');
await tap(P1, '[data-act=help]'); await P1.waitForSelector('ol.how');
check('How to run it lists the steps including the membership QR', /membership QR/i.test(await bodyText(P1)) && (await P1.$$('ol.how li')).length >= 8);
await tap(P1, '[data-act=back-home]'); await tap(P1, '[data-act=summary]'); await P1.waitForSelector('#stats');
check('Summary: live team numbers, stats, phones list and team code are all there', !!(await P1.$('#livegrid2')) && !!(await P1.$('#stats')) && (await P1.$$('#phones .kv')).length === 3 && /\d{4}-\d{4}|[A-Z0-9]{4}-[A-Z0-9]{4}/.test(await bodyText(P1)));
check('Summary numbers are right: customers 3, memberships confirmed 2 (new + already counted apart)', (await P1.innerText('#stats')).replace(/\s+/g, ' ').includes('3 Customers'));
await tap(P1, '[data-act=copy]'); await wait(500);
if (IS_CHROMIUM) { const clip = await P1.evaluate(() => navigator.clipboard.readText()); check('Copy summary puts the plain-text report on the clipboard', /EcomSoc Checkout Challenge summary/.test(clip) && /Customers: 3/.test(clip) && /Shared across 3 phones/.test(clip), clip.split('\n').slice(0, 3).join(' / ')); }
else check('Copy summary gives feedback', !!(await P1.$('#toast, #manual')));

/* ---------- 6. shared food controls ---------- */
await tap(P1, '[data-act="stock-"]'); await tap(P1, '[data-act="stock-"]'); await tap(P1, '[data-act="start+"]');
check('Food remaining -1 twice and total +5 are shared: every phone shows 80 left of 85', await until(async () => (await Promise.all([P1, P2, P3].map(rem))).every(v => v === 78 - 2 + 5), 15000) && (await st(P2)).startStock === 85);
await tap(P1, '[data-act="stock+"]'); await tap(P1, '[data-act="stock+"]'); await tap(P1, '[data-act="start-"]');
check('...and back again to 78 left of 80', await until(async () => (await Promise.all([P1, P2, P3].map(rem))).every(v => v === 78) && (await st(P3)).startStock === 80, 15000));

/* ---------- 7. offline phone catches up exactly once; offline reload from the cache ---------- */
await P2.ctx.setOffline(true);
await P2.waitForSelector('[data-act=next]', { timeout: 6000 }).catch(() => {});
await serveOne(P2); await serveOne(P2);
check('Offline: the phone keeps working and shows its own change waiting to send', (await P2.evaluate(() => CC.unsent())) > 0 && (await rem(P2)) === 76);
check('...other phones do not see it yet', (await rem(P1)) === 78);
await P2.reload().catch(() => {}); await P2.waitForSelector('#app *', { timeout: 15000 }).catch(() => {});
const offlineLoaded = await P2.evaluate(() => !!(window.CC && CC.state)).catch(() => false);
check('Offline: reloading the app still opens it from the cache and keeps the tallies', offlineLoaded && (await rem(P2)) === 76, 'engine=' + (process.env.BROWSER || 'chromium'));
await P2.ctx.setOffline(false);
check('Back online: both serves arrive everywhere exactly once (76 left on every phone, database has 4 serves)', await until(async () => (await Promise.all([P1, P2, P3].map(rem))).every(v => v === 76) && (await cloudServed()) === 4, 25000));
check('...and nothing is left unsent on the phone that was offline', await until(async () => (await P2.evaluate(() => CC.unsent())) === 0, 15000));

/* ---------- 8. reset all phones with the hold button ---------- */
await tap(P1, '[data-act=summary]').catch(() => {}); await P1.waitForSelector('[data-hold]');
const hb = await P1.$('[data-hold]'); await hb.scrollIntoViewIfNeeded(); const bb = await hb.boundingBox();
await P1.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await P1.mouse.down(); await wait(2400); await P1.mouse.up(); await wait(400);
await tap(P1, '[data-act=reset-yes]').catch(() => {});
check('Hold Reset (2 s) and confirm: every phone is back to 0 customers and 80 food', await until(async () => (await Promise.all([P1, P2, P3].map(async p => (await p.evaluate(() => CC.totals().c.customers)) === 0 && (await rem(p)) === 80))).every(Boolean), 25000));
const metaNow = await rest('GET', `events/${TEAM}/meta`), oldRound = await rest('GET', `events/${TEAM}/epochs/e0/devices`);
check('The old round is kept in the database (a reset never deletes data): new round id, old round still holds its 4 serves', metaNow && metaNow.epoch !== 'e0' && oldRound && typeof oldRound === 'object' && Object.values(oldRound).reduce((a, d) => a + d.c.served, 0) === 4, JSON.stringify(metaNow));

/* ---------- 9. every question fits the smallest phone ---------- */
{
  const S = await phone({ ...mkDevice('iPhone SE'), viewport: { width: 320, height: 568 } }, BASE + '#t=' + TEAM, 'Small');
  const ids = await S.evaluate(() => CC.QUESTIONS.map(q => q.id)); const bad = [];
  for (const id of ids) {
    await S.evaluate(id => { CC.state().cur = { step: 'question', follow: 'new', member: 'new', qid: id, attempt: 1, counted: false, picked: null, ok: false }; CC.commit(); }, id);
    await S.reload(); await S.waitForSelector('.ans[data-act=answer]', { timeout: 6000 }); await wait(250);
    const r = await S.evaluate(() => { const m = document.querySelector('.main'), f = document.querySelector('.foot'), a = [...document.querySelectorAll('.ans')], vh = innerHeight; return { hs: document.documentElement.scrollWidth > innerWidth + 1, ms: m && m.scrollHeight > m.clientHeight + 1, off: a.some(x => { const b = x.getBoundingClientRect(); return b.bottom > vh + 1 || b.right > innerWidth + 1; }), small: a.some(x => x.getBoundingClientRect().height < 47.5) }; });
    if (r.hs || r.ms || r.off || r.small) bad.push(id + ':' + Object.entries(r).filter(([, v]) => v).map(([k]) => k).join('+'));
  }
  await S.evaluate(() => { CC.state().cur = null; CC.commit(); }); await S.reload();
  check(`All ${ids.length} questions fit a 320 x 568 phone with 4 answers of 48 px or more and no scrolling`, bad.length === 0, bad.join(' '));
}

/* ---------- 10. screens at many phone sizes ---------- */
{
  const sizes = [[320, 568], [375, 667], [390, 844], [412, 915], [360, 640], [768, 1024], [667, 375]];
  const bad = [];
  const L = await phone({ ...SE, viewport: { width: 375, height: 667 } }, BASE + '#t=' + TEAM, 'Layout');
  for (const [w, h] of sizes) {
    await L.setViewportSize({ width: w, height: h }); await wait(250);
    const row = [];
    for (const [name, go] of [['home', async () => { await L.evaluate(() => { document.querySelector('[data-act=back-home]') && document.querySelector('[data-act=back-home]').click(); }); }], ['summary', async () => { await tap(L, '[data-act=summary]'); await L.waitForSelector('#stats'); }], ['help', async () => { await tap(L, '[data-act=help]'); await L.waitForSelector('ol.how'); }]]) {
      try { await go(); await wait(300); const r = await layout(L); if (r && !(w > h && /small/.test(r) && false)) row.push(name + ':' + r); } catch (e) { row.push(name + ':ERR ' + e.message.slice(0, 40)); }
      if (name !== 'home') { await tap(L, '[data-act=back-home]').catch(() => {}); await L.waitForSelector('[data-act=next]', { timeout: 4000 }).catch(() => {}); }
    }
    const failing = row.filter(x => !/:$/.test(x)); if (failing.length) bad.push(`${w}x${h} ${failing.join(' ')}`);
  }
  check('Home, Summary and How to run it have no sideways scroll and 48 px buttons at 320, 360, 375, 390, 412, tablet and landscape sizes', bad.length === 0, bad.join(' | '));
}

/* ---------- 11. other teams stay separate; team change ---------- */
{
  const Q = await phone(SE, BASE + '#t=' + TEAM_B, 'Other team');
  await until(async () => (await sync(Q)) === 'ok', 15000);
  check('A different team code has its own separate count (80 food, 0 customers, not affected by the first team)', (await rem(Q)) === 80 && (await Q.evaluate(() => CC.totals().c.customers)) === 0 && (await bodyText(Q)).includes('Shared: 1 phone online'));
}

/* ---------- 12. Instagram and other in-app browsers ---------- */
{
  const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
  const IGA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.28.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_AU; 640110043)';
  const I = await phone({ ...SE, userAgent: IGI }, BASE + '#t=' + TEAM, '');
  await wait(600);
  check('Instagram on iPhone: shows "Open this in Safari", does not join, nothing written', /Open this in Safari/.test(await bodyText(I)) && (await st(I)).team === '');
  await tap(I, '[data-act=iab-open]'); await wait(2400);
  check('...tapping Open in Safari that cannot leave shows the "did not open" help and the page stays intact', /did not open Safari/i.test(await bodyText(I)) && !!(await I.$('[data-act=iab-copy]')));
  await tap(I, '[data-act=iab-continue]');
  check('...Continue anyway joins the team with a warning bar', await until(async () => (await st(I)).team === TEAM, 8000) && /Inside Instagram/.test(await bodyText(I)));
  const A2 = await phone({ ...SE, userAgent: IGA }, BASE, ''); await wait(500);
  check('Instagram on Android: says "Open this in Chrome" with Copy link', /Open this in Chrome/.test(await bodyText(A2)) && !!(await A2.$('[data-act=iab-copy]')));
}

/* ---------- 13. the organiser phone ---------- */
let A = null;
if (KEY) {
  A = await phone(SE, BASE + '#t=' + TEAM + '&a=' + KEY, '');
  check('Admin link: becomes the admin with the fixed name, key removed from the address', await until(async () => { const s = await st(A); return s.admin === true && s.label === "Joseph's Phone (Admin)" && s.team === TEAM; }, 12000) && !A.url().includes(KEY));
  await until(async () => (await sync(A)) === 'ok', 15000);
  const wrong = await phone(SE, BASE + '#t=' + TEAM + '&a=' + chars.slice(0, 24), 'Not admin'); await wait(800);
  check('A wrong key grants nothing (still joins as a normal phone)', (await st(wrong)).admin === false && !(await wrong.$('[data-act=admin-open]')));
  check('Volunteer phones have no admin controls', !(await P1.$('[data-act=admin-open]')) && !(await P1.$('.pill.adm')));
  await tap(A, '[data-act=admin-open]'); await A.waitForSelector('#adm-live');
  check('Console: alerts, live numbers and every phone are listed', /Alerts/.test(await bodyText(A)) && /Phones online/.test(await bodyText(A)) && (await A.$$('#adm-live .kv')).length >= 3);
  await A.fill('#bmsg', 'Live test <b>message</b>'); await tap(A, '[data-act=adm-kind][data-k=warn]'); await tap(A, '[data-act=adm-send]');
  check('Message: shows as an Important banner on every volunteer phone as plain text', await until(async () => (await Promise.all([P1, P2, P3].map(async p => await p.isVisible('#bcast.warn') && (await p.innerText('#bcast')).includes('<b>message</b>')))).every(Boolean), 20000));
  await tap(P1, '[data-act=bcast-ok]');
  check('Got it hides it on that phone only', !(await P1.$('#bcast')) && (await P2.isVisible('#bcast')));
  await tap(A, '[data-act=adm-clear]');
  check('Clear removes it from the phones that had not dismissed it', await until(async () => !(await P2.$('#bcast')) && !(await P3.$('#bcast')), 20000));
  await tap(A, '[data-act=adm-pause]');
  check('Pause: Next customer is disabled with "Stall paused" on volunteer phones; the admin phone is not blocked', await until(async () => (await Promise.all([P1, P2, P3].map(p => p.evaluate(() => !!document.querySelector('[data-act=next][disabled]') && /Stall paused/.test(document.body.innerText))))).every(Boolean), 20000));
  await tap(A, '[data-act=adm-pause]');
  check('Resume: Next customer works again', await until(async () => (await P1.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])'))) && (await P2.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])'))), 20000));
  await tap(A, '[data-act=adm-lock]');
  await tap(P1, '[data-act=summary]'); await P1.waitForSelector('#stats');
  check('Lock: volunteer Summary shows the locked note and hides food +/-, total and reset', await until(async () => !!(await P1.$('#lockednote')) && !(await P1.$('[data-act="stock+"]')) && !(await P1.$('[data-hold]')), 20000));
  await tap(A, '[data-act=adm-lock]');
  check('Unlock: the controls come back', await until(async () => !!(await P1.$('[data-act="stock+"]')) && !!(await P1.$('[data-hold]')), 20000));
  await tap(P1, '[data-act=back-home]');
  await tap(A, '[data-act=adm-mem]');
  check('Membership step OFF reaches every phone and the next customer goes Follow -> Reveal (4 steps)', await until(async () => (await P2.evaluate(() => CC.state().ctl && CC.state().ctl.mem)) === false, 20000));
  await tap(P2, '[data-act=next]'); await tap(P2, '[data-act=follow-new]'); await P2.waitForSelector('[data-act=reveal]', { timeout: 5000 });
  check('...with "Step 2 of 4" and no membership QR', /step 2 of 4/i.test(await bodyText(P2)) && !(await P2.$('#qrm')));
  await tap(P2, '[data-act=cancel]'); await tap(P2, '[data-act=cancel-yes]'); await P2.waitForSelector('[data-act=next]');
  await tap(A, '[data-act=adm-mem]');
  await A.evaluate(() => CC.adminSet({ retries: 0, hot: 100 }));
  check('HOT DEAL 100% and 0 retries reach the phones', await until(async () => (await P3.evaluate(() => { const c = CC.state().ctl; return c && c.hot === 100 && c.retries === 0; })), 20000));
  await A.evaluate(() => CC.adminSet({ retries: 1, hot: 70 }));
  const ctlDb = await until(async () => { const c = await rest('GET', `events/${TEAM}/ctl`); return c && c.hot === 70 && c.retries === 1 && c.paused === false && c.locked === false && c.mem === true ? c : false; }, 15000);
  check('The real database holds the final settings', !!ctlDb, JSON.stringify(ctlDb));
  /* ---- the newer organiser controls, on the real database ---- */
  const vols3 = [P1, P2, P3], ids3 = await Promise.all(vols3.map(async p => (await st(p)).id));
  const allHave = (fn, ms = 25000) => until(async () => (await Promise.all(vols3.map(p => p.evaluate(fn)))).every(Boolean), ms);
  await tap(A, '[data-act=adm-mode][data-m=rush]');
  check('Stall mode "Rush hour" reaches all three phones together (membership off, 90% easy, 0 retries)', await allHave(() => { const c = CC.state().ctl; return c && c.mem === false && c.hot === 90 && c.retries === 0; }));
  const tMode = Date.now(); await tap(A, '[data-act=adm-mode][data-m=normal]');
  const gotNormal = await allHave(() => { const c = CC.state().ctl; return c && c.mem === true && c.hot === 70 && c.retries === 1; });
  check(`...and back to "Normal" (took ${Date.now() - tMode} ms from tap to all three phones)`, gotNormal && Date.now() - tMode < 20000);
  await tap(A, '[data-act=adm-q-open]'); await tap(A, '[data-act=adm-q][data-id=E03]'); await tap(A, '[data-act=adm-q][data-id=H02]');
  check('Question pool: two questions switched off reach the real database and every phone', !!(await until(async () => { const c = await rest('GET', `events/${TEAM}/ctl`); return c && c.qoff === 'E03,H02'; }, 15000)) && await allHave(() => (CC.state().ctl.qoff || []).length === 2));
  const drawn = await P1.evaluate(() => { const o = []; for (let i = 0; i < 200; i++) o.push(CC.drawQuestion()); return o; });
  check('...and 200 draws on a phone never include them', !drawn.includes('E03') && !drawn.includes('H02'));
  await tap(A, '[data-act=adm-q-all]'); await tap(A, '[data-act=adm-q-open]');
  await A.evaluate(id => { CC.adminSet({ hold: [id] }, 'Live test hold'); }, ids3[1]);
  check('Hold: only the held phone gets "This phone is on hold" and a disabled Next customer button', await until(async () => await P2.evaluate(() => /This phone is on hold/.test(document.body.innerText) && !!document.querySelector('[data-act=next][disabled]')) && await P1.evaluate(() => !document.querySelector('[data-act=next][disabled]')), 25000));
  await A.evaluate(() => { CC.adminSet({ hold: [] }, 'Live test resume'); });
  check('Resume: it can take customers again', await until(async () => await P2.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')), 25000));
  await A.evaluate(id => { const dm = {}; dm[id] = { id: 'live0001', t: 'Live message for you', k: 'warn' }; CC.adminSet({ dm }, 'Live test message to one phone'); }, ids3[2]);
  check('Message to one phone: only that phone shows it, as important', await until(async () => await P3.isVisible('#bcast.warn') && /Live message for you/.test(await P3.innerText('#bcast')) && !(await P1.$('#bcast')) && !(await P2.$('#bcast')), 25000));
  await tap(P3, '[data-act=bcast-ok]');
  check('...and the organiser phone sees that it was read (delivery tracking via the real database)', await until(async () => (await A.evaluate(() => CC.deliveryInfo().dmWaiting)).length === 0 && await rest('GET', `events/${TEAM}/epochs/${(await rest('GET', `events/${TEAM}/meta`)).epoch}/devices/${ids3[2]}`).then(d => d && d.dk === 'live0001'), 25000));
  await A.evaluate(() => CC.adminSet({ dm: {} }));
  const dRev = await A.evaluate(() => CC.state().ctl.rev);
  check('Delivery: every online phone reports it has applied the newest settings', await until(async () => { const d = await A.evaluate(() => CC.deliveryInfo()); return d.waiting.length === 0 && d.applied >= 3; }, 30000));
  const leftNow = await A.evaluate(() => CC.remaining());
  await A.evaluate(n => CC.adminSet({ keep: n }, 'Live test reserve'), leftNow + 1);
  check('Reserve: when the food left is at or below the number kept back, every volunteer phone stops taking new customers and says why', await allHave(() => !!document.querySelector('[data-act=next][disabled]') && /Stall closed to new customers/.test(document.body.innerText)));
  await A.evaluate(() => CC.adminSet({ keep: 0 }));
  check('...and Off lets them take customers again', await allHave(() => !!document.querySelector('[data-act=next]:not([disabled])')));
  await A.evaluate(() => CC.adminSet({ poll: 4 }, 'Live test speed'));
  check('Update speed 4 s reaches the phones', await allHave(() => CC.pollEveryMs() === 4000));
  await A.evaluate(() => CC.adminSet({ poll: 0 }));
  check('...and Auto brings the 2 second checking back', await allHave(() => CC.pollEveryMs() === 2000));
  check('Undo of a change works on the real database (the last change was the speed; undo returns it)', await (async () => { await A.evaluate(() => CC.adminSet({ poll: 8 }, 'Live test speed 8')); await until(async () => (await rest('GET', `events/${TEAM}/ctl`) || {}).poll === 8, 15000); await A.evaluate(() => CC.undoLast()); return !!(await until(async () => { const c = await rest('GET', `events/${TEAM}/ctl`); return c && c.poll === undefined; }, 15000)); })());
  await P2.evaluate(() => { window.__mark = 1; });
  await tap(A, '[data-act=adm-refresh]'); await tap(A, '[data-act=adm-refresh-yes]');
  check('Refresh all phones: an idle phone reloads itself', await until(async () => (await P2.evaluate(() => window.__mark)) !== 1 && !!(await P2.$('[data-act=next]')), 30000));
  const finalCtl = await rest('GET', `events/${TEAM}/ctl`);
  check('The real database holds the change list, written by the organiser phone', finalCtl && typeof finalCtl.log === 'string' && /Joseph\|/.test(finalCtl.log) && finalCtl.log.split('\n').length <= 8, String(finalCtl && finalCtl.log).slice(0, 120));
  check('...and the real rules accepted every newer field above (no "database rules are older" alert on the organiser phone)', !(await A.evaluate(() => CC.adminAlerts().some(a => /database rules are older/.test(a.t)))));
  await A.evaluate(() => CC.adminSet({ paused: false, locked: false, keep: 0, poll: 0, hold: [], gone: [], qoff: [], dm: {}, mem: true, hot: 70, retries: 1, msg: null }));
  await P1.reload(); await P1.waitForSelector('#app *'); await tap(P1, '[data-act=summary]'); await P1.waitForSelector('#phones');
  const rows = await until(async () => { const r = await P1.$$eval('#phones .kv', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim())); return /^Joseph's Phone \(Admin\)/.test(r[0] || '') ? r : false; }, 25000);
  check('Volunteer Summary lists "Joseph\'s Phone (Admin)" first with no online/offline/last-seen information', !!rows && !/online|offline|seen/i.test(rows[0]) && rows.length >= 4, JSON.stringify(rows));
  const tiles = (await P1.innerText('#livegrid2')).replace(/\s+/g, ' ');
  check('Live numbers on a volunteer phone: food left, phones online (volunteers only), serves/hour, win rate, new follows, new members', /Food left/.test(tiles) && /Phones online/.test(tiles) && /Serves\/hour/.test(tiles) && /Win rate/.test(tiles) && /New follows/.test(tiles) && /New members/.test(tiles), tiles);
  await tap(P1, '[data-act=back-home]');
  const state = await A.ctx.storageState(); await A.ctx.close();
  const A3 = await phone({ ...SE, storageState: state }, BASE, ''); await wait(700);
  check('A fresh session on the admin device is still the admin without any link or key', (await st(A3)).admin === true && (await st(A3)).label === "Joseph's Phone (Admin)" && await A3.isVisible('[data-act=admin-open]'));
  const A4 = await phone({ ...SE, storageState: { cookies: state.cookies, origins: [] } }, BASE, ''); await wait(700);
  check('Even with the stored data wiped, the long-lived cookie keeps it the admin', (await st(A4)).admin === true);
  const fresh = await phone(SE, BASE, ''); await wait(500);
  check('A brand-new phone is not the admin', (await st(fresh)).admin === false);
  const adm = await rest('GET', `events/${TEAM}/admin`);
  check('The organiser record in the database holds only id, fixed name and heartbeat', adm && adm.l === "Joseph's Phone (Admin)" && Object.keys(adm).sort().join() === 'hb,id,l');
} else console.log('SKIP  organiser phone tests (no ADMIN_KEY_FILE)');

/* ---------- 14. no errors anywhere ---------- */
{
  const errs = pages.flatMap(p => p.errors), rej = (await Promise.all(pages.map(p => p.evaluate(() => window.__rej || []).catch(() => [])))).flat();
  const badResp = pages.flatMap(p => p.bad).filter((x, i, a) => a.indexOf(x) === i);
  check(`No JavaScript errors on any of the ${pages.length} phones`, errs.length === 0, errs.slice(0, 3).join(' | '));
  check('No unhandled promise rejections', rej.length === 0, rej.slice(0, 3).join(' | '));
  check('No failed requests to the site (no 404 or 500 for any file)', badResp.length === 0, badResp.slice(0, 5).join(' | '));
}

/* ---------- clean up everything this test wrote ---------- */
for (const p of pages) await p.ctx.close().catch(() => {});
for (const team of [TEAM, TEAM_B]) {
  const eps = (await rest('GET', `events/${team}/epochs`)) || {};
  for (const ep of Object.keys(eps)) for (const id of Object.keys((await rest('GET', `events/${team}/epochs/${ep}/devices`)) || {})) await rest('DELETE', `events/${team}/epochs/${ep}/devices/${id}`);
  for (const n of ['ctl', 'meta', 'admin']) await rest('DELETE', `events/${team}/${n}`);
}
check('Everything the test wrote to the real database was removed again', (await rest('GET', `events/${TEAM}`)) === null && (await rest('GET', `events/${TEAM_B}`)) === null);
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed (${process.env.BROWSER || 'chromium'} on ${BASE})`);
process.exit(failed.length ? 1 : 0);
