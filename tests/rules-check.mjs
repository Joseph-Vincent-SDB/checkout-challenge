// Probes the database security rules directly over REST.
//   node rules-check.mjs                       -> against the local mock
//   SYNC_URL=https://<db>.firebasedatabase.app node rules-check.mjs --live   -> against your real database
// Writes only under a random team code and deletes it again at the end.
import { startMock } from './mock-rtdb.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = process.argv.includes('--live');
const mock = LIVE ? null : await startMock();
const DB = (LIVE ? process.env.SYNC_URL : mock.url).replace(/\/+$/, '');
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const team = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); }
async function call(method, p, body, extra = {}) {
  const r = await fetch(`${DB}/${p}.json${method === 'GET' ? '' : '?print=silent'}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? undefined : { 'content-type': 'application/json' }, ...extra });
  let json = null; if (r.status === 200) json = await r.json(); return { status: r.status, json };
}
const oldZero = { customers: 0, follows: 0, already: 0, correct: 0, wrong: 0, retries: 0, skips: 0, hot: 0, full: 0, won: 0, lost: 0, served: 0 };   // records from before the membership step
const zero = { ...oldZero, members: 0, memberAlready: 0 };
const dev = (o = {}) => ({ c: { ...zero }, adj: 0, rev: 1, hb: Date.now(), app: 2, ...o });
const T = `events/${team}`, D = `${T}/epochs/e0/devices/abcdef123456`;
const denied = async (name, m, p, body) => { const r = await call(m, p, body); check(name, r.status === 401 || r.status === 403 || r.status === 400, 'HTTP ' + r.status); };
const allowed = async (name, m, p, body) => { const r = await call(m, p, body); check(name, r.status === 204 || r.status === 200, 'HTTP ' + r.status); return r; };

// who can read
await denied('Cannot read the whole database', 'GET', '', undefined);
await denied('Cannot list all events (so team codes cannot be discovered)', 'GET', 'events', undefined);
{ const r = await call('GET', T); check('Can read a team you know the code of (empty is fine)', r.status === 200 && r.json === null, 'HTTP ' + r.status); }
await denied('Cannot read a made-up short code', 'GET', 'events/ABC', undefined);

// meta
await allowed('Valid meta is accepted', 'PUT', `${T}/meta`, { epoch: 'e0', startStock: 80, resetAt: { '.sv': 'timestamp' }, by: 'Phone A' });
{ const r = await call('GET', `${T}/meta`); check('Server stamps resetAt with a real time', r.json && typeof r.json.resetAt === 'number' && r.json.resetAt > 1.7e12 && r.json.startStock === 80, JSON.stringify(r.json)); }
await denied('Meta with negative food is refused', 'PUT', `${T}/meta`, { epoch: 'e0', startStock: -1 });
await denied('Meta with absurd food (99999) is refused', 'PUT', `${T}/meta`, { epoch: 'e0', startStock: 99999 });
await denied('Meta with empty epoch is refused', 'PUT', `${T}/meta`, { epoch: '', startStock: 80 });
await denied('Meta with a 30 character epoch is refused', 'PUT', `${T}/meta`, { epoch: 'x'.repeat(30), startStock: 80 });
await denied('Meta with an extra field is refused', 'PUT', `${T}/meta`, { epoch: 'e0', startStock: 80, evil: 1 });
await denied('Meta missing startStock is refused', 'PUT', `${T}/meta`, { epoch: 'e0' });

// device records
await allowed('Valid phone record is accepted', 'PUT', D, dev({ l: 'Phone A', first: Date.now(), last: Date.now() }));
{ const r = await call('GET', D); check('Phone record reads back', r.json && r.json.c && r.json.c.served === 0 && r.json.l === 'Phone A', JSON.stringify(r.json).slice(0, 80)); }
await allowed('Record may omit optional fields (null/absent first and last)', 'PUT', D, dev({ first: null, last: null, rev: 1 }));
await allowed('Same revision again is accepted (heartbeat)', 'PUT', D, dev({ rev: 1 }));
await allowed('Higher revision is accepted', 'PUT', D, dev({ rev: 5, c: { ...zero, served: 3, customers: 3 } }));
await denied('Going back to an older revision is refused (stale, delayed write)', 'PUT', D, dev({ rev: 4 }));
{ const r = await call('GET', D); check('Refused stale write did not change the data', r.json && r.json.rev === 5 && r.json.c.served === 3, JSON.stringify(r.json && r.json.rev)); }
await allowed('Membership counters are accepted', 'PUT', D, dev({ rev: 6, c: { ...zero, members: 4, memberAlready: 2 } }));
await allowed('A record from the older app version (no membership counters) is still accepted', 'PUT', D, dev({ rev: 7, c: { ...oldZero, served: 3, customers: 3 } }));
await denied('Membership counter beyond 100000 is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, members: 1000000 } }));
await denied('Negative membership counter is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, memberAlready: -1 } }));
await denied('Record without counters is refused', 'PUT', D, { rev: 9, hb: 1 });
await denied('Record missing "served" is refused', 'PUT', D, dev({ rev: 9, c: { customers: 1 } }));
await denied('Negative counter is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, served: -1 } }));
await denied('Huge counter (1,000,000) is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, served: 1000000 } }));
await denied('Unknown counter name is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, pizza: 1 } }));
await denied('Text instead of a number is refused', 'PUT', D, dev({ rev: 9, c: { ...zero, served: 'many' } }));
await denied('Adjustment beyond +/-5000 is refused', 'PUT', D, dev({ rev: 9, adj: 9999 }));
await denied('A 30 character phone name is refused', 'PUT', D, dev({ rev: 9, l: 'n'.repeat(30) }));
await denied('Extra field on the record is refused', 'PUT', D, dev({ rev: 9, evil: 'x' }));

// where writes may go
await denied('Cannot write other paths under the team', 'PUT', `${T}/other`, { a: 1 });
await denied('Cannot overwrite the whole devices list at once', 'PUT', `${T}/epochs/e0/devices`, { abcdef123456: dev({ rev: 99 }) });
await denied('Cannot write to the root', 'PUT', 'foo', { a: 1 });
await denied('Cannot write a record with a too-short phone id', 'PUT', `${T}/epochs/e0/devices/abc`, dev());
await denied('Cannot use a too-long epoch id', 'PUT', `${T}/epochs/${'e'.repeat(25)}/devices/abcdef123456`, dev());
await denied('Cannot write under a made-up short team code', 'PUT', 'events/ABC/meta', { epoch: 'e0', startStock: 80 });

// CORS (browser calls from the GitHub Pages site)
{
  const r = await fetch(`${DB}/${T}/meta.json`, { method: 'OPTIONS', headers: { origin: 'https://joseph-vincent-sdb.github.io', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } });
  const allow = r.headers.get('access-control-allow-origin');
  check('Browsers on the GitHub Pages site are allowed to call it (CORS)', r.status < 300 && (allow === '*' || allow === 'https://joseph-vincent-sdb.github.io'), `HTTP ${r.status} allow-origin=${allow}`);
}
// clean up
await call('DELETE', D); await call('DELETE', `${T}/meta`);
{ const r = await call('GET', T); check('Test data removed', r.status === 200 && (r.json === null), JSON.stringify(r.json)); }

if (mock) await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} rules checks passed (${LIVE ? 'LIVE database' : 'mock'})`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-rules-run.json'), JSON.stringify({ live: LIVE, passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
