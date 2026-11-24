import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/theme';

describe('resolveTheme', () => {
  it('light and dark ignore the phone setting', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('auto follows the phone', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
});
