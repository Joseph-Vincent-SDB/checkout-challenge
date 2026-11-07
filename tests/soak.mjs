// Soak test: several emulated phones run random customers for a few minutes against a deployed copy
// of the app and a REAL database, with random offline blips, refreshes, app-switching and settings taps.
// At the end every phone, and the database, must agree exactly, with no errors.
//   BASE_URL=https://.../ SYNC_URL=https://<db>.firebasedatabase.app DURATION_S=240 PHONES=5 node soak.mjs
//   ADMIN_KEY_FILE=path/to/ADMIN-KEY.private adds an organiser phone that also sends messages, pauses, locks and changes settings at random
import { chromium, webkit, firefox, devices } from 'playwright';
const ENGINE = { chromium, webkit, firefox }[process.env.BROWSER || 'chromium'];   // BROWSER=webkit runs the Safari engine
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
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
const launchChromium = () => chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const MIX = process.env.MIX === '1';
const browser = MIX ? await launchChromium() : await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const browserWk = MIX ? await webkit.launch() : null;
const STOCK = +process.env.STOCK || 0;
if (STOCK) await fetch(`${DB}/events/${TEAM}/meta.json?print=silent`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ epoch: 'e0', startStock: STOCK, resetAt: { '.sv': 'timestamp' }, by: 'soak' }) });
const ADMIN_KEY = process.env.ADMIN_KEY_FILE ? fs.readFileSync(process.env.ADMIN_KEY_FILE, 'utf8').split('\n')[0].trim() : '';
const phones = [];
for (let i = 0; i < N + (ADMIN_KEY ? 1 : 0); i++) {
  const isAdm = !!ADMIN_KEY && i === N;
  const useWk = MIX && i % 2 === 1 && !isAdm; const ctx = await (useWk ? browserWk : browser).newContext({ ...D });
  const page = await ctx.newPage(); page.ctx = ctx; page.i = i; page.engine = useWk ? 'webkit' : 'chromium'; page.errors = []; page.transient = 0; page.dbReqs = 0; page.stats = { customers: 0, offline: 0, reloads: 0, hidden: 0, summary: 0, cancelled: 0, skipped: 0 };
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Access-Control|Failed to fetch|Load failed/.test(m.text())) page.errors.push('console: ' + m.text()); });
  page.on('request', r => { if (r.url().startsWith(DB)) page.dbReqs++; });
  page.admin = isAdm;
  await page.goto(BASE + '#t=' + TEAM + (isAdm ? '&a=' + ADMIN_KEY : '')); await page.waitForSelector('#app *');
  if (isAdm) await page.waitForFunction(() => CC.state().admin === true, null, { timeout: 15000 });
  else await page.evaluate(i => { CC.state().label = 'Soak ' + (i + 1); CC.commit(); }, i);
  phones.push(page);
}
console.log(`Team ${TEAM}: ${N} phones on ${BASE} for ${DURATION / 1000}s`);
const heap = async p => p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0)).catch(() => 0);
const storeSize = async p => p.evaluate(() => { try { return (localStorage.getItem('ecomsoc-checkout-challenge-v1') || '').length; } catch (e) { return 0; } }).catch(() => 0);
const heap0 = await Promise.all(phones.map(heap));
const t0 = Date.now(), deadline = t0 + DURATION;

