// In-memory реализация хранилища — для тестов. Интерфейс совпадает с postgres.js.
function createMemoryStore() {
  const users = [];
  const keys = [];
  const logs = [];
  let uid = 1, kid = 1;

  return {
    async createUser(email, passwordHash) {
      if (users.some((u) => u.email === email)) {
        const e = new Error('exists'); e.code = 'EXISTS'; throw e;
      }
      const u = { id: uid++, email, password_hash: passwordHash };
      users.push(u);
      return { id: u.id, email: u.email };
    },
    async findUserByEmail(email) { return users.find((u) => u.email === email) || null; },

    async createKey(userId, name, keyHash, prefix) {
      const k = { id: kid++, user_id: userId, name, key_hash: keyHash, key_prefix: prefix, is_active: true, created_at: new Date() };
      keys.push(k);
      return { id: k.id, name, prefix, is_active: true, created_at: k.created_at };
    },
    async listKeys(userId) {
      return keys.filter((k) => k.user_id === userId)
        .map((k) => ({ id: k.id, name: k.name, prefix: k.key_prefix, is_active: k.is_active, created_at: k.created_at }));
    },
    async revokeKey(userId, id) {
      const k = keys.find((x) => x.id === id && x.user_id === userId);
      if (!k) return false;
      k.is_active = false;
      return true;
    },
    async findKeyByHash(hash) {
      const k = keys.find((x) => x.key_hash === hash);
      return k ? { id: k.id, user_id: k.user_id, is_active: k.is_active } : null;
    },

    async addLog({ keyId, endpoint, method, status, ms }) {
      logs.push({ keyId, endpoint, method, status, ms, at: new Date() });
    },
    async stats(userId, hours) {
      const mine = new Set(keys.filter((k) => k.user_id === userId).map((k) => k.id));
      const since = Date.now() - hours * 3600_000;
      const rows = logs.filter((l) => mine.has(l.keyId) && l.at.getTime() >= since);
      const total = rows.length;
      const errors = rows.filter((r) => r.status >= 400).length;
      const avg = (a) => (a.length ? Math.round(a.reduce((s, r) => s + r.ms, 0) / a.length) : 0);

      const byEp = new Map();
      rows.forEach((r) => byEp.set(r.endpoint, [...(byEp.get(r.endpoint) || []), r]));
      const topEndpoints = [...byEp.entries()]
        .map(([endpoint, rs]) => ({ endpoint, requests: rs.length, avgMs: avg(rs) }))
        .sort((a, b) => b.requests - a.requests).slice(0, 5);

      const byStatus = new Map();
      rows.forEach((r) => byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1));
      const statusCodes = [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status - b.status);

      const byHour = new Map();
      rows.forEach((r) => {
        const d = new Date(r.at); d.setMinutes(0, 0, 0);
        const k = d.toISOString();
        const cur = byHour.get(k) || { bucket: k, requests: 0, errors: 0 };
        cur.requests += 1; if (r.status >= 400) cur.errors += 1;
        byHour.set(k, cur);
      });
      const timeline = [...byHour.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

      return { summary: { total, errors, avgMs: avg(rows) }, topEndpoints, statusCodes, timeline };
    },
  };
}

module.exports = { createMemoryStore };
