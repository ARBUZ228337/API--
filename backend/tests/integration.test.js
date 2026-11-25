const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');

const tick = () => new Promise((r) => setTimeout(r, 30));
const fakeUpstream = (status = 200, body = '{"ok":true}') =>
  jest.fn(async () => ({
    status,
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => Buffer.from(body),
  }));

function setup({ rateLimit = 100, fetchFn = fakeUpstream() } = {}) {
  const config = { jwtSecret: 'test-secret', rateLimit, upstream: 'http://upstream.test' };
  return { app: createApp({ store: createMemoryStore(), config, fetchFn }), fetchFn };
}

async function registerAndLogin(app, email = 'user@test.ru') {
  await request(app).post('/api/register').send({ email, password: 'password123' });
  const res = await request(app).post('/api/login').send({ email, password: 'password123' });
  return res.body.token;
}

describe('Интеграция 1: регистрация, вход, ключи', () => {
  test('полный цикл + ошибки валидации и дубликата', async () => {
    const { app } = setup();

    const bad = await request(app).post('/api/register').send({ email: 'x', password: '1' });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/register').send({ email: 'a@b.ru', password: 'password123' });
    expect(ok.status).toBe(201);
    expect(ok.body).not.toHaveProperty('password_hash');

    const dup = await request(app).post('/api/register').send({ email: 'a@b.ru', password: 'password123' });
    expect(dup.status).toBe(409);

    const wrong = await request(app).post('/api/login').send({ email: 'a@b.ru', password: 'wrong-pass' });
    expect(wrong.status).toBe(401);

    expect((await request(app).get('/api/keys')).status).toBe(401);

    const token = await registerAndLogin(app, 'c@d.ru');
    const created = await request(app).post('/api/keys').set('Authorization', `Bearer ${token}`).send({ name: 'prod' });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^gw_/);

    const list = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('key'); // ключ в списке не возвращается
  });
});

describe('Интеграция 2: прокси, rate limit, аналитика', () => {
  test('прокси логирует запросы, лимит даёт 429, отозванный ключ — 403', async () => {
    const { app, fetchFn } = setup({ rateLimit: 3 });
    const token = await registerAndLogin(app);
    const auth = { Authorization: `Bearer ${token}` };
    const { body: k } = await request(app).post('/api/keys').set(auth).send({});

    expect((await request(app).get('/proxy/posts/1')).status).toBe(401);
    expect((await request(app).get('/proxy/posts/1').set('X-API-Key', 'gw_fake')).status).toBe(403);

    const r1 = await request(app).get('/proxy/posts/1?x=1').set('X-API-Key', k.key);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: true });
    expect(fetchFn.mock.calls[0][0]).toBe('http://upstream.test/posts/1?x=1');

    await request(app).get('/proxy/posts/1').set('X-API-Key', k.key);
    await request(app).get('/proxy/posts/2').set('X-API-Key', k.key);
    const limited = await request(app).get('/proxy/posts/2').set('X-API-Key', k.key);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    await tick();
    const stats = await request(app).get('/api/analytics?hours=1').set(auth);
    expect(stats.status).toBe(200);
    expect(stats.body.summary.total).toBe(4);
    expect(stats.body.summary.errors).toBe(1);
    expect(stats.body.topEndpoints[0]).toMatchObject({ endpoint: '/proxy/posts/1', requests: 2 });
    expect(stats.body.statusCodes).toEqual([{ status: 200, count: 3 }, { status: 429, count: 1 }]);

    await request(app).delete(`/api/keys/${k.id}`).set(auth).expect(204);
    expect((await request(app).get('/proxy/posts/1').set('X-API-Key', k.key)).status).toBe(403);
  });

  test('аналитика изолирована между пользователями; ошибка апстрима -> 502', async () => {
    const { app } = setup({ fetchFn: jest.fn().mockRejectedValue(new Error('down')) });
    const t1 = await registerAndLogin(app, 'one@test.ru');
    const t2 = await registerAndLogin(app, 'two@test.ru');
    const { body: k } = await request(app).post('/api/keys').set('Authorization', `Bearer ${t1}`).send({});

    expect((await request(app).get('/proxy/x').set('X-API-Key', k.key)).status).toBe(502);
    await tick();

    const s1 = await request(app).get('/api/analytics').set('Authorization', `Bearer ${t1}`);
    const s2 = await request(app).get('/api/analytics').set('Authorization', `Bearer ${t2}`);
    expect(s1.body.summary.total).toBe(1);
    expect(s2.body.summary.total).toBe(0);
  });
});