async function tapq(p, sel) {
  await sleep(330);
  if (await p.$('#bcast')) { await p.click('[data-act=bcast-ok]', { timeout: 3000 }).catch(() => {}); await sleep(350); }   // an organiser message sits on top until dismissed
  await p.click(sel, { timeout: 4000 });
}
async function customer(p) {
  for (let step = 0; step < 60 && Date.now() < deadline + 20000; step++) {
    const s = await p.evaluate(() => ({ cur: CC.state().cur, home: !!document.querySelector('[data-act=next]'), back: !!document.querySelector('[data-act=back-home]') }));
    const cu = s.cur;
    if (!cu) {
      if (s.home && step === 0) {
        if (await p.$('[data-act=next][disabled]')) { p.stats.paused = (p.stats.paused || 0) + 1; await sleep(rnd(1500, 3000)); return; }    // the organiser paused the stall
        await tapq(p, '[data-act=next]'); p.stats.customers++; continue;
      }
      if (s.home) return;
      if (s.back) { await tapq(p, '[data-act=back-home]'); continue; }
      await sleep(400); continue;
    }
    if (cu.step === 'follow') { await tapq(p, Math.random() < 0.3 ? '[data-act=follow-already]' : '[data-act=follow-new]'); }
    else if (cu.step === 'member') { await tapq(p, Math.random() < 0.3 ? '[data-act=member-already]' : '[data-act=member-new]'); }
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
  if (Math.random() < 0.5 && (await p.$('[data-act="stock+"]'))) { await tapq(p, Math.random() < 0.5 ? '[data-act="stock+"]' : '[data-act="stock-"]'); }   // not there while the organiser has locked settings
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
async function adminWorker(p) {
  await sleep(rnd(2000, 5000));
  const onConsole = async () => { if (!(await p.$('#adm-live'))) { if (await p.$('[data-act=back-home]')) await tapq(p, '[data-act=back-home]').catch(() => {}); if (await p.$('[data-act=admin-open]')) await tapq(p, '[data-act=admin-open]'); await p.waitForSelector('#adm-live', { timeout: 4000 }); } };
  const msgs = ['Only 10 serves left', 'Short break, back soon', 'Please check your bar is green', 'We are back open, thanks!', 'Last customers please'];
  while (Date.now() < deadline) {
    const r = Math.random(); p.stats.adminActs = (p.stats.adminActs || 0) + 1;
    try {
      if (r < 0.40) {                                  // run customers like a host, so the admin phone's tallies are part of the totals
        if (await p.$('#adm-live')) await tapq(p, '[data-act=back-home]');
        await customer(p);
      } else {
        await onConsole(); const a = Math.random();
        if (a < 0.22) { await p.fill('#bmsg', msgs[Math.floor(Math.random() * msgs.length)]); if (Math.random() < 0.4) await tapq(p, '[data-act=adm-kind][data-k=warn]'); await tapq(p, '[data-act=adm-send]'); p.stats.msgs = (p.stats.msgs || 0) + 1; }
        else if (a < 0.30) { await tapq(p, '[data-act=adm-clear]').catch(() => {}); }
        else if (a < 0.46) { await tapq(p, '[data-act=adm-pause]'); p.stats.pauses = (p.stats.pauses || 0) + 1; await sleep(rnd(4000, 9000)); await onConsole(); const on = await p.getAttribute('[data-act=adm-pause]', 'aria-pressed'); if (on === 'true') await tapq(p, '[data-act=adm-pause]'); }
        else if (a < 0.58) { await tapq(p, '[data-act=adm-lock]'); p.stats.locks = (p.stats.locks || 0) + 1; await sleep(rnd(3000, 7000)); await onConsole(); const on = await p.getAttribute('[data-act=adm-lock]', 'aria-pressed'); if (on === 'true') await tapq(p, '[data-act=adm-lock]'); }
        else if (a < 0.70) { await tapq(p, '[data-act=adm-mem]'); p.stats.memToggles = (p.stats.memToggles || 0) + 1; }
        else if (a < 0.80) { await tapq(p, Math.random() < 0.5 ? '[data-act="adm-hot+"]' : '[data-act="adm-hot-"]'); }
        else if (a < 0.88) { await tapq(p, Math.random() < 0.5 ? '[data-act="adm-ret+"]' : '[data-act="adm-ret-"]'); }
        else if (a < 0.94) { await tapq(p, '[data-act=adm-copy]'); await sleep(500); if (await p.$('.sheet')) await tapq(p, '[data-act=modal-close]'); }
        else { await tapq(p, '[data-act=back-home]'); await tapq(p, '[data-act=summary]'); await p.waitForSelector('#phones', { timeout: 4000 }); await sleep(rnd(800, 2000)); await tapq(p, '[data-act=back-home]'); }
      }
    } catch (e) { p.transient++; try { await p.ctx.setOffline(false); } catch (e2) {} }
    await sleep(rnd(1200, 4000));
  }
}
// progress line every 20 s
const ticker = setInterval(async () => {
  try { const row = await Promise.all(phones.map(p => p.evaluate(() => `${CC.remaining()}${CC.syncState() === 'ok' ? '' : '!'}/u${CC.unsent()}`).catch(() => '?'))); console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s remaining/unsent per phone: ${row.join('  ')}`); } catch (e) {}
}, 20000);
await Promise.all(phones.map(p => p.admin ? adminWorker(p) : worker(p)));
clearInterval(ticker);

const heap1 = await Promise.all(phones.map(heap)), store1 = await Promise.all(phones.map(storeSize));
/* ---------- settle: everyone online and visible, then compare ---------- */
if (ADMIN_KEY) { const adm = phones.find(p => p.admin); await adm.evaluate(() => CC.adminSet({ paused: false, locked: false, mem: true, hot: 70, retries: 1, msg: null })); await sleep(1500); }
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
if (ADMIN_KEY) {
  const adm = phones.find(p => p.admin), vols = phones.filter(p => !p.admin);
  await sleep(6000);
  const dbCtl = await rest('GET', `events/${TEAM}/ctl`);
  check('Organiser settings in the database are back to normal (not paused, not locked, membership on)', dbCtl && dbCtl.paused === false && dbCtl.locked === false && dbCtl.mem === true && !dbCtl.msg, JSON.stringify(dbCtl));
  const cs = await Promise.all(phones.map(p => p.evaluate(() => { const c = CC.state().ctl; return c ? { rev: c.rev, paused: c.paused, locked: c.locked, mem: c.mem, hot: c.hot, retries: c.retries, msg: !!c.msg } : null; })));
  check('Every phone holds exactly the settings that are in the database', cs.every(c => c && dbCtl && c.rev === dbCtl.rev && c.paused === dbCtl.paused && c.locked === dbCtl.locked && c.mem === dbCtl.mem && c.hot === dbCtl.hot && c.retries === dbCtl.retries && c.msg === false), JSON.stringify(cs));
  const first = await Promise.all(vols.map(p => p.evaluate(() => { const r = CC.teamPhones()[0]; return { admin: !!r.admin, name: r.name, state: r.state }; })));
  check('The organiser phone is the first row on every volunteer phone, with no online or last-seen information', first.every(r => r.admin && r.name === "Joseph's Phone (Admin)" && r.state === ''), JSON.stringify(first));
  const admRec = await rest('GET', `events/${TEAM}/admin`);
  check('The organiser record in the database is intact (id, fixed name, heartbeat)', admRec && admRec.id === (await adm.evaluate(() => CC.state().id)) && admRec.l === "Joseph's Phone (Admin)" && typeof admRec.hb === 'number', JSON.stringify(admRec));
  const tl = await Promise.all(phones.map(p => p.evaluate(() => document.querySelector('#livegrid') ? document.querySelector('#livegrid').innerText.replace(/\s+/g, ' ') : '(not on Home)')));
  console.log('  live numbers per phone: ' + tl.join(' || '));
}
const over = Math.max(0, -expectedRem);
check('Food never over-served by more than 2 (two-phone tap race at the very end only)', over <= 2, `remaining=${expectedRem}`);
check('No JavaScript errors on any phone', phones.every(p => p.errors.length === 0), phones.flatMap(p => p.errors.map(e => `phone${p.i + 1}: ${e}`)).join(' | '));
const growth = heap1.map((h, i) => h0Safe(heap0[i], h));
function h0Safe(a, b) { return a && b ? b / a : 0; }
check('Memory does not grow without limit (JS heap at the end is under 4x the start, Chromium phones)', growth.every(g => g === 0 || g < 4), growth.map(g => g ? g.toFixed(2) + 'x' : 'n/a').join(', ') + ' | heap MB: ' + heap1.map(h => h ? (h / 1048576).toFixed(1) : 'n/a').join(', '));
check('Saved data on each phone stays small (under 20 KB)', store1.every(s => s < 20000), store1.join(', ') + ' chars');
const secs = (Date.now() - t0) / 1000;
const rates = phones.map(p => p.dbReqs / secs);
check('Network use is gentle: under 1.6 requests per second per phone on average', rates.every(r => r < 1.6), rates.map(r => r.toFixed(2)).join(', '));
console.log('\nPer phone: ' + phones.map(p => `#${p.i + 1} (${p.engine}) customers=${snap[p.i].c.customers} served=${snap[p.i].c.served} retries=${snap[p.i].c.retries} skips=${snap[p.i].c.skips} offlineBlips=${p.stats.offline} hidden=${p.stats.hidden} reloads=${p.stats.reloads} cancelled=${p.stats.cancelled} transientHiccups=${p.transient}`).join('\n          '));
console.log(`Totals: customers=${sum.customers} served=${sum.served} correct=${sum.correct} wrong=${sum.wrong} skips=${sum.skips} food left=${expectedRem}`);

/* ---------- clean up ---------- */
for (const ep of Object.keys((await rest('GET', `events/${TEAM}/epochs`)) || {})) for (const id of Object.keys((await rest('GET', `events/${TEAM}/epochs/${ep}/devices`)) || {})) await fetch(`${DB}/events/${TEAM}/epochs/${ep}/devices/${id}.json`, { method: 'DELETE' });
await fetch(`${DB}/events/${TEAM}/meta.json`, { method: 'DELETE' }); await fetch(`${DB}/events/${TEAM}/ctl.json`, { method: 'DELETE' }); await fetch(`${DB}/events/${TEAM}/admin.json`, { method: 'DELETE' });
for (const p of phones) await p.ctx.close().catch(() => {});
await browser.close(); if (browserWk) await browserWk.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} soak checks passed`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-soak-run.json'), JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, sum, expectedRem }, null, 2));
process.exit(failed.length ? 1 : 0);
