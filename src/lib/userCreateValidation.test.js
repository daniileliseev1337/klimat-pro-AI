import { describe, it, expect } from 'vitest';
import { validateNewUser } from './userCreateValidation.js';

describe('validateNewUser', () => {
  it('валидный вход → нет ошибок', () => {
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'client' })).toEqual([]);
    expect(validateNewUser({ email:'x@y.zz', password:'longpass1', role:'employee' })).toEqual([]);
  });
  it('битый email', () => {
    expect(validateNewUser({ email:'nope', password:'12345678', role:'client' })).toContain('email');
    expect(validateNewUser({ email:'', password:'12345678', role:'client' })).toContain('email');
  });
  it('короткий пароль', () => {
    expect(validateNewUser({ email:'a@b.co', password:'short', role:'client' })).toContain('password');
  });
  it('недопустимая роль', () => {
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'visitor' })).toContain('role');
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'' })).toContain('role');
  });
});
