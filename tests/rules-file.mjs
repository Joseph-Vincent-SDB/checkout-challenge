// Tests database.rules.json ITSELF (the file that gets published), with a small evaluator of the rules language,
// and checks that the stand-in database used by the other tests answers every case the same way as the file does.
//   node rules-file.mjs
import { loadRules, checkWrite, checkRead } from './rules-engine.mjs';
import { startMock } from './mock-rtdb.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rules = loadRules(path.join(HERE, '..', 'database.rules.json'));
const mock = await startMock();
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`); };
const T = 'events/ABCD2345', D = id => `${T}/epochs/e0/devices/${id}`, ID = 'abcdef123456';
const zero = { customers: 0, follows: 0, already: 0, correct: 0, wrong: 0, retries: 0, skips: 0, hot: 0, full: 0, won: 0, lost: 0, served: 0, members: 0, memberAlready: 0 };
const dev = (o = {}) => ({ c: { ...zero }, adj: 0, rev: 1, hb: 1700000000000, app: 3, ...o });
const ctl = (o = {}) => ({ rev: 1, paused: false, locked: false, mem: true, hot: 70, retries: 1, ...o });
const pid = i => 'abcdef' + String(100000 + i);
const dmOf = (n, t = 'hi', k = 'info') => Object.fromEntries(Array.from({ length: n }, (_, i) => [pid(i), { id: 'm' + i, t, k }]));
let db = {};
const setIn = (root, segs, val) => { const out = JSON.parse(JSON.stringify(root || {})); let n = out; for (let i = 0; i < segs.length - 1; i++) { n[segs[i]] = n[segs[i]] || {}; n = n[segs[i]]; } n[segs[segs.length - 1]] = val; return out; };

/* [name, path, value, expected allowed] run in order; the stored data changes after every allowed write */
const steps = [
  ['meta: valid', `${T}/meta`, { epoch: 'e0', startStock: 80, resetAt: 1700000000000, by: 'Phone A' }, true],
  ['meta: negative food', `${T}/meta`, { epoch: 'e0', startStock: -1 }, false],
  ['meta: extra field', `${T}/meta`, { epoch: 'e0', startStock: 80, evil: 1 }, false],
  ['device: the record the older app wrote (app 2, no newer fields)', D(ID), dev({ app: 2 }), true],
  ['device: with every newer field', D(ID), dev({ rev: 2, cr: 41, ack: 'a1b2c3d4', dk: 'e5f6a7b8', bat: 87, chg: true }), true],
  ['device: cr at the limit (1000000000)', D(ID), dev({ rev: 3, cr: 1000000000 }), true],
  ['device: cr beyond the limit', D(ID), dev({ rev: 4, cr: 1000000001 }), false],
  ['device: negative cr', D(ID), dev({ rev: 4, cr: -1 }), false],
  ['device: cr as text', D(ID), dev({ rev: 4, cr: '41' }), false],
  ['device: ack of 12 characters', D(ID), dev({ rev: 4, ack: 'abcdefghijkl' }), true],
  ['device: ack of 13 characters', D(ID), dev({ rev: 5, ack: 'abcdefghijklm' }), false],
  ['device: dk of 13 characters', D(ID), dev({ rev: 5, dk: 'abcdefghijklm' }), false],
  ['device: ack as a number', D(ID), dev({ rev: 5, ack: 5 }), false],
  ['device: battery 0', D(ID), dev({ rev: 5, bat: 0 }), true],
  ['device: battery 100', D(ID), dev({ rev: 6, bat: 100 }), true],
  ['device: battery 101', D(ID), dev({ rev: 7, bat: 101 }), false],
  ['device: battery -1', D(ID), dev({ rev: 7, bat: -1 }), false],
  ['device: battery as text', D(ID), dev({ rev: 7, bat: 'full' }), false],
  ['device: chg as text', D(ID), dev({ rev: 7, chg: 'yes' }), false],
  ['device: chg as a number', D(ID), dev({ rev: 7, chg: 1 }), false],
  ['device: unknown field still refused', D(ID), dev({ rev: 7, evil: 'x' }), false],
  ['device: an older revision is still refused', D(ID), dev({ rev: 2 }), false],
  ['device: the same revision (heartbeat) is accepted', D(ID), dev({ rev: 6, bat: 100 }), true],
  ['ctl: the first organiser version (no newer fields)', `${T}/ctl`, ctl(), true],
  ['ctl: every newer field', `${T}/ctl`, ctl({ rev: 2, poll: 8, keep: 10, qoff: 'E03,H02', hold: pid(1) + ',' + pid(2), gone: pid(3), rl: 'abc123XYZ0', log: '1700000000000|Joseph|Rush hour mode on\n1700000000001|Skyson|Retries 2', dm: dmOf(2, 'Come and see me', 'warn'), msg: { id: 'a1b2c3d4', t: 'hello', k: 'info' } }), true],
  ['ctl: older revision refused', `${T}/ctl`, ctl({ rev: 1 }), false],
  ['ctl: poll 30 (the most)', `${T}/ctl`, ctl({ rev: 3, poll: 30 }), true],
  ['ctl: poll 31', `${T}/ctl`, ctl({ rev: 4, poll: 31 }), false],
  ['ctl: negative poll', `${T}/ctl`, ctl({ rev: 4, poll: -1 }), false],
  ['ctl: poll as text', `${T}/ctl`, ctl({ rev: 4, poll: 'fast' }), false],
  ['ctl: keep 200', `${T}/ctl`, ctl({ rev: 4, keep: 200 }), true],
  ['ctl: keep 201', `${T}/ctl`, ctl({ rev: 5, keep: 201 }), false],
  ['ctl: negative keep', `${T}/ctl`, ctl({ rev: 5, keep: -1 }), false],
  ['ctl: qoff of 300 characters', `${T}/ctl`, ctl({ rev: 5, qoff: 'x'.repeat(300) }), true],
  ['ctl: qoff of 301 characters', `${T}/ctl`, ctl({ rev: 6, qoff: 'x'.repeat(301) }), false],
  ['ctl: qoff as a list instead of text', `${T}/ctl`, ctl({ rev: 6, qoff: ['E01'] }), false],
  ['ctl: hold of 400 characters', `${T}/ctl`, ctl({ rev: 6, hold: 'x'.repeat(400) }), true],
  ['ctl: hold of 401 characters', `${T}/ctl`, ctl({ rev: 7, hold: 'x'.repeat(401) }), false],
  ['ctl: gone of 401 characters', `${T}/ctl`, ctl({ rev: 7, gone: 'x'.repeat(401) }), false],
  ['ctl: 14 phone ids fit in hold and gone', `${T}/ctl`, ctl({ rev: 7, hold: Array.from({ length: 14 }, (_, i) => pid(i)).join(','), gone: Array.from({ length: 14 }, (_, i) => pid(i)).join(',') }), true],
  ['ctl: rl of 1 and 12 characters', `${T}/ctl`, ctl({ rev: 8, rl: 'abcdefghijkl' }), true],
  ['ctl: rl of 13 characters', `${T}/ctl`, ctl({ rev: 9, rl: 'abcdefghijklm' }), false],
  ['ctl: empty rl', `${T}/ctl`, ctl({ rev: 9, rl: '' }), false],
  ['ctl: log of 800 characters', `${T}/ctl`, ctl({ rev: 9, log: 'x'.repeat(800) }), true],
  ['ctl: log of 801 characters', `${T}/ctl`, ctl({ rev: 10, log: 'x'.repeat(801) }), false],
  ['ctl: a message for each of 12 phones', `${T}/ctl`, ctl({ rev: 10, dm: dmOf(12, 'x'.repeat(140), 'warn') }), true],
  ['ctl: message text of 141 characters', `${T}/ctl`, ctl({ rev: 11, dm: dmOf(1, 'x'.repeat(141)) }), false],
  ['ctl: empty message text', `${T}/ctl`, ctl({ rev: 11, dm: dmOf(1, '') }), false],
  ['ctl: unknown message style', `${T}/ctl`, ctl({ rev: 11, dm: dmOf(1, 'hi', 'loud') }), false],
  ['ctl: message for a made-up short phone id', `${T}/ctl`, ctl({ rev: 11, dm: { abc: { id: 'm1', t: 'hi', k: 'info' } } }), false],
  ['ctl: message with an extra field', `${T}/ctl`, ctl({ rev: 11, dm: { [pid(1)]: { id: 'm1', t: 'hi', k: 'info', evil: 1 } } }), false],
  ['ctl: message with a 13 character id', `${T}/ctl`, ctl({ rev: 11, dm: { [pid(1)]: { id: 'abcdefghijklm', t: 'hi', k: 'info' } } }), false],
  ['ctl: message missing its style', `${T}/ctl`, ctl({ rev: 11, dm: { [pid(1)]: { id: 'm1', t: 'hi' } } }), false],
  ['ctl: dm as text', `${T}/ctl`, ctl({ rev: 11, dm: 'hello' }), false],
  ['ctl: unknown top-level field still refused', `${T}/ctl`, ctl({ rev: 11, evil: 'x' }), false],
  ['ctl: missing a required field still refused', `${T}/ctl`, { rev: 11, paused: false, locked: false, mem: true, hot: 70 }, false],
  ['ctl: the biggest record the app can send', `${T}/ctl`, ctl({ rev: 12, poll: 30, keep: 200, qoff: 'E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,H01,H02,H03,H04,H05,H06,H07,H08,H09', hold: Array.from({ length: 14 }, (_, i) => pid(i)).join(','), gone: Array.from({ length: 14 }, (_, i) => pid(20 + i)).join(','), rl: 'abcdefghij', log: Array.from({ length: 8 }, (_, i) => (1700000000000 + i) + '|Joseph|' + 'y'.repeat(60)).join('\n'), dm: dmOf(12, 'z'.repeat(140), 'warn'), msg: { id: 'm1', t: 'x'.repeat(140), k: 'warn' } }), true],
  ['admin: valid organiser record', `${T}/admin`, { id: ID, l: "Joseph's Phone (Admin)", hb: 1700000000000 }, true],
  ['admin: extra field', `${T}/admin`, { id: ID, l: 'x', hb: 1, evil: 1 }, false],
  ['elsewhere: a made-up path under the team', `${T}/other`, { a: 1 }, false],
  ['elsewhere: a short team code', 'events/ABC/ctl', ctl(), false],
  ['elsewhere: the root', 'foo', { a: 1 }, false]
];

let okCount = 0, mismatch = [];
for (const [name, p, value, expected] of steps) {
  const e = checkWrite(rules, p, value, db);
  const r = await fetch(`${mock.url}/${p}.json?print=silent`, { method: 'PUT', body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });
  const mockAllowed = r.status === 204 || r.status === 200;
  check(`Rules file: ${name} -> ${expected ? 'accepted' : 'refused'}`, e.allowed === expected, e.allowed === expected ? '' : `file says ${e.allowed ? 'accepted' : 'refused'} (${e.why})`);
  if (mockAllowed !== e.allowed) mismatch.push(name + ` (file ${e.allowed}, stand-in ${mockAllowed})`);
  else okCount++;
  if (e.allowed) db = setIn(db, p.split('/').filter(Boolean), JSON.parse(JSON.stringify(value)));
}
check('The stand-in database used by the other tests answers every one of those ' + steps.length + ' cases the same way as the rules file', mismatch.length === 0, mismatch.join('; '));
check('Reads: a team code of 8 characters can be read', checkRead(rules, 'events/ABCD2345/ctl'));
check('Reads: a made-up short code, the whole database and the list of events cannot', !checkRead(rules, 'events/ABC/ctl') && !checkRead(rules, '') && !checkRead(rules, 'events'));
await mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} rules-file checks passed`);
process.exit(failed.length ? 1 : 0);
