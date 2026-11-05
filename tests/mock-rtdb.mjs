// A small stand-in for the Firebase Realtime Database REST API, for tests.
// It mirrors database.rules.json (who may read/write what, and what a valid record looks like)
// and can inject faults: delays, errors, lost responses, hung requests and dropped connections.
import http from 'node:http';

const COUNTERS = ['customers', 'follows', 'already', 'correct', 'wrong', 'retries', 'skips', 'hot', 'full', 'won', 'lost', 'served'];
const isNum = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

function validMeta(m) {
  if (!m || typeof m !== 'object') return false;
  const ok = Object.keys(m).every(k => ['epoch', 'startStock', 'resetAt', 'by'].includes(k));
  return ok && typeof m.epoch === 'string' && m.epoch.length >= 1 && m.epoch.length <= 24 && isNum(m.startStock, 0, 5000) &&
    (m.resetAt === undefined || isNum(m.resetAt)) && (m.by === undefined || isStr(m.by, 24));
}
function validDevice(v, old) {
  if (!v || typeof v !== 'object') return false;
  if (!Object.keys(v).every(k => ['l', 'c', 'adj', 'first', 'last', 'hb', 'rev', 'app'].includes(k))) return false;
  if (!v.c || typeof v.c !== 'object' || v.c.customers === undefined || v.c.served === undefined) return false;
  if (!Object.keys(v.c).every(k => COUNTERS.includes(k) && isNum(v.c[k], 0, 100000))) return false;
  if (!isNum(v.rev, 0) || !isNum(v.hb)) return false;
  if (old && old.rev !== undefined && v.rev < old.rev) return false;                   // a late, stale write is refused
  if (v.l !== undefined && !isStr(v.l, 24)) return false;
  if (v.adj !== undefined && !isNum(v.adj, -5000, 5000)) return false;
  if (v.first !== undefined && !isNum(v.first)) return false;
  if (v.last !== undefined && !isNum(v.last)) return false;
  if (v.app !== undefined && !isNum(v.app)) return false;
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
  const ctl = { delayMs: 0, jitterMs: 0, failRate: 0, failStatus: 500, dropResponse: false, hang: false, refuse: false, deny: false, garbage: false, weird: null, filter: null };
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
        const send = (code, obj) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
        const path = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/\.json$/, '');
        const segs = path ? path.split('/') : [];
        const silent = u.searchParams.get('print') === 'silent';
        // rules: only /events/<8-char team>/... is reachable
        if (segs[0] !== 'events' || !segs[1] || segs[1].length !== 8) return send(401, { error: 'Permission denied' });
        if (ctl.garbage) { res.writeHead(200, { ...cors, 'content-type': 'text/html' }); return res.end('<html><body>Please log in to the campus Wi-Fi</body></html>'); }   // captive portal
        if (ctl.weird !== null && req.method === 'GET') return send(200, ctl.weird);                                                                                // valid JSON of the wrong shape
        if (req.method === 'GET') return send(200, getAt(segs));
        if (ctl.deny) return send(401, { error: 'Permission denied' });
        if (req.method === 'PUT' || req.method === 'PATCH') {
          let val; try { val = prune(resolveSV(JSON.parse(body))); } catch (e) { return send(400, { error: 'Invalid data' }); }
          const isMeta = segs.length === 3 && segs[2] === 'meta';
          const isDev = segs.length === 6 && segs[2] === 'epochs' && segs[4] === 'devices';
          if (isMeta) {
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
      reset() { db = {}; Object.assign(ctl, { delayMs: 0, jitterMs: 0, failRate: 0, failStatus: 500, dropResponse: false, hang: false, refuse: false, deny: false, garbage: false, weird: null }); stats.total = 0; stats.byMethod = {}; stats.log = []; },
      get: segs => getAt(segs),
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); })
    });
  }));
}
