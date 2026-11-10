// Real-team join check: opens the volunteer link of YOUR real team on the deployed site with a fresh phone, the way a volunteer would, and confirms
//   - it joins (green bar), appears in the database with its name and app level, and sees the organiser phone in its Phones list
//   - the same inside Instagram's built-in browser ("Continue here anyway")
//   - the organiser phone (the real one, read from the database) has its record, so every phone lists it. How recently it was heard is printed as a NOTE only:
//     it depends on whether a real person has the app open, not on the app
// then removes its own test record. It reads the team code from the local link file and never prints it.
//   BASE_URL=https://ecomsoc-checkout.web.app/ LINK_FILE=../VOLUNTEER-MESSAGE.md node team-check.mjs      (BROWSER=webkit for Safari's engine)
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';

const ENGINE = { chromium, webkit }[process.env.BROWSER || 'chromium'];
const IS_CHROMIUM = (process.env.BROWSER || 'chromium') === 'chromium';
const BASE = (process.env.BASE_URL || 'https://ecomsoc-checkout.web.app/').replace(/\/?$/, '/');
const DB = (process.env.SYNC_URL || 'https://ecomsoc-checkout-7k4q-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const txt = fs.readFileSync(process.env.LINK_FILE || '../VOLUNTEER-MESSAGE.md', 'utf8');
const m = txt.match(/[#?&]t(?:eam)?=([A-Za-z0-9-]{8,9})/i);
if (!m) { console.error('no team code in the link file'); process.exit(2); }
const TEAM = m[1].replace(/-/g, '').toUpperCase();
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 200) + ']' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(200); } return false; };
const get = async p => { const r = await fetch(`${DB}/${p}.json`); const t = await r.text(); try { return r.status === 200 ? JSON.parse(t) : null; } catch (e) { return null; } };
const IGI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108 (iPhone14,5; iOS 17_5; en_AU; en-AU; scale=3.00; 1170x2532; 640110043)';
const D = { ...devices['iPhone SE (3rd gen)'] }; delete D.defaultBrowserType; D.viewport = { width: 375, height: 667 };
const browser = await ENGINE.launch(IS_CHROMIUM && process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
const made = [];

async function volunteer(label, o = {}) {
  const ctx = await browser.newContext({ ...D, ...(o.ua ? { userAgent: o.ua } : {}) });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '#t=' + TEAM); await page.waitForSelector('#app *');
  if (o.ua) { await page.waitForSelector('[data-act=iab-continue]'); await wait(500); await page.click('[data-act=iab-continue]'); }
  await until(async () => (await page.evaluate(() => CC.state().team)) === TEAM, 15000);
  await page.evaluate(l => { CC.state().label = l; CC.commit(); }, label);
  const id = await page.evaluate(() => CC.state().id); made.push(id);
  return { page, ctx, id, errors };
}
const epochNow = async () => ((await get(`events/${TEAM}/meta`)) || {}).epoch;
const myRec = async id => (await get(`events/${TEAM}/epochs/${await epochNow()}/devices/${id}`));

const org0 = await get(`events/${TEAM}/admin`);
console.log(`Real team: organiser record ${org0 ? `"${org0.l}" heard ${Math.round((Date.now() - org0.hb) / 1000)} s ago` : 'none'}; current round ${(await epochNow() || '').slice(0, 8)}…\n`);

for (const [name, opt] of [['a volunteer opening the link in Safari or Chrome', {}], ['a volunteer opening the link inside Instagram (Continue here anyway)', { ua: IGI }]]) {
  console.log('--- ' + name);
  const v = await volunteer('Sync check ' + (opt.ua ? 'IG' : 'plain'), opt);
  check('The phone joins the real team and the bar turns green (connected)', await until(async () => (await v.page.evaluate(() => CC.syncState())) === 'ok', 20000));
  check('...it appears in the database for everyone, with its name and the newest app level', await until(async () => { const r = await myRec(v.id); return r && /^Sync check/.test(r.l || '') && r.app >= 4; }, 15000), JSON.stringify(await myRec(v.id) && { l: (await myRec(v.id)).l, app: (await myRec(v.id)).app }));
  const rows = async () => v.page.evaluate(() => CC.teamPhones().map(r => ({ n: r.name, me: r.me, admin: r.admin })));
  check('...its Phones list shows the organiser phone first and itself', await until(async () => { const r = await rows(); return r.length >= 2 && r[0].admin && /Admin/.test(r[0].n) && r.some(x => x.me); }, 20000), JSON.stringify(await rows()));
  const adm = (await get(`events/${TEAM}/admin`)) || {};
  check('...the organiser phone has its record in the database (so every phone lists it, even when that phone is asleep)', typeof adm.id === 'string' && adm.id.length >= 6 && /Admin/.test(adm.l || '') && typeof adm.hb === 'number', JSON.stringify({ l: adm.l, hasId: !!adm.id }));
  const quietFor = Math.round((Date.now() - (adm.hb || 0)) / 1000);          // (information only: whether a real person's phone is awake right now says nothing about the app, so it is never a pass or fail)
  console.log(`NOTE  organiser phone last heard ${quietFor < 120 ? quietFor + ' s' : Math.round(quietFor / 60) + ' min'} ago` + (quietFor >= 120 ? ' - its app is closed or in the background right now (normal when nobody is using it; open the app on that phone and it reports in within seconds)' : ' - it is online'));
  check('No JavaScript errors', v.errors.length === 0, v.errors.join(' | '));
  await v.ctx.close();
}
// remove the test records again
const ep = await epochNow();
for (const id of made) await fetch(`${DB}/events/${TEAM}/epochs/${ep}/devices/${id}.json?print=silent`, { method: 'DELETE' });
const left = Object.values((await get(`events/${TEAM}/epochs/${ep}/devices`)) || {}).filter(r => /^Sync check/.test(r.l || '')).length;
check('The test phones were removed from your team again', left === 0, left + ' left');
await browser.close();
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} real-team checks passed (${process.env.BROWSER || 'chromium'})`); process.exit(ok === results.length ? 0 : 1);
