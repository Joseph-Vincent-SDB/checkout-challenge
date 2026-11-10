// A small stand-in for the Firebase Realtime Database REST API, for tests.
// It mirrors database.rules.json (who may read/write what, and what a valid record looks like)
// and can inject faults: delays, errors, lost responses, hung requests and dropped connections.
import http from 'node:http';

const COUNTERS = ['customers', 'follows', 'already', 'correct', 'wrong', 'retries', 'skips', 'hot', 'full', 'won', 'lost', 'served', 'members', 'memberAlready'];
const isNum = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

function validMeta(m) {
  if (!m || typeof m !== 'object') return false;
  const ok = Object.keys(m).every(k => ['epoch', 'startStock', 'resetAt', 'by'].includes(k));
  return ok && typeof m.epoch === 'string' && m.epoch.length >= 1 && m.epoch.length <= 24 && isNum(m.startStock, 0, 5000) &&
    (m.resetAt === undefined || isNum(m.resetAt)) && (m.by === undefined || isStr(m.by, 24));
}
let LEGACY = false;                     // mock.ctl.legacyRules = true behaves like the database rules from before the newest organiser controls
function validDevice(v, old) {
  if (!v || typeof v !== 'object') return false;
  if (!Object.keys(v).every(k => ['l', 'c', 'adj', 'first', 'last', 'hb', 'rev', 'app'].concat(LEGACY ? [] : ['cr', 'ack', 'dk', 'bat', 'chg']).includes(k))) return false;
  if (!v.c || typeof v.c !== 'object' || v.c.customers === undefined || v.c.served === undefined) return false;
  if (!Object.keys(v.c).every(k => COUNTERS.includes(k) && isNum(v.c[k], 0, 100000))) return false;
  if (!isNum(v.rev, 0) || !isNum(v.hb)) return false;
  if (old && old.rev !== undefined && v.rev < old.rev) return false;                   // a late, stale write is refused
  if (v.l !== undefined && !isStr(v.l, 24)) return false;
  if (v.adj !== undefined && !isNum(v.adj, -5000, 5000)) return false;
  if (v.first !== undefined && !isNum(v.first)) return false;
  if (v.last !== undefined && !isNum(v.last)) return false;
  if (v.app !== undefined && !isNum(v.app)) return false;
  if (v.cr !== undefined && !isNum(v.cr, 0, 1000000000)) return false;
  if (v.ack !== undefined && !isStr(v.ack, 12)) return false;
  if (v.dk !== undefined && !isStr(v.dk, 12)) return false;
  if (v.bat !== undefined && !isNum(v.bat, 0, 100)) return false;
  if (v.chg !== undefined && typeof v.chg !== 'boolean') return false;
  return true;
}
function validCtl(v, old) {            // mirrors the "ctl" rules: the organiser's shared settings and message
  if (!v || typeof v !== 'object') return false;
  if (!Object.keys(v).every(k => ['rev', 'paused', 'locked', 'mem', 'hot', 'retries', 'msg'].concat(LEGACY ? [] : ['poll', 'keep', 'qoff', 'hold', 'gone', 'dm', 'rl', 'log']).includes(k))) return false;
  if (!isNum(v.rev, 0, 1000000000)) return false;
  if (old && old.rev !== undefined && v.rev < old.rev) return false;                   // a late, stale write is refused
  if (typeof v.paused !== 'boolean' || typeof v.locked !== 'boolean' || typeof v.mem !== 'boolean') return false;
  if (!isNum(v.hot, 0, 100) || !isNum(v.retries, 0, 2)) return false;
  if (v.msg !== undefined) {
    const m = v.msg;
    if (!m || typeof m !== 'object' || !Object.keys(m).every(k => ['id', 't', 'k'].includes(k))) return false;
    if (typeof m.id !== 'string' || m.id.length < 1 || m.id.length > 12) return false;
    if (typeof m.t !== 'string' || m.t.length < 1 || m.t.length > 140) return false;
    if (m.k !== 'info' && m.k !== 'warn') return false;
  }
  if (v.poll !== undefined && !isNum(v.poll, 0, 30)) return false;
  if (v.keep !== undefined && !isNum(v.keep, 0, 200)) return false;
  if (v.qoff !== undefined && !isStr(v.qoff, 300)) return false;
  if (v.hold !== undefined && !isStr(v.hold, 400)) return false;
  if (v.gone !== undefined && !isStr(v.gone, 400)) return false;
  if (v.rl !== undefined && !(isStr(v.rl, 12) && v.rl.length >= 1)) return false;
  if (v.log !== undefined && !isStr(v.log, 800)) return false;
  if (v.dm !== undefined) {
    const d = v.dm;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    for (const k of Object.keys(d)) {
      const m = d[k];
      if (k.length < 6 || k.length > 24) return false;
      if (!m || typeof m !== 'object' || !Object.keys(m).every(x => ['id', 't', 'k'].includes(x))) return false;
      if (!(isStr(m.id, 12) && m.id.length >= 1) || !(isStr(m.t, 140) && m.t.length >= 1) || (m.k !== 'info' && m.k !== 'warn')) return false;
    }
  }
  return true;
}
function validAdmin(v) {               // mirrors the "admin" rules: who the organiser phone is and when it was last seen
  if (!v || typeof v !== 'object') return false;
  if (!Object.keys(v).every(k => ['id', 'l', 'hb'].includes(k))) return false;
  return typeof v.id === 'string' && v.id.length >= 6 && v.id.length <= 24 && isStr(v.l, 24) && isNum(v.hb);
}
function validClaim(slot, v, old) {         // mirrors the "claims" rules: serve number N can be created once; the same phone may repeat its own claim
  if (LEGACY) return false;                // the rules from before claims existed refuse the whole path
  if (!/^[0-9]{1,4}$/.test(slot)) return false;
  if (!v || typeof v !== 'object' || Object.keys(v).some(k => k !== 'id')) return false;
  if (typeof v.id !== 'string' || v.id.length < 6 || v.id.length > 24) return false;
  if (old && old.id !== v.id) return false;
  return true;
}
function resolveSV(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    for (const k of Object.keys(v)) v[k] = resolveSV(v[k]);
  }
  return v;
}
function prune(o) {                      // RTDB drops nulls and empty objects
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] === null || o[k] === undefined) delete o[k]; } if (!Object.keys(o).length) return null; }
  return o;
}

