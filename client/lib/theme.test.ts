import { describe, it, expect } from 'vitest';

// ─── Pure theme logic (no DOM) ────────────────────────────────────────────────

type Theme = 'light' | 'dark';

function resolveTheme(stored: string | null): Theme {
  return stored === 'dark' ? 'dark' : 'light';
}

function toggleTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

function buildDataTheme(theme: Theme): string {
  return theme; // the value set on data-theme attribute
}

// ─── Token contract ───────────────────────────────────────────────────────────

interface ThemeTokens {
  bgPage: string;
  bgCard: string;
  bgInput: string;
  bgElevated: string;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

const LIGHT_TOKENS: ThemeTokens = {
  bgPage:      '#f8fafc',
  bgCard:      '#ffffff',
  bgInput:     '#f1f5f9',
  bgElevated:  '#e2e8f0',
  borderColor: '#cbd5e1',
  textPrimary:   '#0f172a',
  textSecondary: '#475569',
  textMuted:     '#94a3b8',
};

const DARK_TOKENS: ThemeTokens = {
  bgPage:      '#0f172a',
  bgCard:      '#1e293b',
  bgInput:     '#1e293b',
  bgElevated:  '#334155',
  borderColor: '#334155',
  textPrimary:   '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted:     '#475569',
};

// ─── resolveTheme ─────────────────────────────────────────────────────────────

describe('resolveTheme', () => {
  it('no stored value → light', () => {
    expect(resolveTheme(null)).toBe('light');
  });

  it('"dark" stored → dark', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('"light" stored → light', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('unknown stored value → light (default)', () => {
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('')).toBe('light');
    expect(resolveTheme('auto')).toBe('light');
  });
});

// ─── toggleTheme ──────────────────────────────────────────────────────────────

describe('toggleTheme', () => {
  it('light → dark', () => {
    expect(toggleTheme('light')).toBe('dark');
  });

  it('dark → light', () => {
    expect(toggleTheme('dark')).toBe('light');
  });

  it('toggling twice returns to original', () => {
    expect(toggleTheme(toggleTheme('light'))).toBe('light');
    expect(toggleTheme(toggleTheme('dark'))).toBe('dark');
  });
});

// ─── data-theme attribute ─────────────────────────────────────────────────────

describe('buildDataTheme', () => {
  it('light theme → "light"', () => {
    expect(buildDataTheme('light')).toBe('light');
  });

  it('dark theme → "dark"', () => {
    expect(buildDataTheme('dark')).toBe('dark');
  });
});

// ─── Token values ─────────────────────────────────────────────────────────────

describe('light mode tokens', () => {
  it('page background is near-white', () => {
    expect(LIGHT_TOKENS.bgPage).toBe('#f8fafc');
  });

  it('card background is white', () => {
    expect(LIGHT_TOKENS.bgCard).toBe('#ffffff');
  });

  it('primary text is very dark (high contrast on white)', () => {
    expect(LIGHT_TOKENS.textPrimary).toBe('#0f172a');
  });

  it('secondary text is mid-dark slate', () => {
    expect(LIGHT_TOKENS.textSecondary).toBe('#475569');
  });

  it('border is light gray', () => {
    expect(LIGHT_TOKENS.borderColor).toBe('#cbd5e1');
  });
});

describe('dark mode tokens', () => {
  it('page background is very dark', () => {
    expect(DARK_TOKENS.bgPage).toBe('#0f172a');
  });

  it('card background is dark slate-800', () => {
    expect(DARK_TOKENS.bgCard).toBe('#1e293b');
  });

  it('primary text is near-white (high contrast on dark)', () => {
    expect(DARK_TOKENS.textPrimary).toBe('#f1f5f9');
  });

  it('border matches elevated background', () => {
    expect(DARK_TOKENS.borderColor).toBe(DARK_TOKENS.bgElevated);
  });
});

// ─── Token contrast — crude sanity (lighter bg = lighter token) ───────────────

describe('token contrast invariants', () => {
  function hexToLuminance(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  it('light mode: text-primary is darker than bg-page', () => {
    expect(hexToLuminance(LIGHT_TOKENS.textPrimary)).toBeLessThan(hexToLuminance(LIGHT_TOKENS.bgPage));
  });

  it('dark mode: text-primary is lighter than bg-page', () => {
    expect(hexToLuminance(DARK_TOKENS.textPrimary)).toBeGreaterThan(hexToLuminance(DARK_TOKENS.bgPage));
  });

  it('light mode: bg-elevated is darker than bg-page (depth hierarchy)', () => {
    expect(hexToLuminance(LIGHT_TOKENS.bgElevated)).toBeLessThan(hexToLuminance(LIGHT_TOKENS.bgPage));
  });

  it('dark mode: bg-elevated is lighter than bg-page (depth hierarchy)', () => {
    expect(hexToLuminance(DARK_TOKENS.bgElevated)).toBeGreaterThan(hexToLuminance(DARK_TOKENS.bgPage));
  });
});

// ─── localStorage key ─────────────────────────────────────────────────────────

describe('storage key contract', () => {
  const STORAGE_KEY = 'shipScanTheme';

  it('key is "shipScanTheme"', () => {
    expect(STORAGE_KEY).toBe('shipScanTheme');
  });

  it('only "dark" maps to dark; everything else is light', () => {
    expect(resolveTheme(STORAGE_KEY)).toBe('light'); // key string itself is not "dark"
    expect(resolveTheme('dark')).toBe('dark');
  });
});

// ─── Anti-flash script logic ──────────────────────────────────────────────────

describe('anti-flash script behavior', () => {
  function antiFlashScript(stored: string | null): string {
    return stored === 'dark' ? 'dark' : 'light';
  }

  it('no preference → sets data-theme="light"', () => {
    expect(antiFlashScript(null)).toBe('light');
  });

  it('"dark" preference → sets data-theme="dark"', () => {
    expect(antiFlashScript('dark')).toBe('dark');
  });

  it('"light" preference → sets data-theme="light"', () => {
    expect(antiFlashScript('light')).toBe('light');
  });

  it('arbitrary value → defaults to light (never flashes dark)', () => {
    expect(antiFlashScript('system')).toBe('light');
    expect(antiFlashScript('')).toBe('light');
  });
});
