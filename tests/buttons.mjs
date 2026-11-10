// Every-button test: taps every button of the app (all data-act actions and the hold-to-reset gesture) on real phones,
// checks what each one does, and fails if any button that exists in the code was never tapped.
//   node buttons.mjs                                   local copy of the app + stand-in database
//   BASE_URL=https://ecomsoc-checkout.web.app/ ADMIN_KEY_FILE=../ADMIN-KEY.private node buttons.mjs
//        -> the DEPLOYED app and the REAL database with a throwaway team that is removed again (the list of buttons is read from the deployed page)
//   BROWSER=webkit for Safari's engine
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const LIVE = !!process.env.BASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let web = null, mock = null;
if (!LIVE) {
  web = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  mock = await startMock();
}
const BASE = LIVE ? process.env.BASE_URL.replace(/\/?$/, '/') : `http://127.0.0.1:${web.address().port}/`;
const DB = (process.env.SYNC_URL || 'https://ecomsoc-checkout-7k4q-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rc = n => Array.from({ length: n }, () => chars[crypto.randomInt(32)]).join('');
const TEAM = rc(8), TEAM2 = rc(8);
const KEY = LIVE ? fs.readFileSync(process.env.ADMIN_KEY_FILE, 'utf8').split('\n')[0].trim() : rc(24);
const HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const WRONGKEY = KEY.split('').reverse().join('') === KEY ? rc(24) : KEY.split('').reverse().join('');

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 200) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(150); } return false; };
const rest = async (m, p) => { const r = await fetch(`${DB}/${p}.json`, { method: m }); return r.status === 200 ? r.json() : null; };
const cloud = async segs => LIVE ? rest('GET', segs.join('/')) : mock.get(segs);
const ctlNow = () => cloud(['events', TEAM, 'ctl']);
const ctlIs = (pred, ms = 25000) => until(async () => { const c = await ctlNow(); return c && pred(c); }, ms);

const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
const NOISE = /due to access control checks|Fetch API cannot load/;
const pages = [];
async function phone(label, o = {}) {
  const ctx = await browser.newContext({ ...D, ...(o.ua ? { userAgent: o.ua } : {}), ...(IS_CHROMIUM ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  if (!LIVE) await ctx.addInitScript(([k, u, hk, h]) => { try { localStorage.setItem(k, u); localStorage.setItem(hk, h); } catch (e) {} }, ['ecomsoc-sync-url', mock.url, 'ecomsoc-admin-hash', HASH]);
  await ctx.addInitScript(() => {          // writes down every button that is tapped (in the tab's own storage, so it survives a reload)
    window.__rej = []; addEventListener('unhandledrejection', e => { try { window.__rej.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason))); } catch (x) {} });
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-act]'); if (!b || b.disabled) return; try { const o = JSON.parse(sessionStorage.getItem('__acts') || '{}'); o[b.dataset.act] = (o[b.dataset.act] || 0) + 1; sessionStorage.setItem('__acts', JSON.stringify(o)); } catch (x) {} }, true);
    window.__ccNavigate = (u, how) => { (window.__navs = window.__navs || []).push([u, how]); };
    navigator.share = d => { window.__shared = d; return Promise.resolve(); };
  });
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed|due to access control|Fetch API cannot load/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.goto(BASE + (o.url === undefined ? '#t=' + TEAM : o.url)); await page.waitForSelector('#app *');
  if (label) await page.evaluate(l => { CC.state().label = l; CC.commit(); }, label);
  pages.push(page); return page;
}
const st = p => p.evaluate(() => CC.state());
const sync = p => p.evaluate(() => CC.syncState());
const rem = p => p.evaluate(() => CC.remaining());
const text = p => p.innerText('#app').then(t => t.replace(/\s+/g, ' '));
const toastOf = p => p.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
const tap = async (p, sel, o = {}) => { await p.waitForSelector(sel, { state: 'visible', timeout: o.timeout || 15000 }); await wait(340); await p.click(sel, { timeout: 8000 }); };
const dismissBcast = async p => { if (await p.$('#bcast')) { await p.click('#bcast [data-act=bcast-ok]', { timeout: 3000 }).catch(() => {}); await wait(350); } };
const closeSheet = async p => { if (await p.$('#layer .sheet')) { await tap(p, '#layer [data-act=modal-close]'); await wait(250); } };
const answerWith = async (p, right) => { const q = await p.evaluate(() => CC.QUESTIONS.find(x => x.id === CC.state().cur.qid)); const k = right ? q.answer : ['A', 'B', 'C', 'D'].find(l => l !== q.answer); await wait(450); await p.click(`.ans[data-act=answer][data-k=${k}]`); await p.waitForSelector('#result', { timeout: 5000 }); };
async function toQuestion(p, followBtn = 'follow-new', memberBtn = 'member-new') {
  await tap(p, '[data-act=next]'); await tap(p, `[data-act=${followBtn}]`);
  await p.waitForSelector('[data-act=member-new], [data-act=reveal]');
  if (await p.$('[data-act=member-new]')) await tap(p, `[data-act=${memberBtn}]`);
  await tap(p, '[data-act=reveal]'); await p.waitForSelector('.ans[data-act=answer]', { timeout: 6000 }); await wait(450);
}
const holdReset = async p => { const hb = await p.$('[data-hold]'); await hb.scrollIntoViewIfNeeded(); const bb = await hb.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await wait(2400); await p.mouse.up(); };

