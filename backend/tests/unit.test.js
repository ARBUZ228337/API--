const { validateCredentials, validateKeyName } = require('../src/validation');
const { generateKey, hashKey, keyPrefix } = require('../src/keys');
const { createRateLimiter } = require('../src/rateLimiter');

describe('validation', () => {
  test('принимает корректные данные', () => {
    expect(validateCredentials({ email: 'a@b.ru', password: '12345678' })).toEqual([]);
  });
  test('отклоняет плохой email и короткий пароль', () => {
    expect(validateCredentials({ email: 'abc', password: '123' })).toHaveLength(2);
  });
  test('отклоняет не-строки', () => {
    expect(validateCredentials({ email: 123, password: {} })).toHaveLength(2);
  });
  test('название ключа: пустое — ошибка, отсутствующее — ок', () => {
    expect(validateKeyName('   ')).toHaveLength(1);
    expect(validateKeyName(undefined)).toEqual([]);
  });
});

describe('keys', () => {
  test('ключ уникален, имеет префикс gw_, хеш детерминирован', () => {
    const a = generateKey(), b = generateKey();
    expect(a).not.toBe(b);
    expect(a.startsWith('gw_')).toBe(true);
    expect(keyPrefix(a)).toHaveLength(10);
    expect(hashKey(a)).toBe(hashKey(a));
    expect(hashKey(a)).toHaveLength(64);
  });
});

describe('rate limiter', () => {
  test('блокирует после лимита и сбрасывается после окна', () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(false);
    expect(rl.check('other').allowed).toBe(true); // другой ключ независим
    t = 1000;
    expect(rl.check('k').allowed).toBe(true);
  });
});
