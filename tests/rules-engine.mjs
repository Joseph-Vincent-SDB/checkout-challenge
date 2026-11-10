// A small evaluator for the part of the Firebase Realtime Database rules language that database.rules.json uses
// (.read, .write, .validate with newData / data / $variables / now). It lets the tests check the real rules FILE
// without Java or the Firebase emulator. It is not a full implementation of the language, only enough for these rules;
// the final proof is still `rules-check.mjs --live` against the real database after the rules are published.
import fs from 'node:fs';

// the rules language has string.matches(/regex/); plain JavaScript strings do not, so it is added for the evaluator
if (!String.prototype.matches) Object.defineProperty(String.prototype, 'matches', { value: function (re) { return re.test(String(this)); }, configurable: true });

export function loadRules(file) { return JSON.parse(fs.readFileSync(file, 'utf8')).rules; }

function snap(v) {
  const has = v !== null && v !== undefined;
  const obj = has && typeof v === 'object';
  return {
    exists: () => has,
    val: () => (has ? v : null),
    isString: () => typeof v === 'string',
    isNumber: () => typeof v === 'number' && Number.isFinite(v),
    isBoolean: () => typeof v === 'boolean',
    hasChild: k => obj && v[k] !== undefined && v[k] !== null,
    hasChildren: arr => obj && (arr === undefined ? Object.keys(v).length > 0 : arr.every(k => v[k] !== undefined && v[k] !== null)),
    child: k => snap(obj ? v[k] : null),
    getPriority: () => null
  };
}
function ev(expr, ctx) {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(ctx);
  // eslint-disable-next-line no-new-func
  return !!new Function(...names, 'return (' + expr + ');')(...names.map(n => ctx[n]));
}
const get = (root, segs) => { let n = root; for (const s of segs) { if (n && typeof n === 'object' && s in n) n = n[s]; else return null; } return n === undefined ? null : n; };
const setIn = (root, segs, val) => {
  if (!segs.length) return val;
  const out = JSON.parse(JSON.stringify(root || {}));
  let n = out;
  for (let i = 0; i < segs.length - 1; i++) { if (!n[segs[i]] || typeof n[segs[i]] !== 'object') n[segs[i]] = {}; n = n[segs[i]]; }
  if (val === null) delete n[segs[segs.length - 1]]; else n[segs[segs.length - 1]] = val;
  return out;
};
function childRule(node, key, vars) {
  if (node[key] !== undefined && !key.startsWith('.')) return { node: node[key], vars };
  const wild = Object.keys(node).find(k => k.startsWith('$'));
  if (wild) return { node: node[wild], vars: { ...vars, [wild]: key } };
  return null;
}
function validateTree(node, vars, nv, ov, now) {
  if (nv === null || nv === undefined) return null;
  if (node['.validate'] !== undefined && !ev(node['.validate'], { ...vars, newData: snap(nv), data: snap(ov), now })) return 'validate refused';
  if (typeof nv === 'object') {
    for (const k of Object.keys(nv)) {
      const c = childRule(node, k, vars); if (!c) continue;
      const err = validateTree(c.node, c.vars, nv[k], ov && typeof ov === 'object' ? ov[k] : null, now);
      if (err) return err + ' at ' + k;
    }
  }
  return null;
}

/* Would a write of `value` at `path` be allowed, given what is stored now (`db`)? PUT semantics: `value` replaces the node. */
export function checkWrite(rules, path, value, db = {}, now = Date.now()) {
  const segs = path.split('/').filter(Boolean);
  const newRoot = setIn(db, segs, value);
  let node = rules, vars = {}, granted = false, err = null;
  for (let i = 0; i <= segs.length; i++) {
    const nAt = get(newRoot, segs.slice(0, i)), oAt = get(db, segs.slice(0, i));
    if (node['.write'] !== undefined && ev(node['.write'], { ...vars, newData: snap(nAt), data: snap(oAt), now })) granted = true;
    if (i === segs.length) { err = err || validateTree(node, vars, nAt, oAt, now); break; }
    if (nAt !== null && node['.validate'] !== undefined && !ev(node['.validate'], { ...vars, newData: snap(nAt), data: snap(oAt), now })) err = err || 'validate refused above';
    const c = childRule(node, segs[i], vars);
    if (!c) { if (i < segs.length) { /* no rule below here: nothing more to check */ } break; }
    node = c.node; vars = c.vars;
  }
  if (!granted) return { allowed: false, why: 'no .write rule grants this' };
  if (err) return { allowed: false, why: err };
  return { allowed: true, why: '' };
}
export function checkRead(rules, path, db = {}, now = Date.now()) {
  const segs = path.split('/').filter(Boolean);
  let node = rules, vars = {};
  for (let i = 0; i <= segs.length; i++) {
    if (node['.read'] !== undefined && ev(node['.read'], { ...vars, data: snap(get(db, segs.slice(0, i))), now })) return true;
    if (i === segs.length) break;
    const c = childRule(node, segs[i], vars); if (!c) break;
    node = c.node; vars = c.vars;
  }
  return false;
}
