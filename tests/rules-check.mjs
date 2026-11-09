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

// organiser settings (ctl)
const C = `${T}/ctl`;
const ctlOk = (o = {}) => ({ rev: 1, paused: false, locked: false, mem: true, hot: 70, retries: 1, ...o });
await allowed('Valid organiser settings are accepted', 'PUT', C, ctlOk());
await allowed('Settings with a message are accepted', 'PUT', C, ctlOk({ rev: 2, msg: { id: 'a1b2c3d4', t: 'Only 10 serves left', k: 'info' } }));
{ const r = await call('GET', C); check('Settings read back for anyone with the team code', r.json && r.json.msg && r.json.msg.t === 'Only 10 serves left' && r.json.paused === false, JSON.stringify(r.json)); }
await allowed('Same revision again is accepted', 'PUT', C, ctlOk({ rev: 2 }));
await denied('An older revision of the settings is refused (stale write)', 'PUT', C, ctlOk({ rev: 1 }));
await denied('Settings missing a required field are refused', 'PUT', C, { rev: 3, paused: false, locked: false, mem: true, hot: 70 });
await denied('"paused" as text is refused', 'PUT', C, ctlOk({ rev: 3, paused: 'yes' }));
await denied('HOT DEAL chance above 100 is refused', 'PUT', C, ctlOk({ rev: 3, hot: 101 }));
await denied('Negative HOT DEAL chance is refused', 'PUT', C, ctlOk({ rev: 3, hot: -1 }));
await denied('More than 2 retries is refused', 'PUT', C, ctlOk({ rev: 3, retries: 3 }));
await denied('A message longer than 140 characters is refused', 'PUT', C, ctlOk({ rev: 3, msg: { id: 'a1b2c3d4', t: 'x'.repeat(141), k: 'info' } }));
await denied('An empty message is refused', 'PUT', C, ctlOk({ rev: 3, msg: { id: 'a1b2c3d4', t: '', k: 'info' } }));
await denied('A message with an unknown style is refused', 'PUT', C, ctlOk({ rev: 3, msg: { id: 'a1b2c3d4', t: 'hi', k: 'loud' } }));
await denied('A message with an extra field is refused', 'PUT', C, ctlOk({ rev: 3, msg: { id: 'a1b2c3d4', t: 'hi', k: 'info', evil: 1 } }));
await denied('An extra field on the settings is refused', 'PUT', C, ctlOk({ rev: 3, evil: 'x' }));
await denied('Settings under a made-up short team code are refused', 'PUT', 'events/ABC/ctl', ctlOk());
await allowed('Clearing the message (settings without msg) is accepted', 'PUT', C, ctlOk({ rev: 4 }));
{ const r = await call('GET', C); check('The cleared message is gone', r.json && r.json.msg === undefined && r.json.rev === 4, JSON.stringify(r.json)); }

