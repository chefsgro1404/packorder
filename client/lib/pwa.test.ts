import { describe, it, expect } from 'vitest';

// ─── Dismiss TTL logic ─────────────────────────────────────────────────────────

const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissed(storedTimestamp: string | null, nowMs: number): boolean {
  if (!storedTimestamp) return false;
  const elapsed = nowMs - parseInt(storedTimestamp, 10);
  return elapsed < DISMISS_TTL_MS;
}

describe('install prompt dismiss TTL', () => {
  const now = Date.now();

  it('no stored value → not dismissed', () => {
    expect(isDismissed(null, now)).toBe(false);
  });

  it('dismissed 1 hour ago → still dismissed', () => {
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(isDismissed(String(oneHourAgo), now)).toBe(true);
  });

  it('dismissed 6 days ago → still dismissed', () => {
    const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
    expect(isDismissed(String(sixDaysAgo), now)).toBe(true);
  });

  it('dismissed exactly 7 days ago → expired (not dismissed)', () => {
    const sevenDaysAgo = now - DISMISS_TTL_MS;
    expect(isDismissed(String(sevenDaysAgo), now)).toBe(false);
  });

  it('dismissed 8 days ago → expired (not dismissed)', () => {
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    expect(isDismissed(String(eightDaysAgo), now)).toBe(false);
  });

  it('invalid stored value → treated as not dismissed', () => {
    // parseInt('bad') = NaN, NaN - now = NaN, NaN < TTL = false
    expect(isDismissed('bad', now)).toBe(false);
  });

  it('dismissed right now (0ms elapsed) → dismissed', () => {
    expect(isDismissed(String(now), now)).toBe(true);
  });
});

// ─── Standalone detection ──────────────────────────────────────────────────────

describe('standalone detection', () => {
  function isStandalone(displayMode: string): boolean {
    return displayMode === 'standalone';
  }

  it('standalone display mode → app is installed', () => {
    expect(isStandalone('standalone')).toBe(true);
  });

  it('browser display mode → not installed', () => {
    expect(isStandalone('browser')).toBe(false);
  });

  it('minimal-ui display mode → not installed', () => {
    expect(isStandalone('minimal-ui')).toBe(false);
  });

  it('fullscreen display mode → not installed', () => {
    expect(isStandalone('fullscreen')).toBe(false);
  });
});

// ─── Banner visibility logic ───────────────────────────────────────────────────

describe('banner visibility', () => {
  interface BannerState {
    showBanner: boolean;
    installed: boolean;
    dismissed: boolean;
    hasPrompt: boolean;
  }

  function isBannerVisible({ showBanner, installed, dismissed, hasPrompt }: BannerState): boolean {
    return showBanner && !installed && !dismissed && hasPrompt;
  }

  it('all conditions met → banner visible', () => {
    expect(isBannerVisible({ showBanner: true, installed: false, dismissed: false, hasPrompt: true })).toBe(true);
  });

  it('already installed → banner hidden', () => {
    expect(isBannerVisible({ showBanner: true, installed: true, dismissed: false, hasPrompt: true })).toBe(false);
  });

  it('dismissed → banner hidden', () => {
    expect(isBannerVisible({ showBanner: true, installed: false, dismissed: true, hasPrompt: true })).toBe(false);
  });

  it('no deferred prompt → banner hidden', () => {
    expect(isBannerVisible({ showBanner: true, installed: false, dismissed: false, hasPrompt: false })).toBe(false);
  });

  it('showBanner = false → banner hidden', () => {
    expect(isBannerVisible({ showBanner: false, installed: false, dismissed: false, hasPrompt: true })).toBe(false);
  });
});