export function startMock() {
  let db = {};
  const ctl = { delayMs: 0, jitterMs: 0, failRate: 0, failStatus: 500, dropResponse: false, hang: false, refuse: false, deny: false, garbage: false, weird: null, filter: null, legacyRules: false };
  const stats = { total: 0, byMethod: {}, log: [] };
  const getAt = segs => { let n = db; for (const s of segs) { if (n && typeof n === 'object' && s in n) n = n[s]; else return null; } return n === undefined ? null : n; };
  const setAt = (segs, val) => {
    if (!segs.length) { db = val || {}; return; }
    let n = db; for (let i = 0; i < segs.length - 1; i++) { if (!n[segs[i]] || typeof n[segs[i]] !== 'object') n[segs[i]] = {}; n = n[segs[i]]; }
    if (val === null) delete n[segs[segs.length - 1]]; else n[segs[segs.length - 1]] = val;
    db = prune(db) || {};
  };

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'OPTIONS,GET,POST,PUT,DELETE,PATCH', 'access-control-allow-headers': (req.headers['access-control-request-headers'] || 'content-type'), 'cache-control': 'no-cache' };
    const u = new URL(req.url, 'http://x');
    stats.total++; stats.byMethod[req.method] = (stats.byMethod[req.method] || 0) + 1; stats.log.push({ t: Date.now(), m: req.method, p: u.pathname });
    if (req.method === 'OPTIONS') { res.writeHead(200, cors); return res.end(); }
    if (ctl.refuse) return req.socket.destroy();
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const respond = () => {
        if (ctl.hang) return;                                                    // never answers: the client must time out
        if (ctl.filter && !ctl.filter(req.method, u.pathname)) { /* filter says: behave normally */ }
        if (ctl.failRate && Math.random() < ctl.failRate) { res.writeHead(ctl.failStatus, { ...cors, 'content-type': 'application/json' }); return res.end('{"error":"injected"}'); }
        LEGACY = !!ctl.legacyRules;
        const send = (code, obj) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
        const path = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/\.json$/, '');
        const segs = path ? path.split('/') : [];
        const silent = u.searchParams.get('print') === 'silent';
        // rules: only /events/<8-char team>/... is reachable
        if (segs[0] !== 'events' || !segs[1] || segs[1].length !== 8) return send(401, { error: 'Permission denied' });
        if (ctl.garbage) { res.writeHead(200, { ...cors, 'content-type': 'text/html' }); return res.end('<html><body>Please log in to the campus Wi-Fi</body></html>'); }   // captive portal
        if (ctl.weird !== null && req.method === 'GET') return send(200, ctl.weird);                                                                                // valid JSON of the wrong shape
        if (req.method === 'GET') {
          const ob = u.searchParams.get('orderBy'), ll = +u.searchParams.get('limitToLast');
          if (ob === '"$key"' && ll > 0) { const n = getAt(segs); if (!n || typeof n !== 'object') return send(200, null); const ks = Object.keys(n).sort((a, b) => (+a - +b) || a.localeCompare(b)).slice(-ll); const o = {}; ks.forEach(k => o[k] = n[k]); return send(200, o); }
          return send(200, getAt(segs));
        }
        if (ctl.deny) return send(401, { error: 'Permission denied' });
        if (req.method === 'PUT' || req.method === 'PATCH') {
          let val; try { val = prune(resolveSV(JSON.parse(body))); } catch (e) { return send(400, { error: 'Invalid data' }); }
          const isMeta = segs.length === 3 && segs[2] === 'meta';
          const isDev = segs.length === 6 && segs[2] === 'epochs' && segs[4] === 'devices';
          const isAdm = segs.length === 3 && segs[2] === 'admin';
          const isCtl = segs.length === 3 && segs[2] === 'ctl';
          const isClaim = segs.length === 6 && segs[2] === 'epochs' && segs[4] === 'claims';
          if (isClaim) {
            if (!validClaim(segs[5], val, getAt(segs))) return send(401, { error: 'Permission denied' });
            this_apply(segs, val);
          } else if (isAdm) {
            if (!validAdmin(val)) return send(401, { error: 'Permission denied' });
            this_apply(segs, val);
          } else if (isCtl) {
            if (!validCtl(val, getAt(segs))) return send(401, { error: 'Permission denied' });
            this_apply(segs, val);
          } else if (isMeta) {
            const merged = req.method === 'PATCH' ? { ...(getAt(segs) || {}), ...val } : val;
            if (!validMeta(merged)) return send(401, { error: 'Permission denied' });
            if (!silent) { /* normal */ }
            this_apply(segs, merged);
          } else if (isDev) {
            if (segs[3].length < 1 || segs[3].length > 24 || segs[5].length < 6 || segs[5].length > 24) return send(401, { error: 'Permission denied' });
            if (!validDevice(val, getAt(segs))) return send(401, { error: 'Permission denied' });
            this_apply(segs, val);
          } else return send(401, { error: 'Permission denied' });
          if (ctl.dropResponse) return;                                          // written, but the answer is lost
          if (silent) { res.writeHead(204, cors); return res.end(); }
          return send(200, val);
        }
        if (req.method === 'DELETE') { setAt(segs, null); return send(200, null); }   // test clean-up only
        send(405, { error: 'method' });
      };
      const this_apply = (segs, v) => setAt(segs, JSON.parse(JSON.stringify(v)));
      const d = ctl.delayMs + (ctl.jitterMs ? Math.random() * ctl.jitterMs : 0);
      d ? setTimeout(respond, d) : respond();
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      ctl, stats,
      db: () => db,
      reset() { db = {}; Object.assign(ctl, { delayMs: 0, jitterMs: 0, failRate: 0, failStatus: 500, dropResponse: false, hang: false, refuse: false, deny: false, garbage: false, weird: null, legacyRules: false }); stats.total = 0; stats.byMethod = {}; stats.log = []; },
      get: segs => getAt(segs),
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); })
    });
  }));
}
