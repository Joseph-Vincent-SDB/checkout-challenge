// In-place upgrade test: phones that already run an OLD build of the app (with their saved state: joined team, name, tallies, organiser status)
// are upgraded to the CURRENT build while they stay open, the way a phone upgrades in real life (the service worker fetches the new files and the app reloads
// itself when idle). Afterwards every phone must still be on its team, keep its name and tallies, appear for the other phones, and sync both ways.
//   OLD_COMMIT=009b9f1 node upgrade.mjs        (default: the commit before the newer organiser controls; BROWSER=webkit for Safari's engine)
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-rtdb.mjs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = process.env.OLD_COMMIT || '009b9f1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upgrade-'));
const FILES = ['index.html', 'sw.js', 'qr.js', 'manifest.webmanifest', 'logo.jpg'];
const putFiles = from => {                                   // from: 'old' (git) or 'new' (working copy)
  for (const f of FILES) {
    if (from === 'old') fs.writeFileSync(path.join(TMP, f), execFileSync('git', ['show', `${OLD}:${f}`], { cwd: ROOT, maxBuffer: 1 << 26 }));
    else fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
  }
  fs.mkdirSync(path.join(TMP, 'icons'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(TMP, 'icons', f));
};
putFiles('old');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(TMP, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': /index\.html$|sw\.js$/.test(f) ? 'no-cache' : 'public, max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}/`;
const mock = await startMock();
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(200); } return false; };
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rc = n => Array.from({ length: n }, () => chars[crypto.randomInt(32)]).join('');
const TEAM = rc(8), KEY = rc(24), HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const phones = [];
async function phone(label, url) {
  const ctx = await browser.newContext(D);
  await ctx.addInitScript(([k, u, hk, h]) => { try { localStorage.setItem(k, u); localStorage.setItem(hk, h); } catch (e) {} }, ['ecomsoc-sync-url', mock.url, 'ecomsoc-admin-hash', HASH]);
  const page = await ctx.newPage(); page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(BASE + url); await page.waitForSelector('#app *');
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('#app *');                      // a phone that has been used before: the app is already controlled by its service worker
  if (label) await page.evaluate(l => { const s = window.CC.state(); s.label = l; window.CC.commit(); }, label);
  phones.push(page); return page;
}
const devs = () => { const m = mock.get(['events', TEAM, 'meta']) || {}; return mock.get(['events', TEAM, 'epochs', m.epoch || 'e0', 'devices']) || {}; };
const isNew = p => p.evaluate(() => typeof window.CC.APP_LEVEL === 'number' && window.CC.APP_LEVEL >= 4);
const S = p => p.evaluate(() => window.CC.state());
const tap = async (p, sel) => { await p.waitForSelector(sel, { state: 'visible', timeout: 15000 }); await wait(340); await p.click(sel); };

console.log(`Upgrading phones that run the build from ${OLD} to the current build, while they stay open (${process.env.BROWSER || 'chromium'})\n`);
/* ----- phones running the OLD build ----- */
const H = await phone('', '#t=' + TEAM + '&a=' + KEY);                       // an organiser phone (normal admin link)
const V = await phone('Volunteer old', '#t=' + TEAM);
check('The old build is really what is running (no newer organiser controls in it)', !(await isNew(H)) && !(await isNew(V)));
await until(async () => (await Promise.all([H, V].map(p => p.evaluate(() => window.CC.syncState())))).every(s => s === 'ok'), 20000);
// a customer served on the volunteer phone, so there are tallies to keep
await V.evaluate(() => { const s = window.CC.state(); s.c.customers = 3; s.c.served = 2; s.c.won = 2; s.c.correct = 2; s.c.hot = 3; s.c.follows = 3; window.CC.commit(); });
await until(async () => Object.values(devs()).some(d => d.c.served === 2), 15000);
const before = { H: await S(H), V: await S(V) };
check('Before: both old phones are on the team, the organiser phone is an admin with the fixed name, the volunteer has its tallies', before.H.team === TEAM && before.H.admin === true && /Admin/.test(before.H.label) && before.V.c.served === 2 && before.V.label === 'Volunteer old', JSON.stringify({ hAdmin: before.H.admin, hLabel: before.H.label, vServed: before.V.c.served }));
check('Before: their database records say app level 2 (the old build)', Object.values(devs()).every(d => d.app === 2 || d.app === undefined));

/* ----- release the CURRENT build; the open phones pick it up by themselves ----- */
putFiles('new');
await Promise.all([H, V].map(p => p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()))));      // what the browser does when it next looks for an update
const upgraded = await until(async () => (await Promise.all([H, V].map(isNew))).every(Boolean), 40000);
check('Both open phones switch to the new build by themselves (installed in the background, reloaded when idle on Home)', upgraded);
if (!upgraded) { for (const p of [H, V]) { await p.reload(); await p.waitForSelector('#app *'); } }                // (a phone that does not get there by itself is reopened, to see what happens next)
await until(async () => (await Promise.all([H, V].map(p => p.evaluate(() => window.CC.syncState())))).every(s => s === 'ok'), 25000);
const after = { H: await S(H), V: await S(V) };
check('After: still on the same team, same phone identity, name and tallies kept (nothing lost in the upgrade)', after.H.team === TEAM && after.V.team === TEAM && after.H.id === before.H.id && after.V.id === before.V.id && after.V.label === 'Volunteer old' && after.V.c.served === 2 && after.V.c.customers === 3, JSON.stringify({ team: after.V.team === TEAM, sameId: after.V.id === before.V.id, served: after.V.c.served }));
check('After: the organiser phone is still an admin with its console', after.H.admin === true && await H.isVisible('[data-act=admin-open]'));
check('After: both phones now write the new app level to the database and are still listed', await until(async () => { const d = Object.values(devs()); return d.length >= 2 && d.every(x => x.app >= 4); }, 20000), JSON.stringify(Object.values(devs()).map(d => d.app)));
/* ----- they must see each other, both ways ----- */
const names = async p => p.evaluate(() => window.CC.teamPhones().map(r => r.name));
check('The volunteer phone lists the organiser phone and itself', await until(async () => { const n = await names(V); return n.length >= 2 && n.some(x => /Admin/.test(x)) && n.includes('Volunteer old'); }, 25000), JSON.stringify(await names(V)));
check('The organiser phone lists the volunteer phone and itself', await until(async () => { const n = await names(H); return n.length >= 2 && n.includes('Volunteer old'); }, 25000), JSON.stringify(await names(H)));
/* ----- a NEW phone joining after the upgrade sees them and is seen ----- */
const N = await phone('New phone', '#t=' + TEAM);
check('A brand new phone that joins after the upgrade sees both older phones, and both see it', await until(async () => { const [a, b, c] = await Promise.all([names(N), names(V), names(H)]); return a.includes('Volunteer old') && a.some(x => /Admin/.test(x)) && b.includes('New phone') && c.includes('New phone'); }, 30000));
/* ----- food counts agree and serving works across old and new phones ----- */
await tap(N, '[data-act=next]'); await tap(N, '[data-act=follow-new]'); await N.waitForSelector('[data-act=member-new], [data-act=reveal]'); if (await N.$('[data-act=member-new]')) await tap(N, '[data-act=member-new]'); await tap(N, '[data-act=reveal]'); await N.waitForSelector('.ans[data-act=answer]'); await wait(450);
const q = await N.evaluate(() => window.CC.QUESTIONS.find(x => x.id === window.CC.state().cur.qid)); await N.click(`.ans[data-k=${q.answer}]`); await tap(N, '#servebtn'); await N.waitForSelector('[data-act=next]');
check('A serve on the new phone shows on the upgraded phones and the food count is the same everywhere (80 - 2 - 1 = 77)', await until(async () => (await Promise.all([H, V, N].map(p => p.evaluate(() => window.CC.remaining())))).every(v => v === 77), 25000), JSON.stringify(await Promise.all([H, V, N].map(p => p.evaluate(() => window.CC.remaining())))));
// the organiser phone changes a setting; the upgraded volunteer phone gets it
await H.evaluate(() => window.CC.adminSet({ paused: true }));
check('An organiser setting (pause) made on the upgraded organiser phone reaches the upgraded volunteer phone', await until(async () => await V.evaluate(() => !!(window.CC.state().ctl && window.CC.state().ctl.paused)), 25000));
check('No JavaScript errors on any phone through the whole upgrade', phones.every(p => p.errors.length === 0), phones.flatMap(p => p.errors).slice(0, 3).join(' | '));
for (const p of phones) await p.ctx.close().catch(() => {});
await browser.close(); web.close(); await mock.close(); fs.rmSync(TMP, { recursive: true, force: true });
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} upgrade checks passed`); process.exit(ok === results.length ? 0 : 1);
