const { Pool } = require('pg');

function createPostgresStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  // Общий фрагмент: только логи ключей данного пользователя за период
  const SCOPE = `
    FROM request_logs l
    JOIN api_keys k ON k.id = l.api_key_id
    WHERE k.user_id = $1 AND l.created_at >= now() - make_interval(hours => $2)`;

  return {
    pool,
    async createUser(email, passwordHash) {
      try {
        const r = await pool.query(
          'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
          [email, passwordHash]);
        return r.rows[0];
      } catch (e) {
        if (e.code === '23505') { e.code = 'EXISTS'; }
        throw e;
      }
    },
    async findUserByEmail(email) {
      const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return r.rows[0] || null;
    },

    async createKey(userId, name, keyHash, prefix) {
      const r = await pool.query(
        `INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES ($1,$2,$3,$4)
         RETURNING id, name, key_prefix AS prefix, is_active, created_at`,
        [userId, name, keyHash, prefix]);
      return r.rows[0];
    },
    async listKeys(userId) {
      const r = await pool.query(
        `SELECT id, name, key_prefix AS prefix, is_active, created_at
         FROM api_keys WHERE user_id = $1 ORDER BY id DESC`, [userId]);
      return r.rows;
    },
    async revokeKey(userId, id) {
      const r = await pool.query(
        'UPDATE api_keys SET is_active = false WHERE id = $1 AND user_id = $2', [id, userId]);
      return r.rowCount > 0;
    },
    async findKeyByHash(hash) {
      const r = await pool.query('SELECT id, user_id, is_active FROM api_keys WHERE key_hash = $1', [hash]);
      return r.rows[0] || null;
    },

    async addLog({ keyId, endpoint, method, status, ms }) {
      await pool.query(
        `INSERT INTO request_logs (api_key_id, endpoint, method, status_code, response_time_ms)
         VALUES ($1,$2,$3,$4,$5)`, [keyId, endpoint, method, status, ms]);
    },
    async stats(userId, hours) {
      const p = [userId, hours];
      const [sum, top, codes, tl] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total,
                           COUNT(*) FILTER (WHERE l.status_code >= 400) AS errors,
                           COALESCE(ROUND(AVG(l.response_time_ms)), 0) AS avg_ms ${SCOPE}`, p),
        pool.query(`SELECT l.endpoint, COUNT(*) AS requests, ROUND(AVG(l.response_time_ms)) AS avg_ms ${SCOPE}
                    GROUP BY l.endpoint ORDER BY requests DESC LIMIT 5`, p),
        pool.query(`SELECT l.status_code AS status, COUNT(*) AS count ${SCOPE}
                    GROUP BY l.status_code ORDER BY l.status_code`, p),
        pool.query(`SELECT date_trunc('hour', l.created_at) AS bucket, COUNT(*) AS requests,
                           COUNT(*) FILTER (WHERE l.status_code >= 400) AS errors ${SCOPE}
                    GROUP BY 1 ORDER BY 1`, p),
      ]);
      const s = sum.rows[0];
      return {
        summary: { total: Number(s.total), errors: Number(s.errors), avgMs: Number(s.avg_ms) },
        topEndpoints: top.rows.map((r) => ({ endpoint: r.endpoint, requests: Number(r.requests), avgMs: Number(r.avg_ms) })),
        statusCodes: codes.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
        timeline: tl.rows.map((r) => ({ bucket: r.bucket.toISOString(), requests: Number(r.requests), errors: Number(r.errors) })),
      };
    },
  };
}

module.exports = { createPostgresStore };
