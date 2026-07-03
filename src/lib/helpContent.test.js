import { describe, it, expect } from 'vitest';
import { HELP_SECTIONS, helpSectionsFor } from './helpContent.js';

describe('helpContent', () => {
  it('общие секции (tab=null) видны при любом наборе вкладок', () => {
    const keys = helpSectionsFor([]).map(s => s.key);
    expect(keys).toContain('about');
    expect(keys).toContain('search');
  });
  it('секция вкладки видна только если вкладка разрешена', () => {
    expect(helpSectionsFor(['projects']).map(s => s.key)).toContain('projects');
    expect(helpSectionsFor(['dashboard']).map(s => s.key)).not.toContain('projects');
  });
  it('§1: заказчик (4 вкладки) не видит employee-секций', () => {
    const client = helpSectionsFor(['dashboard', 'projects', 'tasks', 'finance']).map(s => s.key);
    expect(client).not.toContain('clients');
    expect(client).not.toContain('requests');
    expect(client).not.toContain('admin');
    expect(client).not.toContain('analytics');
  });
  it('сотрудник-админ видит admin-секцию', () => {
    expect(helpSectionsFor(['dashboard', 'admin']).map(s => s.key)).toContain('admin');
  });
  it('каждая секция имеет непустые title/desc/how и уникальный key', () => {
    const keys = new Set();
    for (const s of HELP_SECTIONS) {
      expect(s.title, s.key).toBeTruthy();
      expect(s.desc, s.key).toBeTruthy();
      expect(s.how, s.key).toBeTruthy();
      expect(keys.has(s.key), `dup ${s.key}`).toBe(false);
      keys.add(s.key);
    }
  });
});
