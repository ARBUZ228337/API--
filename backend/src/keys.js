const crypto = require('crypto');

function generateKey() {
  return 'gw_' + crypto.randomBytes(24).toString('hex');
}
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
function keyPrefix(key) {
  return key.slice(0, 10);
}

module.exports = { generateKey, hashKey, keyPrefix };
