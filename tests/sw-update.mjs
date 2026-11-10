// Checks that a new version of the app installs fully and reloads itself, even when the web host tells
// browsers to cache files for 10 minutes (as GitHub Pages does), and never reloads in the middle of a customer.
import { chromium, webkit, firefox, devices } from 'playwright';
const ENGINE = { chromium, webkit, firefox }[process.env.BROWSER || 'chromium'];   // BROWSER=webkit runs the Safari engine
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sw-'));
for (const f of ['index.html', 'sw.js', 'qr.js', 'manifest.webmanifest', 'logo.jpg']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.cpSync(path.join(ROOT, 'icons'), path.join(TMP, 'icons'), { recursive: true });
const setMarker = (m, cache) => {
  let h = fs.readFileSync(path.join(TMP, 'index.html'), 'utf8').replace(/<!--VER:[^>]*-->/, ''); h = h.replace('<body>', `<body><!--VER:${m}-->`); fs.writeFileSync(path.join(TMP, 'index.html'), h);
  let s = fs.readFileSync(path.join(TMP, 'sw.js'), 'utf8').replace(/var CACHE = '[^']*';/, `var CACHE = '${cache}';`); fs.writeFileSync(path.join(TMP, 'sw.js'), s);
};
setMarker('A', 'test-cache-A');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(TMP, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'public, max-age=600' }); fs.createReadStream(f).pipe(res);   // like GitHub Pages
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}/`;
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(150); } return false; };

const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const ctx = await browser.newContext(D); await ctx.addInitScript(() => { try { localStorage.setItem('ecomsoc-sync-url', 'off'); localStorage.setItem('ecomsoc-update-ms', '3000'); } catch (e) {} });      // (3 seconds instead of 10 minutes, so the test does not have to wait)
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE); await page.waitForSelector('[data-act=next]');
await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForSelector('[data-act=next]');
const has = m => page.evaluate(m => document.body.innerHTML.includes('<!--VER:' + m + '-->') || document.documentElement.outerHTML.includes('VER:' + m), m);
// the served HTML keeps the comment? (comments survive in the DOM)
check('Version A is installed and running', await page.evaluate(() => document.documentElement.outerHTML.includes('VER:A')));

// ---- release version B while a customer is in the middle of a screen: it must not reload yet
await page.click('[data-act=next]'); await page.waitForSelector('[data-act=follow-new]');
setMarker('B', 'test-cache-B');
await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
const cacheB = await until(async () => (await page.evaluate(() => caches.keys())).includes('test-cache-B'), 10000);
check('New version installs its own cache', !!cacheB);
const freshInCache = await until(() => page.evaluate(async () => { const c = await caches.open('test-cache-B'); const r = await c.match('index.html'); return r ? (await r.text()).includes('VER:B') : false; }), 8000);
check('The new cache holds the NEW index.html (not a stale copy kept by the browser)', freshInCache);
await sleep(4500);
check('Mid-customer the page does NOT reload itself', await page.evaluate(() => !!document.querySelector('[data-act=follow-new]')) && await page.evaluate(() => document.documentElement.outerHTML.includes('VER:A')));
// finish the customer; once idle on Home the page updates by itself
await page.click('[data-act=back-home]'); await page.waitForSelector('[data-act=next]');
check('Once idle on Home the app reloads itself into version B', await until(async () => page.evaluate(() => document.documentElement.outerHTML.includes('VER:B')), 12000));
check('Old cache from version A is cleaned up', await until(async () => !(await page.evaluate(() => caches.keys())).includes('test-cache-A'), 5000));
// ---- version C is released while the phone just sits idle on Home: it must find, install and switch to it BY ITSELF (no tap, no reload, no manual update)
setMarker('C', 'test-cache-C');
check('A phone left idle on Home finds the new version by itself and reloads into it (nobody touches it)', await until(async () => page.evaluate(() => document.documentElement.outerHTML.includes('VER:C')), 20000));
check('...and the old copy is cleaned up again', await until(async () => !(await page.evaluate(() => caches.keys())).includes('test-cache-B'), 6000));
// a phone busy with a customer is left alone even while it keeps looking for updates
await page.click('[data-act=next]'); await page.waitForSelector('[data-act=follow-new]');
setMarker('D', 'test-cache-D');
await sleep(8000);
check('A phone in the middle of a customer finds version D in the background but does NOT reload until the customer is finished', await page.evaluate(() => !!document.querySelector('[data-act=follow-new]') && document.documentElement.outerHTML.includes('VER:C')) && (await page.evaluate(() => caches.keys())).includes('test-cache-D'));
await page.click('[data-act=back-home]'); await page.waitForSelector('[data-act=next]');
check('...then it switches to version D once idle on Home', await until(async () => page.evaluate(() => document.documentElement.outerHTML.includes('VER:D')), 12000));
// the normal setting is every 10 minutes (a second phone without the test setting)
{
  const c2 = await browser.newContext(D); await c2.addInitScript(() => { try { localStorage.setItem('ecomsoc-sync-url', 'off'); } catch (e) {} });
  const p2 = await c2.newPage(); await p2.goto(BASE); await p2.waitForSelector('[data-act=next]');
  check('Normally a phone looks for a newer copy every 10 minutes, when the app is open and when it comes back to the app', (await p2.evaluate(() => CC.updateMs())) === 600000 && (await p2.evaluate(() => typeof CC.checkUpdate)) === 'function');
  await c2.close();
}
// offline still works on the new version
await ctx.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-act=next]', { timeout: 6000 });
check('New version opens with no network', true); await ctx.setOffline(false);
check('No JavaScript errors', errors.length === 0, errors.join(' | '));
await browser.close(); web.close(); fs.rmSync(TMP, { recursive: true, force: true });
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} update checks passed`); process.exit(ok === results.length ? 0 : 1);
