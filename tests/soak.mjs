// Soak test: several emulated phones run random customers for a few minutes against a deployed copy
// of the app and a REAL database, with random offline blips, refreshes, app-switching and settings taps.
// At the end every phone, and the database, must agree exactly, with no errors.
//   BASE_URL=https://.../ SYNC_URL=https://<db>.firebasedatabase.app DURATION_S=240 PHONES=5 node soak.mjs
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL, DB = (process.env.SYNC_URL || '').replace(/\/+$/, '');
if (!BASE || !DB) { console.error('Set BASE_URL and SYNC_URL'); process.exit(2); }
const DURATION = (+process.env.DURATION_S || 240) * 1000, N = +process.env.PHONES || 5;
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); }
const rest = async (m, p) => { const r = await fetch(`${DB}/${p}.json`, { method: m }); return r.status === 200 ? r.json() : null; };

const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const browser = await chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const phones = [];
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ ...D });
  const page = await ctx.newPage(); page.ctx = ctx; page.i = i; page.errors = []; page.transient = 0; page.dbReqs = 0; page.stats = { customers: 0, offline: 0, reloads: 0, hidden: 0, summary: 0, cancelled: 0, skipped: 0 };
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed/.test(m.text())) page.errors.push('console: ' + m.text()); });
  page.on('request', r => { if (r.url().startsWith(DB)) page.dbReqs++; });
  await page.goto(BASE + '#t=' + TEAM); await page.waitForSelector('#app *');
  await page.evaluate(i => { CC.state().label = 'Soak ' + (i + 1); CC.commit(); }, i);
  phones.push(page);
}
console.log(`Team ${TEAM}: ${N} phones on ${BASE} for ${DURATION / 1000}s`);
const t0 = Date.now(), deadline = t0 + DURATION;