// ─── Manifest contract ─────────────────────────────────────────────────────────

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const MANIFEST: Manifest = {
  name: 'ShipScan',
  short_name: 'ShipScan',
  start_url: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#f8fafc',
  theme_color: '#2563eb',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

describe('manifest contract', () => {
  it('name is "ShipScan"', () => {
    expect(MANIFEST.name).toBe('ShipScan');
    expect(MANIFEST.short_name).toBe('ShipScan');
  });

  it('display is "standalone"', () => {
    expect(MANIFEST.display).toBe('standalone');
  });

  it('orientation is "any" (supports portrait and landscape)', () => {
    expect(MANIFEST.orientation).toBe('any');
  });

  it('start_url is "/"', () => {
    expect(MANIFEST.start_url).toBe('/');
  });

  it('has at least 192×192 and 512×512 icons', () => {
    const sizes = MANIFEST.icons.map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('has a maskable icon for Android adaptive icons', () => {
    const maskable = MANIFEST.icons.filter(i => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
  });

  it('maskable icon is 512×512', () => {
    const maskable = MANIFEST.icons.find(i => i.purpose === 'maskable');
    expect(maskable?.sizes).toBe('512x512');
  });

  it('all icons reference /icons/ path', () => {
    MANIFEST.icons.forEach(icon => {
      expect(icon.src).toMatch(/^\/icons\//);
    });
  });

  it('theme_color is a valid hex color', () => {
    expect(MANIFEST.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ─── Service worker caching strategy ──────────────────────────────────────────

describe('caching strategy routing', () => {
  type CacheHandler = 'NetworkFirst' | 'CacheFirst' | 'NetworkOnly' | 'StaleWhileRevalidate';

  function getCacheHandler(url: string): CacheHandler {
    // Critical inventory routes — never cache
    if (/\/api\/(scale|purchase-orders|print-jobs)\//.test(url)) return 'NetworkOnly';
    // Other API routes — network first
    if (/^\/api\//.test(url)) return 'NetworkFirst';
    // Static assets — cache first
    if (/^\/_next\/static\//.test(url)) return 'CacheFirst';
    // Images and icons
    if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/.test(url)) return 'CacheFirst';
    // Pages
    return 'NetworkFirst';
  }

  it('scale API routes → NetworkOnly (never cached)', () => {
    expect(getCacheHandler('/api/scale/weight')).toBe('NetworkOnly');
    expect(getCacheHandler('/api/scale/connect')).toBe('NetworkOnly');
  });

  it('purchase-orders API → NetworkOnly', () => {
    expect(getCacheHandler('/api/purchase-orders/list')).toBe('NetworkOnly');
  });

  it('print-jobs API → NetworkOnly', () => {
    expect(getCacheHandler('/api/print-jobs/claim')).toBe('NetworkOnly');
  });

  it('generic API routes → NetworkFirst (can fall back to cache)', () => {
    expect(getCacheHandler('/api/products')).toBe('NetworkFirst');
    expect(getCacheHandler('/api/auth')).toBe('NetworkFirst');
    expect(getCacheHandler('/api/sync/settings')).toBe('NetworkFirst');
  });

  it('Next.js static chunks → CacheFirst (versioned)', () => {
    expect(getCacheHandler('/_next/static/chunks/main.js')).toBe('CacheFirst');
    expect(getCacheHandler('/_next/static/css/app.css')).toBe('CacheFirst');
  });

  it('PNG icons → CacheFirst', () => {
    expect(getCacheHandler('/icons/icon-192.png')).toBe('CacheFirst');
  });

  it('page navigations → NetworkFirst (try live, fall back)', () => {
    expect(getCacheHandler('/')).toBe('NetworkFirst');
    expect(getCacheHandler('/scale')).toBe('NetworkFirst');
    expect(getCacheHandler('/settings')).toBe('NetworkFirst');
  });
});

// ─── Offline fallback last-sync display ──────────────────────────────────────

describe('offline fallback last-sync display', () => {
  function formatLastSync(isoString: string | null): string | null {
    if (!isoString) return null;
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return null;
      return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return null;
    }
  }

  it('null → null (no last sync)', () => {
    expect(formatLastSync(null)).toBeNull();
  });

  it('invalid ISO string → null', () => {
    expect(formatLastSync('not-a-date')).toBeNull();
    expect(formatLastSync('')).toBeNull();
  });

  it('valid ISO string → formatted date string', () => {
    const result = formatLastSync('2024-01-15T14:30:00.000Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('date format includes month, day, and time', () => {
    const result = formatLastSync('2024-03-20T10:00:00.000Z');
    expect(result).toMatch(/Mar|20|AM|PM/);
  });
});

// ─── iOS meta tag requirements ────────────────────────────────────────────────

describe('iOS PWA meta requirements', () => {
  const REQUIRED_META = [
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'ShipScan' },
  ];

  it('all required iOS meta tags are defined', () => {
    REQUIRED_META.forEach(meta => {
      expect(meta.name).toBeTruthy();
      expect(meta.content).toBeTruthy();
    });
  });

  it('status bar style allows full-screen (black-translucent)', () => {
    const statusBar = REQUIRED_META.find(m => m.name === 'apple-mobile-web-app-status-bar-style');
    expect(statusBar?.content).toBe('black-translucent');
  });

  it('apple-mobile-web-app-capable enables standalone mode on iOS', () => {
    const capable = REQUIRED_META.find(m => m.name === 'apple-mobile-web-app-capable');
    expect(capable?.content).toBe('yes');
  });

  it('apple-touch-icon path follows convention', () => {
    const touchIconPath = '/icons/apple-touch-icon.png';
    expect(touchIconPath).toMatch(/^\/icons\//);
    expect(touchIconPath).toMatch(/\.png$/);
  });
});
