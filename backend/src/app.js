const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validateCredentials, validateKeyName } = require('./validation');
const { generateKey, hashKey, keyPrefix } = require('./keys');
const { createRateLimiter } = require('./rateLimiter');

function createApp({ store, config, fetchFn = global.fetch }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  const limiter = createRateLimiter({ limit: config.rateLimit });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------- Middleware ----------
  // JWT-аутентификация пользователя (для /api/keys, /api/analytics)
  const requireJwt = (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
      req.userId = jwt.verify(token, config.jwtSecret).userId;
      next();
    } catch {
      res.status(401).json({ error: 'Недействительный или просроченный токен' });
    }
  };

  // Проверка API-ключа -> rate limiting -> логирование -> проксирование
  const apiKeyAuth = wrap(async (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Отсутствует заголовок X-API-Key' });
    const rec = await store.findKeyByHash(hashKey(String(key)));
    if (!rec || !rec.is_active) return res.status(403).json({ error: 'Недействительный или отозванный API-ключ' });
    req.apiKeyId = rec.id;
    next();
  });

  const rateLimit = (req, res, next) => {
    const r = limiter.check(req.apiKeyId);
    res.set('X-RateLimit-Limit', String(config.rateLimit));
    res.set('X-RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) {
      res.set('Retry-After', String(r.retryAfterSec));
      return res.status(429).json({ error: 'Превышен лимит запросов' });
    }
    next();
  };

  const logRequest = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      store.addLog({
        keyId: req.apiKeyId,
        endpoint: req.path.slice(0, 500),
        method: req.method,
        status: res.statusCode,
        ms: Date.now() - start,
      }).catch((e) => console.error('log write failed:', e.message));
    });
    next();
  };

  // ---------- Auth ----------
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/api/register', wrap(async (req, res) => {
    const errors = validateCredentials(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });
    const email = req.body.email.trim().toLowerCase();
    try {
      const user = await store.createUser(email, await bcrypt.hash(req.body.password, 10));
      res.status(201).json(user);
    } catch (e) {
      if (e.code === 'EXISTS') return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
      throw e;
    }
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Укажите email и пароль' });
    }
    const user = await store.findUserByEmail(email.trim().toLowerCase());
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '1h' });
    res.json({ token });
  }));

  // ---------- API-ключи ----------
  app.get('/api/keys', requireJwt, wrap(async (req, res) => {
    res.json(await store.listKeys(req.userId));
  }));

  app.post('/api/keys', requireJwt, wrap(async (req, res) => {
    const errors = validateKeyName(req.body && req.body.name);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const key = generateKey();
    const name = (req.body && req.body.name && req.body.name.trim()) || 'default';
    const rec = await store.createKey(req.userId, name, hashKey(key), keyPrefix(key));
    // Ключ показывается только один раз — в БД хранится лишь его хеш
    res.status(201).json({ ...rec, key });
  }));

  app.delete('/api/keys/:id', requireJwt, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
    const ok = await store.revokeKey(req.userId, id);
    if (!ok) return res.status(404).json({ error: 'Ключ не найден' });
    res.status(204).end();
  }));

  // ---------- Аналитика ----------
  app.get('/api/analytics', requireJwt, wrap(async (req, res) => {
    const hours = Math.min(720, Math.max(1, parseInt(req.query.hours, 10) || 24));
    res.json({ hours, ...(await store.stats(req.userId, hours)) });
  }));

  // ---------- Проксирование ----------
  app.all('/proxy/*', apiKeyAuth, rateLimit, logRequest, wrap(async (req, res) => {
    const target = config.upstream.replace(/\/$/, '') + req.originalUrl.replace(/^\/proxy/, '');
    const headers = { accept: req.headers.accept || '*/*' };
    const init = { method: req.method, headers, signal: AbortSignal.timeout(10_000) };
    if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    try {
      const up = await fetchFn(target, init);
      const body = Buffer.from(await up.arrayBuffer());
      const ct = up.headers.get('content-type');
      if (ct) res.set('content-type', ct);
      res.status(up.status).send(body);
    } catch {
      res.status(502).json({ error: 'Внешний API недоступен' });
    }
  }));

  // ---------- Ошибки ----------
  app.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}

module.exports = { createApp };
