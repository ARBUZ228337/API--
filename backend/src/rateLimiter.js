// Фиксированное окно: не более `limit` запросов на ключ за `windowMs`.
function createRateLimiter({ limit, windowMs = 60_000, now = Date.now }) {
  const buckets = new Map();
  return {
    check(id) {
      const t = now();
      let b = buckets.get(id);
      if (!b || t >= b.resetAt) {
        b = { count: 0, resetAt: t + windowMs };
        buckets.set(id, b);
      }
      b.count += 1;
      return {
        allowed: b.count <= limit,
        remaining: Math.max(0, limit - b.count),
        retryAfterSec: Math.ceil((b.resetAt - t) / 1000),
      };
    },
  };
}

module.exports = { createRateLimiter };