async function tapq(p, sel) { await sleep(330); await p.click(sel, { timeout: 4000 }); }
async function customer(p) {
  for (let step = 0; step < 60 && Date.now() < deadline + 20000; step++) {
    const s = await p.evaluate(() => ({ cur: CC.state().cur, home: !!document.querySelector('[data-act=next]'), back: !!document.querySelector('[data-act=back-home]') }));
    const cu = s.cur;
    if (!cu) {
      if (s.home && step === 0) { await tapq(p, '[data-act=next]'); p.stats.customers++; continue; }
      if (s.home) return;
      if (s.back) { await tapq(p, '[data-act=back-home]'); continue; }
      await sleep(400); continue;
    }
    if (cu.step === 'follow') { await tapq(p, Math.random() < 0.3 ? '[data-act=follow-already]' : '[data-act=follow-new]'); }
    else if (cu.step === 'reveal') { await tapq(p, '[data-act=reveal]'); }
    else if (cu.step === 'drop') { await sleep(500); }
    else if (cu.step === 'question') {
      await sleep(rnd(500, 1500));
      const r = Math.random();
      if (r < 0.07) { await tapq(p, '[data-act=cancel]'); await tapq(p, '[data-act=cancel-yes]'); p.stats.cancelled++; return; }
      if (r < 0.14) { await tapq(p, '[data-act=skip]'); p.stats.skipped++; continue; }
      const q = await p.evaluate(id => CC.QUESTIONS.find(x => x.id === id), cu.qid);
      const letters = ['A', 'B', 'C', 'D'];
      const pick = Math.random() < 0.65 ? q.answer : letters.find(l => l !== q.answer);
      await p.click(`.ans[data-k=${pick}]`, { timeout: 4000 });
    }
    else if (cu.step === 'result') {
      await sleep(rnd(300, 900));
      if (await p.$('#servebtn')) { await tapq(p, '#servebtn'); await sleep(500); }
      else if (await p.$('[data-act=retry]')) { await tapq(p, Math.random() < 0.75 ? '[data-act=retry]' : '[data-act=end-lost]'); }
      else if (await p.$('[data-act=done]')) { await tapq(p, '[data-act=done]'); }
      else await sleep(400);
    }
  }
}
async function blip(p) { p.stats.offline++; await p.ctx.setOffline(true); await sleep(rnd(5000, 14000)); await p.ctx.setOffline(false); }
async function hiddenBlip(p) {
  p.stats.hidden++;
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(rnd(3000, 9000));
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
}
async function summaryPeek(p) {
  p.stats.summary++;
  if (!(await p.$('[data-act=next]'))) return;
  await tapq(p, '[data-act=summary]'); await p.waitForSelector('#stats', { timeout: 4000 });
  if (Math.random() < 0.5) { await tapq(p, Math.random() < 0.5 ? '[data-act="stock+"]' : '[data-act="stock-"]'); }
  await sleep(rnd(800, 2500)); await tapq(p, '[data-act=back-home]');
}
async function worker(p) {
  await sleep(rnd(0, 3000));
  while (Date.now() < deadline) {
    const r = Math.random();
    try {
      if (r < 0.05) await blip(p);
      else if (r < 0.09) await hiddenBlip(p);
      else if (r < 0.13) { p.stats.reloads++; await p.reload(); await p.waitForSelector('#app *'); }
      else if (r < 0.17) await summaryPeek(p);
      else await customer(p);
    } catch (e) { p.transient++; try { await p.ctx.setOffline(false); } catch (e2) {} }
    await sleep(rnd(300, 2000));
  }
}
// progress line every 20 s
const ticker = setInterval(async () => {
  try { const row = await Promise.all(phones.map(p => p.evaluate(() => `${CC.remaining()}${CC.syncState() === 'ok' ? '' : '!'}/u${CC.unsent()}`).catch(() => '?'))); console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s remaining/unsent per phone: ${row.join('  ')}`); } catch (e) {}
}, 20000);
await Promise.all(phones.map(worker));
clearInterval(ticker);

/* ---------- settle: everyone online and visible, then compare ---------- */
for (const p of phones) { await p.ctx.setOffline(false); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); }
const settled = async () => { for (let k = 0; k < 60; k++) { const st = await Promise.all(phones.map(p => p.evaluate(() => [CC.syncState(), CC.unsent()]))); if (st.every(([s, u]) => s === 'ok' && u === 0)) return true; await sleep(500); } return false; };
check('After the soak every phone is connected with nothing left unsent', await settled());
await sleep(6000);                                  // let a couple of polls land everywhere

const snap = await Promise.all(phones.map(p => p.evaluate(() => { const S = CC.state(); return { id: S.id, c: JSON.parse(JSON.stringify(S.c)), adj: S.adj, startStock: S.startStock, epoch: S.epoch, totals: CC.totals().c, rem: CC.remaining(), state: CC.syncState() }; })));
const meta = await rest('GET', `events/${TEAM}/meta`);
const cloud = (await rest('GET', `events/${TEAM}/epochs/${meta ? meta.epoch : 'e0'}/devices`)) || {};
const keys = Object.keys(snap[0].c);
const sum = {}; keys.forEach(k => sum[k] = snap.reduce((a, s) => a + s.c[k], 0));
const adjSum = snap.reduce((a, s) => a + s.adj, 0);
const expectedRem = (meta ? meta.startStock : 80) + adjSum - sum.served;

check('Database has a record for every phone', snap.every(s => cloud[s.id]), `phones=${snap.length} records=${Object.keys(cloud).length}`);
check('Every phone\'s record in the database equals what the phone counted itself', snap.every(s => cloud[s.id] && keys.every(k => cloud[s.id].c[k] === s.c[k]) && (cloud[s.id].adj || 0) === s.adj), snap.filter(s => !(cloud[s.id] && keys.every(k => cloud[s.id].c[k] === s.c[k]))).map(s => s.id).join(','));
check('Every phone shows identical totals for every counter', snap.every(s => keys.every(k => s.totals[k] === sum[k])), JSON.stringify(sum));
check(`Every phone shows the same food left (${expectedRem}), equal to total - serves + adjustments`, snap.every(s => s.rem === expectedRem), snap.map(s => s.rem).join(','));
check('Database totals equal the sum of the phones', keys.every(k => Object.values(cloud).reduce((a, d) => a + d.c[k], 0) === sum[k]));
check('Each phone\'s own tallies are internally consistent (won = correct, hot + full = answers, served <= won)', snap.every(s => s.c.won === s.c.correct && s.c.hot + s.c.full === s.c.correct + s.c.wrong && s.c.served <= s.c.won && s.c.customers === s.c.follows + s.c.already));
const over = Math.max(0, -expectedRem);
check('Food never over-served by more than 2 (two-phone tap race at the very end only)', over <= 2, `remaining=${expectedRem}`);
check('No JavaScript errors on any phone', phones.every(p => p.errors.length === 0), phones.flatMap(p => p.errors.map(e => `phone${p.i + 1}: ${e}`)).join(' | '));
const secs = (Date.now() - t0) / 1000;
const rates = phones.map(p => p.dbReqs / secs);
check('Network use is gentle: under 1.6 requests per second per phone on average', rates.every(r => r < 1.6), rates.map(r => r.toFixed(2)).join(', '));
console.log('\nPer phone: ' + phones.map(p => `#${p.i + 1} customers=${snap[p.i].c.customers} served=${snap[p.i].c.served} retries=${snap[p.i].c.retries} skips=${snap[p.i].c.skips} offlineBlips=${p.stats.offline} hidden=${p.stats.hidden} reloads=${p.stats.reloads} cancelled=${p.stats.cancelled} transientHiccups=${p.transient}`).join('\n          '));
console.log(`Totals: customers=${sum.customers} served=${sum.served} correct=${sum.correct} wrong=${sum.wrong} skips=${sum.skips} food left=${expectedRem}`);

/* ---------- clean up ---------- */
for (const ep of Object.keys((await rest('GET', `events/${TEAM}/epochs`)) || {})) for (const id of Object.keys((await rest('GET', `events/${TEAM}/epochs/${ep}/devices`)) || {})) await fetch(`${DB}/events/${TEAM}/epochs/${ep}/devices/${id}.json`, { method: 'DELETE' });
await fetch(`${DB}/events/${TEAM}/meta.json`, { method: 'DELETE' });
for (const p of phones) await p.ctx.close().catch(() => {});
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} soak checks passed`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-soak-run.json'), JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, sum, expectedRem }, null, 2));
process.exit(failed.length ? 1 : 0);
