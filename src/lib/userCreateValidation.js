// Чистая валидация формы «создать пользователя» (без React/сети). Второй рубеж — в Edge Function.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ['client', 'employee'];

export function validateNewUser({ email, password, role } = {}) {
  const errors = [];
  if (!email || !EMAIL_RE.test(email)) errors.push('email');
  if (!password || password.length < 8) errors.push('password');
  if (!ROLES.includes(role)) errors.push('role');
  return errors;
}