console.log(`Every-button test on ${BASE} (${process.env.BROWSER || 'chromium'}${LIVE ? ', REAL database' : ', stand-in database'}), team ${TEAM}\n`);

/* ---------- which buttons exist in the code being tested ---------- */
const html = LIVE ? await (await fetch(BASE)).text() : fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hs = html.indexOf("document.addEventListener('click', function (e) {"), he = html.indexOf("document.addEventListener('input'", hs);
const ALL = [...new Set([...html.slice(hs, he).matchAll(/case '([^']+)':/g)].map(m => m[1]))].sort();
check(`The page defines ${ALL.length} button actions to cover (read from the ${LIVE ? 'deployed' : 'local'} page)`, ALL.length >= 60, ALL.length + ' actions');

/* ---------- phones ---------- */
const A = await phone('', { url: '#t=' + TEAM + '&a=' + KEY });
await until(async () => (await st(A)).admin === true && (await st(A)).team === TEAM, 15000);
const V1 = await phone('Volunteer 1'), V2 = await phone('Volunteer 2');
await until(async () => (await Promise.all([A, V1, V2].map(sync))).every(s => s === 'ok'), 25000);
check('Organiser phone and two volunteer phones are connected', (await Promise.all([A, V1, V2].map(sync))).every(s => s === 'ok'));
const id1 = (await st(V1)).id, id2 = (await st(V2)).id;
const food0 = await rem(V1);

/* ===== volunteer: the customer flow ===== */
await tap(V1, '[data-act=next]');
check('next: starts a customer on the Instagram follow screen (step 1)', !!(await V1.$('[data-act=follow-new]')) && /step 1 of 5/i.test(await text(V1)));
await tap(V1, '[data-act=back-home]');
check('back-home (from the first step): returns to Home and nothing was counted', !!(await V1.$('[data-act=next]')) && (await st(V1)).cur === null && (await st(V1)).c.customers === 0);
await toQuestion(V1);                                        // next, follow-new, member-new, reveal
check('next, follow-new, member-new, reveal: reach a question (step 4 of 5)', /step 4 of 5/i.test(await text(V1)) && !!(await V1.$('.ans[data-act=answer]')));
await tap(V1, '[data-act=cancel]');
check('cancel: asks first, with "Cancel customer" and "Keep going"', !!(await V1.$('#layer [data-act=cancel-yes]')) && !!(await V1.$('#layer [data-act=modal-close]')));
await tap(V1, '#layer [data-act=modal-close]');
check('modal-close ("Keep going"): the dialog closes and the question is still there', !(await V1.$('#layer .sheet')) && !!(await V1.$('.ans[data-act=answer]')));
await tap(V1, '[data-act=cancel]'); await tap(V1, '#layer [data-act=cancel-yes]');
check('cancel-yes: ends the customer, nothing counted', !!(await V1.$('[data-act=next]')) && (await st(V1)).c.customers === 0 && (await st(V1)).cur === null);
// a winning customer, served
await toQuestion(V1);
const qBefore = await V1.evaluate(() => CC.state().cur.qid);
await tap(V1, '[data-act=skip]'); await V1.waitForSelector('.ans[data-act=answer]'); await wait(450);
check('skip: counts a skip and gives a different question', (await st(V1)).c.skips === 1 && (await V1.evaluate(() => CC.state().cur.qid)) !== qBefore);
await answerWith(V1, true);
check('answer (right): ORDER CONFIRMED with the Serve button', /ORDER CONFIRMED/i.test(await text(V1)) && !!(await V1.$('#servebtn')));
await tap(V1, '[data-act=serve]'); await V1.waitForSelector('[data-act=next]');
check('serve: one serve counted and one less food', (await st(V1)).c.served === 1 && (await rem(V1)) === food0 - 1, (await rem(V1)) + ' vs ' + (food0 - 1));
// already following / already member, wrong answer, retry, declined, done
await toQuestion(V1, 'follow-already', 'member-already');
await answerWith(V1, false);
check('follow-already and member-already: counted as already (not new)', (await st(V1)).c.already === 1 && (await st(V1)).c.memberAlready === 1);
check('answer (wrong): "NOT QUITE" with Try one more question and End here', /NOT QUITE/i.test(await text(V1)) && !!(await V1.$('[data-act=retry]')) && !!(await V1.$('[data-act=end-lost]')));
await tap(V1, '[data-act=retry]'); await V1.waitForSelector('.ans[data-act=answer]'); await wait(450);
check('retry: a new question, retries counted', (await st(V1)).c.retries === 1 && /step 4 of 5/i.test(await text(V1)));
await answerWith(V1, false);
check('a second wrong answer: PAYMENT DECLINED and a Done button', /PAYMENT DECLINED/i.test(await text(V1)) && !!(await V1.$('[data-act=done]')));
await tap(V1, '[data-act=done]'); await V1.waitForSelector('[data-act=next]');
check('done: back to Home, customer counted as lost', (await st(V1)).c.lost === 1 && (await st(V1)).cur === null);
await toQuestion(V1); await answerWith(V1, false); await tap(V1, '[data-act=end-lost]'); await V1.waitForSelector('[data-act=next]');
check('end-lost ("End here, no retry"): ends the customer as lost without a retry', (await st(V1)).c.lost === 2 && (await st(V1)).c.retries === 1);

/* ===== volunteer: Home, Summary, Help, sharing, joining ===== */
await tap(V1, '#syncrow');
check('sync-open (the status bar on Home): opens the Summary', !!(await V1.$('#stats')) && /Summary/i.test(await text(V1)));
check('The Summary shows the live numbers and every phone', /Phones online/.test(await text(V1)) && (await V1.$$('#phones .kv')).length >= 3);
await tap(V1, '[data-act=copy]'); await wait(400);
const copied = IS_CHROMIUM ? await V1.evaluate(() => navigator.clipboard.readText()) : '';
if (await V1.$('#layer .sheet')) await closeSheet(V1);
check('copy: copies the summary (or shows it to copy by hand)', IS_CHROMIUM ? /EcomSoc Checkout Challenge summary/.test(copied) : true, copied.slice(0, 40));
const f1 = await rem(V1); await tap(V1, '[data-act="stock-"]'); await until(async () => (await rem(V1)) === f1 - 1, 4000);
check('stock-: one less food (shared)', (await rem(V1)) === f1 - 1);
await tap(V1, '[data-act="stock+"]'); await until(async () => (await rem(V1)) === f1, 4000);
check('stock+: one more food', (await rem(V1)) === f1);
const s0 = (await st(V1)).startStock; await tap(V1, '[data-act="start+"]'); await until(async () => (await st(V1)).startStock === s0 + 5, 4000);
check('start+: total food at start up by 5', (await st(V1)).startStock === s0 + 5);
await tap(V1, '[data-act="start-"]'); await until(async () => (await st(V1)).startStock === s0, 4000); await wait(900);
check('start-: and back down by 5 (the shared total in the database follows)', (await st(V1)).startStock === s0 && await until(async () => ((await cloud(['events', TEAM, 'meta'])) || {}).startStock === s0, 15000));
await tap(V1, '[data-act=share]');
check('share: shows the join QR and the team code', !!(await V1.$('#qrjoin')) && (await V1.innerText('#layer .sheet')).replace(/\s/g, '').includes(TEAM.slice(0, 4) + '-' + TEAM.slice(4)));
await tap(V1, '#layer [data-act=modal-close]');
await tap(V1, '[data-act=change-team]');
check('change-team: opens the Join screen with the current code filled in', !!(await V1.$('#code')) && (await V1.inputValue('#code')).replace('-', '') === TEAM);
await tap(V1, '[data-act=join-go]'); await V1.waitForSelector('[data-act=next], #stats').catch(() => {});
check('join-go (same team): goes back without clearing anything', (await st(V1)).team === TEAM && (await st(V1)).c.served === 1);
if (!(await V1.$('[data-act=next]'))) await tap(V1, '[data-act=back-home]');
await tap(V1, '[data-act=help]');
check('help: opens "How to run it"', /How to run it/i.test(await text(V1)) && !!(await V1.$('ol.how')));
await tap(V1, '[data-act=back-home]'); await V1.waitForSelector('[data-act=next]');
// organiser sign-in with a wrong key
await tap(V2, '[data-act=summary]'); await tap(V2, '[data-act=admin-signin]'); await V2.waitForSelector('#adminkey');
await V2.fill('#adminkey', WRONGKEY); await tap(V2, '[data-act=admin-signin-go]'); await wait(900);
check('admin-signin and admin-signin-go: a wrong key is refused and says so, nothing unlocked', /not valid/i.test(await toastOf(V2)) && (await st(V2)).admin === false);
await tap(V2, '[data-act=back-home]'); await V2.waitForSelector('[data-act=next]');
// a phone that has not joined: skip, sync-open, join-go, join-yes
const J = await phone('', { url: '' });
await until(async () => /Join your team/.test(await text(J)), 6000);
await tap(J, '[data-act=join-skip]');
check('join-skip ("Use on this phone only"): goes to Home, not shared', !!(await J.$('[data-act=next]')) && /Not shared/.test(await text(J)));
await tap(J, '#syncrow');
check('sync-open on a phone that has not joined: opens the Join screen', !!(await J.$('#code')));
await J.evaluate(() => { const S = CC.state(); S.c.customers = 2; S.c.served = 1; S.c.won = 1; S.c.correct = 1; S.c.hot = 1; S.c.follows = 2; CC.commit(); });
await J.fill('#code', TEAM2.slice(0, 4) + '-' + TEAM2.slice(4)); await tap(J, '[data-act=join-go]');
await J.waitForSelector('#layer [data-act=join-yes]');
check('join-go with a phone that already has tallies: asks before clearing them', /will be cleared/.test(await J.innerText('#layer .sheet')));
await tap(J, '#layer [data-act=join-yes]');
check('join-yes: joins the other team and clears this phone\'s own tallies', await until(async () => (await st(J)).team === TEAM2 && (await st(J)).c.customers === 0, 6000));

/* ===== the Instagram browser screen ===== */
const I = await phone('', { url: '#t=' + TEAM, ua: IGI });
await I.waitForSelector('[data-act=iab-open]'); await wait(500);
check('In an Instagram browser the guide shows and nothing is joined', /Open this in Safari/.test(await text(I)) && (await st(I)).team === '');
await tap(I, '[data-act=iab-open]'); await wait(2500);
check('iab-open ("Open in Safari"): tries the hand-over once and shows the "did not open" help when the page stays', /did not open Safari/i.test(await text(I)) && ((await I.evaluate(() => (window.__navs || []).length)) >= 1));
await tap(I, '[data-act=iab-copy]'); await wait(400);
if (await I.$('#layer .sheet')) await closeSheet(I);
check('iab-copy: copies the link (or shows it to copy by hand)', IS_CHROMIUM ? (await I.evaluate(() => navigator.clipboard.readText())).includes(TEAM) : true);
await tap(I, '[data-act=iab-share]'); await wait(300);
check('iab-share: hands the link to the phone\'s share sheet', !!(await I.evaluate(() => window.__shared)) && (await I.evaluate(() => window.__shared.url)).includes(TEAM));
await tap(I, '[data-act=iab-continue]');
check('iab-continue ("Continue here anyway"): joins the team with a warning bar', await until(async () => (await st(I)).team === TEAM, 8000) && /Inside Instagram/.test(await text(I)));
await tap(I, '[data-act=iab-help]');
check('iab-help (the warning bar): shows the guide again', /Open this in Safari/.test(await text(I)));
await tap(I, '[data-act=iab-continue]'); await I.waitForSelector('[data-act=next]');

/* ===== organiser: every control ===== */
await tap(A, '[data-act=admin-open]'); await A.waitForSelector('#adm-live');
check('admin-open: the organiser console opens', /Organiser/i.test(await text(A)) && !!(await A.$('#adm-ctl')));
await tap(A, '[data-act=adm-pause]');
check('adm-pause: pauses the stall for volunteers', await ctlIs(c => c.paused === true) && await until(async () => await V2.evaluate(() => !!document.querySelector('[data-act=next][disabled]')), 25000));
await tap(A, '[data-act=adm-pause]'); await ctlIs(c => c.paused === false);
await tap(A, '[data-act=adm-lock]');
check('adm-lock: locks volunteer food settings', await ctlIs(c => c.locked === true));
await tap(A, '[data-act=adm-lock]'); await ctlIs(c => c.locked === false);
await tap(A, '[data-act=adm-mem]');
check('adm-mem: switches the membership step off', await ctlIs(c => c.mem === false));
await tap(A, '[data-act=adm-mem]'); await ctlIs(c => c.mem === true);
await tap(A, '[data-act="adm-hot+"]'); await tap(A, '[data-act="adm-hot+"]');
check('adm-hot+: easy-question chance up by 10 each tap (90)', await ctlIs(c => c.hot === 90));
await tap(A, '[data-act="adm-hot-"]'); await tap(A, '[data-act="adm-hot-"]'); await tap(A, '[data-act="adm-hot-"]');
check('adm-hot-: and down again (60)', await ctlIs(c => c.hot === 60));
await tap(A, '[data-act="adm-ret+"]');
check('adm-ret+: one more retry (2)', await ctlIs(c => c.retries === 2));
await tap(A, '[data-act="adm-ret-"]'); await tap(A, '[data-act="adm-ret-"]');
check('adm-ret-: and fewer (0)', await ctlIs(c => c.retries === 0));
for (const [m, ok] of [['rush', c => c.mem === false && c.hot === 90 && c.retries === 0], ['quiet', c => c.mem === true && c.hot === 50 && c.retries === 2], ['clear', c => c.mem === false && c.hot === 100 && c.retries === 2], ['normal', c => c.mem === true && c.hot === 70 && c.retries === 1]]) {
  await tap(A, `[data-act=adm-mode][data-m=${m}]`);
  check(`adm-mode (${m}): sets membership, easy chance and retries in one write`, await ctlIs(ok));
}
await tap(A, '[data-act=adm-keep-set][data-n="5"]'); await tap(A, '[data-act="adm-keep+"]');
check('adm-keep-set and adm-keep+: reserve 5, then 6', await ctlIs(c => c.keep === 6));
await tap(A, '[data-act="adm-keep-"]');
check('adm-keep-: reserve 5', await ctlIs(c => c.keep === 5));
await tap(A, '[data-act=adm-keep-set][data-n="0"]');
check('adm-keep-set (Off): removes the reserve', await ctlIs(c => c.keep === undefined));
await tap(A, '[data-act=adm-poll][data-s="4"]');
check('adm-poll (4 s): every phone checks every 4 seconds', await ctlIs(c => c.poll === 4) && await until(async () => await V1.evaluate(() => CC.pollEveryMs() === 4000), 25000));
await tap(A, '[data-act=adm-poll][data-s="0"]');
check('adm-poll (Auto): back to automatic', await ctlIs(c => c.poll === undefined));
await tap(A, '[data-act=adm-q-open]');
check('adm-q-open: lists all 20 questions', (await A.$$('[data-act=adm-q]')).length === 20);
await tap(A, '[data-act=adm-q][data-id=E01]'); await tap(A, '[data-act=adm-q][data-id=H01]');
check('adm-q: switches single questions off', await ctlIs(c => c.qoff === 'E01,H01'));
await tap(A, '[data-act=adm-q][data-id=E01]');
check('adm-q (again): and back on', await ctlIs(c => c.qoff === 'H01'));
await tap(A, '[data-act=adm-q-all]');
check('adm-q-all: all questions back on', await ctlIs(c => c.qoff === undefined));
await tap(A, '[data-act=adm-q-open]');
await tap(A, '[data-act=adm-preset][data-t="Only 10 serves left"]');
check('adm-preset: a quick message fills the box', (await A.inputValue('#bmsg')) === 'Only 10 serves left');
await tap(A, '[data-act=adm-kind][data-k=warn]');
check('adm-kind: Important is selected', await A.evaluate(() => document.querySelector('[data-act=adm-kind][data-k=warn]').classList.contains('on')));
await tap(A, '[data-act=adm-send]');
check('adm-send: the message reaches the volunteer phones as an Important banner', await until(async () => (await Promise.all([V1, V2].map(p => p.isVisible('#bcast.warn')))).every(Boolean), 25000));
await tap(V1, '[data-act=bcast-ok]');
check('bcast-ok ("Got it"): hides it on that phone only', !(await V1.$('#bcast')) && (await V2.isVisible('#bcast')));
await tap(A, '[data-act=adm-clear]');
check('adm-clear: removes it from the phones that had not dismissed it', await until(async () => !(await V2.$('#bcast')), 25000));
// per-phone controls
await until(async () => (await A.$$(`#adm-live [data-act=adm-phone]`)).length >= 3, 25000);
await A.locator(`#adm-live [data-act=adm-phone][data-id="${id2}"]`).click(); await A.waitForSelector('#layer [data-act=adm-hold]');
check('adm-phone: tapping a phone opens its controls', /Volunteer 2/.test(await A.innerText('#layer h3')));
await tap(A, '#layer [data-act=adm-hold]');
check('adm-hold: puts that phone on hold (and only that one)', await ctlIs(c => c.hold === id2) && await until(async () => await V2.evaluate(() => /on hold/i.test(document.body.innerText) && !!document.querySelector('[data-act=next][disabled]')), 25000) && await V1.evaluate(() => !document.querySelector('[data-act=next][disabled]')));
await tap(A, '#layer [data-act=adm-hold]');
check('adm-hold (again): resumes it', await ctlIs(c => c.hold === undefined) && await until(async () => await V2.evaluate(() => !!document.querySelector('[data-act=next]:not([disabled])')), 25000));
await tap(A, '#layer [data-act=adm-dm-preset][data-t="Come and see me"]');
await tap(A, '#layer [data-act=adm-dm-kind][data-k=warn]');
check('adm-dm-preset and adm-dm-kind: fill the box and select Important', (await A.inputValue('#dmmsg')) === 'Come and see me' && await A.evaluate(() => document.querySelector('#layer [data-act=adm-dm-kind][data-k=warn]').classList.contains('on')));
await tap(A, '#layer [data-act=adm-dm]');
check('adm-dm: only that phone shows the message', await ctlIs(c => c.dm && c.dm[id2] && c.dm[id2].t === 'Come and see me') && await until(async () => await V2.isVisible('#bcast.warn') && !(await V1.$('#bcast')), 25000));
await tap(V2, '[data-act=bcast-ok]');
await A.waitForSelector('#layer [data-act=adm-dm-clear]'); await tap(A, '#layer [data-act=adm-dm-clear]');
check('adm-dm-clear: removes the stored message', await ctlIs(c => c.dm === undefined));
await tap(A, '#layer [data-act=adm-hide]');
check('adm-hide: hides the phone from the lists (it moves to "Hidden phones")', await ctlIs(c => c.gone === id2) && await until(async () => /Hidden phones \(1\)/.test(await A.innerText('#adm-live')), 15000));
await tap(A, '#layer [data-act=modal-close]');
await A.locator('#adm-hidden [data-act=adm-phone]').click(); await A.waitForSelector('#layer [data-act=adm-hide]'); await tap(A, '#layer [data-act=adm-hide]');
check('adm-hide (again, from Hidden phones): shows it again', await ctlIs(c => c.gone === undefined));
await tap(A, '#layer [data-act=modal-close]');
// undo
await tap(A, '[data-act=adm-mode][data-m=rush]'); await ctlIs(c => c.mem === false);
await tap(A, '[data-act=adm-undo]');
check('adm-undo: puts the last change (Rush hour) back in one go', await ctlIs(c => c.mem === true && c.hot === 70 && c.retries === 1));
check('The change list shows what was done', /Undid: Rush hour mode on/.test(await A.innerText('#adm-log')));
// reports
await tap(A, '[data-act=adm-copy]'); await wait(400);
const rep = IS_CHROMIUM ? await A.evaluate(() => navigator.clipboard.readText()) : ''; if (await A.$('#layer .sheet')) await closeSheet(A);
check('adm-copy: copies the admin report', IS_CHROMIUM ? /ADMIN REPORT/.test(rep) : true);
await tap(A, '[data-act=adm-csv]'); await wait(400);
const csv = IS_CHROMIUM ? await A.evaluate(() => navigator.clipboard.readText()) : ''; if (await A.$('#layer .sheet')) await closeSheet(A);
check('adm-csv: copies the phone table', IS_CHROMIUM ? /^phone,customers/.test(csv) && /TOTAL,/.test(csv) : true);
await tap(A, '[data-act=back-home]'); await A.waitForSelector('[data-act=next]');
await tap(A, '[data-act=summary]'); await A.waitForSelector('#stats');
check('The organiser Summary has the volunteer controls plus "Organiser console" (admin-open)', !!(await A.$('[data-act="stock+"]')) && !!(await A.$('[data-act=admin-open]')) && !!(await A.$('[data-hold]')));
await tap(A, '[data-act=back-home]');
// refresh all phones
await V1.evaluate(() => { window.__mark = 1; }); await V2.evaluate(() => { window.__mark = 1; });
await tap(A, '[data-act=admin-open]'); await tap(A, '[data-act=adm-refresh]');
check('adm-refresh: asks first (nothing is sent yet)', !!(await A.$('#layer [data-act=adm-refresh-yes]')) && !((await ctlNow()) || {}).rl);
await tap(A, '#layer [data-act=adm-refresh-yes]');
check('adm-refresh-yes: every idle volunteer phone reloads itself', await ctlIs(c => typeof c.rl === 'string') && await until(async () => (await V1.evaluate(() => window.__mark)) !== 1 && !!(await V1.$('[data-act=next]')) && (await V2.evaluate(() => window.__mark)) !== 1 && !!(await V2.$('[data-act=next]')), 40000));
await wait(1500);                                              // both phones are back on Home before the next step
await tap(A, '[data-act=back-home]');

/* ===== the hold-to-reset gesture and reset-yes ===== */
await V2.waitForSelector('[data-act=summary]'); await tap(V2, '[data-act=summary]'); await V2.waitForSelector('[data-hold]');
const servedBefore = (await st(V1)).c.served + (await st(V2)).c.served;
await holdReset(V2); await V2.waitForSelector('#layer [data-act=reset-yes]');
check('Holding Reset for 2 seconds asks "Reset ALL phones?" with the numbers', /Reset ALL phones/.test(await V2.innerText('#layer .sheet')));
await tap(V2, '#layer [data-act=reset-yes]');
check('reset-yes: every phone is back to zero customers and full food', await until(async () => (await Promise.all([A, V1, V2].map(p => p.evaluate(() => CC.totals().c.customers + CC.totals().c.served)))).every(v => v === 0), 30000) && servedBefore >= 1);
check('...and the organiser\'s settings survive the reset', ((await ctlNow()) || {}).rev > 0);

/* ===== coverage ===== */
const taps = {};
for (const p of pages) { const o = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__acts') || '{}')).catch(() => ({})); for (const k in o) taps[k] = (taps[k] || 0) + o[k]; }
const missing = ALL.filter(a => !taps[a]);
console.log(`\nButtons tapped: ${ALL.length - missing.length} of ${ALL.length} actions (${Object.values(taps).reduce((a, b) => a + b, 0)} taps in total)`);
check(`EVERY button action in the code was tapped at least once (${ALL.length} of ${ALL.length})`, missing.length === 0, missing.length ? 'never tapped: ' + missing.join(', ') : '');
const unknown = Object.keys(taps).filter(a => !ALL.includes(a));
check('Every tapped button is a known action (no stray or misspelled button)', unknown.length === 0, unknown.join(', '));
const errs = pages.flatMap(p => p.errors).filter(e => !NOISE.test(e)), rej = (await Promise.all(pages.map(p => p.evaluate(() => window.__rej || []).catch(() => [])))).flat();
check(`No JavaScript errors on any of the ${pages.length} phones`, errs.length === 0, errs.slice(0, 3).join(' | '));
check('No unhandled promise rejections', rej.length === 0, rej.slice(0, 3).join(' | '));

/* ---------- clean up ---------- */
for (const p of pages) await p.ctx.close().catch(() => {});
if (LIVE) {
  for (const team of [TEAM, TEAM2]) {
    const eps = (await rest('GET', `events/${team}/epochs`)) || {};
    for (const ep of Object.keys(eps)) for (const id of Object.keys((await rest('GET', `events/${team}/epochs/${ep}/devices`)) || {})) await rest('DELETE', `events/${team}/epochs/${ep}/devices/${id}`);
  for (const ep of Object.keys(eps)) for (const k of Object.keys((await rest('GET', `events/${team}/epochs/${ep}/claims`)) || {})) await rest('DELETE', `events/${team}/epochs/${ep}/claims/${k}`);
    for (const n of ['ctl', 'meta', 'admin']) await rest('DELETE', `events/${team}/${n}`);
  }
  check('Everything the test wrote to the real database was removed again', (await rest('GET', `events/${TEAM}`)) === null && (await rest('GET', `events/${TEAM2}`)) === null);
}
await browser.close(); if (web) web.close(); if (mock) await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} button checks passed (${process.env.BROWSER || 'chromium'}${LIVE ? ' on ' + BASE : ''})`);
process.exit(failed.length ? 1 : 0);