// newer organiser controls (stall modes, reserve, question switches, update speed, hold/hide, messages to one phone, refresh, change list)
const pidn = i => 'abcdef' + String(100000 + i);
const dmN = (n, t = 'hi', k = 'info') => Object.fromEntries(Array.from({ length: n }, (_, i) => [pidn(i), { id: 'm' + i, t, k }]));
await allowed('Settings with every newer field are accepted', 'PUT', C, ctlOk({ rev: 10, poll: 8, keep: 10, qoff: 'E03,H02', hold: pidn(1), gone: pidn(2), rl: 'abc123XYZ0', log: '1700000000000|Joseph|Rush hour mode on', dm: dmN(2, 'Come and see me', 'warn') }));
{ const r = await call('GET', C); check('...they read back for anyone with the team code', r.json && r.json.poll === 8 && r.json.keep === 10 && r.json.qoff === 'E03,H02' && r.json.dm && r.json.dm[pidn(0)].t === 'Come and see me', JSON.stringify(r.json).slice(0, 120)); }
await denied('Update speed above 30 seconds is refused', 'PUT', C, ctlOk({ rev: 11, poll: 31 }));
await denied('A negative update speed is refused', 'PUT', C, ctlOk({ rev: 11, poll: -1 }));
await denied('A reserve above 200 is refused', 'PUT', C, ctlOk({ rev: 11, keep: 201 }));
await denied('A list of switched-off questions longer than 300 characters is refused', 'PUT', C, ctlOk({ rev: 11, qoff: 'x'.repeat(301) }));
await denied('A list of held phones longer than 400 characters is refused', 'PUT', C, ctlOk({ rev: 11, hold: 'x'.repeat(401) }));
await denied('A list of hidden phones longer than 400 characters is refused', 'PUT', C, ctlOk({ rev: 11, gone: 'x'.repeat(401) }));
await denied('A refresh token of 13 characters is refused', 'PUT', C, ctlOk({ rev: 11, rl: 'abcdefghijklm' }));
await denied('An empty refresh token is refused', 'PUT', C, ctlOk({ rev: 11, rl: '' }));
await denied('A change list longer than 800 characters is refused', 'PUT', C, ctlOk({ rev: 11, log: 'x'.repeat(801) }));
await denied('A message for one phone longer than 140 characters is refused', 'PUT', C, ctlOk({ rev: 11, dm: dmN(1, 'x'.repeat(141)) }));
await denied('A message for one phone with an unknown style is refused', 'PUT', C, ctlOk({ rev: 11, dm: dmN(1, 'hi', 'loud') }));
await denied('A message for a made-up short phone id is refused', 'PUT', C, ctlOk({ rev: 11, dm: { abc: { id: 'm1', t: 'hi', k: 'info' } } }));
await denied('A message for one phone with an extra field is refused', 'PUT', C, ctlOk({ rev: 11, dm: { [pidn(1)]: { id: 'm1', t: 'hi', k: 'info', evil: 1 } } }));
await denied('Text where the per-phone messages should be is refused', 'PUT', C, ctlOk({ rev: 11, dm: 'hello' }));
await allowed('The biggest settings record the app can send (14 held, 14 hidden, 12 messages, 8 change lines) is accepted', 'PUT', C, ctlOk({ rev: 12, poll: 30, keep: 200, qoff: 'E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,H01,H02,H03,H04,H05,H06,H07,H08,H09', hold: Array.from({ length: 14 }, (_, i) => pidn(i)).join(','), gone: Array.from({ length: 14 }, (_, i) => pidn(20 + i)).join(','), rl: 'abcdefghij', log: Array.from({ length: 8 }, (_, i) => (1700000000000 + i) + '|Joseph|' + 'y'.repeat(60)).join('\n'), dm: dmN(12, 'z'.repeat(140), 'warn'), msg: { id: 'm1', t: 'x'.repeat(140), k: 'warn' } }));
await allowed('Back to the plain settings (all newer fields cleared) is accepted', 'PUT', C, ctlOk({ rev: 13 }));
{ const r = await call('GET', C); check('...and the newer fields are gone', r.json && r.json.poll === undefined && r.json.dm === undefined && r.json.rev === 13, JSON.stringify(r.json)); }
await allowed('A phone record with the newer report fields (settings applied, messages seen, battery) is accepted', 'PUT', D, dev({ rev: 20, app: 3, cr: 41, ack: 'a1b2c3d4', dk: 'e5f6a7b8', bat: 87, chg: true }));
await denied('A negative settings revision in a phone record is refused', 'PUT', D, dev({ rev: 21, cr: -1 }));
await denied('A settings revision above 1000000000 in a phone record is refused', 'PUT', D, dev({ rev: 21, cr: 1000000001 }));
await denied('A message id of 13 characters in a phone record is refused', 'PUT', D, dev({ rev: 21, ack: 'abcdefghijklm' }));
await denied('A battery level above 100 is refused', 'PUT', D, dev({ rev: 21, bat: 101 }));
await denied('A battery level below 0 is refused', 'PUT', D, dev({ rev: 21, bat: -1 }));
await denied('Text for the charging flag is refused', 'PUT', D, dev({ rev: 21, chg: 'yes' }));
await denied('An unknown field next to the newer ones is still refused', 'PUT', D, dev({ rev: 21, cr: 41, evil: 'x' }));
await allowed('The record from the older app version is still accepted after all this', 'PUT', D, dev({ rev: 22, app: 2 }));

// organiser phone record (admin)
const AD = `${T}/admin`;
await allowed('Valid organiser-phone record is accepted', 'PUT', AD, { id: 'abcdef123456', l: "Joseph's Phone (Admin)", hb: Date.now() });
{ const r = await call('GET', AD); check('It reads back for anyone with the team code', r.json && r.json.id === 'abcdef123456' && r.json.l === "Joseph's Phone (Admin)", JSON.stringify(r.json)); }
await denied('Organiser record without a heartbeat time is refused', 'PUT', AD, { id: 'abcdef123456', l: 'x' });
await denied('Organiser record with a too-short id is refused', 'PUT', AD, { id: 'abc', l: 'x', hb: 1 });
await denied('Organiser record with a 30 character name is refused', 'PUT', AD, { id: 'abcdef123456', l: 'n'.repeat(30), hb: 1 });
await denied('Organiser record with an extra field is refused', 'PUT', AD, { id: 'abcdef123456', l: 'x', hb: 1, evil: 1 });
await denied('Organiser record with text for the time is refused', 'PUT', AD, { id: 'abcdef123456', l: 'x', hb: 'now' });
await denied('Organiser record under a made-up short team code is refused', 'PUT', 'events/ABC/admin', { id: 'abcdef123456', l: 'x', hb: 1 });
await allowed('The organiser record is not touched by a reset (meta change leaves it)', 'PUT', `${T}/meta`, { epoch: 'e1', startStock: 80, resetAt: { '.sv': 'timestamp' }, by: 'Phone A' });
{ const r = await call('GET', AD); check('...it is still there after the new round', r.json && r.json.id === 'abcdef123456', JSON.stringify(r.json)); }

// CORS (browser calls from the GitHub Pages site)
{
  const r = await fetch(`${DB}/${T}/meta.json`, { method: 'OPTIONS', headers: { origin: 'https://joseph-vincent-sdb.github.io', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } });
  const allow = r.headers.get('access-control-allow-origin');
  check('Browsers on the GitHub Pages site are allowed to call it (CORS)', r.status < 300 && (allow === '*' || allow === 'https://joseph-vincent-sdb.github.io'), `HTTP ${r.status} allow-origin=${allow}`);
}
// clean up
await call('DELETE', D); await call('DELETE', `${T}/meta`); await call('DELETE', C); await call('DELETE', AD);
{ const r = await call('GET', T); check('Test data removed', r.status === 200 && (r.json === null), JSON.stringify(r.json)); }

if (mock) await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} rules checks passed (${LIVE ? 'LIVE database' : 'mock'})`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-rules-run.json'), JSON.stringify({ live: LIVE, passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
