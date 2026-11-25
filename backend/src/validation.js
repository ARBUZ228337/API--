const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateCredentials(body = {}) {
  const errors = [];
  const { email, password } = body;
  if (typeof email !== 'string' || email.length > 255 || !EMAIL_RE.test(email.trim())) {
    errors.push('Некорректный email');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    errors.push('Пароль должен содержать от 8 до 72 символов');
  }
  return errors;
}

function validateKeyName(name) {
  if (name === undefined) return [];
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return ['Название ключа: от 1 до 100 символов'];
  }
  return [];
}

module.exports = { validateCredentials, validateKeyName };
