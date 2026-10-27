/* localdb.js: the storage behind the Tasks & habits board (board.html).
   It gives the page a small document database (db.doc / db.collection), saved as JSON files in your own
   data/board folder by the Agents World server (server/board.js). The page checks for changes every 3 seconds,
   so edits made elsewhere (or by an agent) show up by themselves. */
(function () {
  const DB = window.LIFE_DB || 'board';
  const BASE = '/api/' + DB + '/';
  const subs = new Set();
  const META = { fromCache: false, hasPendingWrites: false };

  function err(r) { return { code: r.status === 400 ? 'invalid_argument' : 'unavailable', message: 'HTTP ' + r.status }; }
  function snapDoc(id, exists, data) { return { id, exists: !!exists, data: () => (exists ? data : undefined), metadata: META }; }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function merge(a, b) {
    const out = Object.assign({}, a);
    Object.keys(b).forEach(k => { out[k] = isObj(out[k]) && isObj(b[k]) ? merge(out[k], b[k]) : b[k]; });
    return out;
  }
  async function getJSON(path) {
    const r = await fetch(BASE + path, { cache: 'no-store' });
    if (!r.ok) throw err(r);
    return r.json();
  }
  async function write(method, path, data) {
    const r = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    if (!r.ok) throw err(r);
    subs.forEach(s => s.tick());
  }
  function poll(load, key, next) {
    let last = null, alive = true;
    const sub = {
      tick: async () => {
        if (!alive) return;
        try { const v = await load(); const k = key(v); if (k !== last) { last = k; next(v); } }
        catch (e) { /* server briefly down: keep the last view */ }
      }
    };
    subs.add(sub); sub.tick();
    const t = setInterval(sub.tick, 3000);
    return () => { alive = false; clearInterval(t); subs.delete(sub); };
  }

  class Query {
    constructor(path, ord, lim) { this.path = path; this._o = ord; this._l = lim; }
    orderBy(f, d) { return new Query(this.path, { f, d: d || 'asc' }, this._l); }
    limit(n) { return new Query(this.path, this._o, n); }
    where() { return this; }
    async _rows() {
      let rows = await getJSON(this.path);
      if (this._o) {
        const { f, d } = this._o;
        rows.sort((a, b) => {
          const x = a.data[f], y = b.data[f];
          if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1;
          return (x < y ? -1 : 1) * (d === 'desc' ? -1 : 1);
        });
      }
      if (this._l) rows = rows.slice(0, this._l);
      return rows;
    }
    _snap(rows) {
      const docs = rows.map(r => snapDoc(r.id, true, r.data));
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: META };
    }
    async get() { return this._snap(await this._rows()); }
    onSnapshot(next) { return poll(() => this._rows(), JSON.stringify, rows => next(this._snap(rows))); }
  }
  class Col extends Query {
    doc(id) { return new Doc(this.path + '/' + (id || genId())); }
    async add(data) { const d = this.doc(); await d.set(data); return d; }
  }
  class Doc {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    async get() { const j = await getJSON(this.path); return snapDoc(this.id, j.exists, j.data); }
    async set(data) { await write('PUT', this.path, data); }
    async update(data) {
      const s = await this.get();
      if (!s.exists) throw { code: 'invalid_argument', message: 'document does not exist' };
      await write('PUT', this.path, merge(s.data(), data));
    }
    async delete() { await write('DELETE', this.path); }
    onSnapshot(next) { return poll(() => this.get(), s => JSON.stringify([s.exists, s.data()]), next); }
    collection(p) { return new Col(this.path + '/' + p); }
  }

  const db = Object.freeze({ doc: p => new Doc(p), collection: p => new Col(p) });
  const user = Object.freeze({
    id: async () => 'local', me: async () => ({ id: 'local' }), profiles: async () => ({}),
    isOwner: () => true, canEdit: () => true, can: async () => true
  });
  window.claude = Object.freeze({ use: async name => (name === 'db' ? db : name === 'user' ? user : null) });
})();
