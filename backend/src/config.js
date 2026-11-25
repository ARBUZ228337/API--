require('dotenv').config();

function loadConfig() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set (see .env.example)');
  return {
    port: Number(process.env.PORT) || 5000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret,
    upstream: process.env.UPSTREAM_URL || 'https://jsonplaceholder.typicode.com',
    rateLimit: Number(process.env.RATE_LIMIT_PER_MIN) || 60,
  };
}

module.exports = { loadConfig };
