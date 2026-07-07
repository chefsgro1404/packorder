/**
 * Builds a human-readable SN prefix from product + variant titles.
 * Examples:
 *   "Rohu (Rui) Fish - 2 kg" + "Scaled/Clean (Ready to cook)" → "rohu-2k-rc"
 *   "Bangladeshi Hilsha - 1 kg"                               → "bd-hilsha-1k"
 *   "Radhuni Turmeric Powder - 200gm"                         → "radhuni-turmeric-200g"
 *   "Baby Goat | Smaller regular pieces / 2 lb"               → "bgoat-2lb-reg"
 *   "Beef with Bone - 3lb | Regular Cut"                      → "beef-bn-3lb-reg"
 */

// ─── Cleaning ─────────────────────────────────────────────────────────────────

function cleanTitle(title: string): string {
  return title
    .replace(/[ঀ-৿ऀ-ॿ]+/g, '')     // Bengali + Devanagari blocks
    .replace(/[^\x00-\x7F]+/g, ' ')                    // any remaining non-ASCII
    .replace(/\([^)]*[^\x00-\x7F][^)]*\)/g, '')        // parens containing non-ASCII
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')             // emoji ranges
    .replace(/\$[\d.,]+/g, '')                          // prices
    .replace(/\b(limited\s+time|special\s+deal|mega\s+sale|exclusive|flash\s+sale|hot\s+deal)\b/gi, '')
    .replace(/[!~🔥]+/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s*\(\s*bari[-\s]*\d+\s*\)/gi, '')        // "(Bari-1)" variety codes
    .replace(/\(Rui\)|\(Ilish\)|\(Pangasius\)/gi, '')   // parenthetical synonyms
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Size extraction ──────────────────────────────────────────────────────────

const WEIGHT_UNITS = new Set(['kg', 'gm', 'g', 'lb', 'lbs', 'oz', 'ml', 'l']);

function extractBestSize(productTitle: string, variantTitle: string): string {
  const fromTitle = firstSize(productTitle);
  if (fromTitle) return fromTitle;
  const fromVariant = firstSize(variantTitle);
  return fromVariant ?? '';
}

function firstSize(text: string): string | null {
  const re = /(\d+(?:\.\d+)?(?:\/\d+)?)\s*-?\s*(kg|gm|g\b|lb|lbs|oz|ml|l\b|pc|pcs|pieces?)/gi;
  let best: { val: number; unit: string; raw: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[1].split('/')[0]);
    const unit = m[2].toLowerCase();
    if (!best || WEIGHT_UNITS.has(unit)) {
      best = { val, unit, raw: m[0] };
      if (WEIGHT_UNITS.has(unit)) break; // prefer weight over count
    }
  }
  return best ? formatSize(best.val, best.unit) : null;
}

function formatSize(val: number, unit: string): string {
  const u = unit.replace('lbs', 'lb').replace('gm', 'g').replace(/pieces?|pcs/, 'pc');
  if (u === 'g' && val >= 1000) {
    const kg = val / 1000;
    return kg === Math.floor(kg) ? `${kg}k` : kg.toFixed(1).replace('.', 'k');
  }
  if (u === 'kg') return val === Math.floor(val) ? `${val}k` : `${val}k`;
  if (u === 'ml' && val >= 1000) return `${val / 1000}l`;
  return `${val}${u}`;
}

// ─── Variant / prep code ──────────────────────────────────────────────────────

const VARIANT_CODES: [RegExp, string][] = [
  [/ready[\s-]+to[\s-]+cook|scaled.*cut.*ready|clean.*cut.*ready/i, 'rc'],
  [/not\s+scaled|no\s+clean\s+cut/i, 'ns'],
  [/cut\s+in\s+regular\s+steaks\s*\(not\s+scaled\)/i, 'ns'],
  [/whole\s+with\s+skin/i, 'whole-ws'],
  [/whole\s*\((?:no\s+cut|cleaned)/i, 'whole'],
  [/without\s+skin.*12\s*piece|12\s*piece.*without\s+skin/i, 'wos-12pc'],
  [/without\s+skin/i, 'wos'],
  [/with\s+skin/i, 'ws'],
  [/\bwhole\b/i, 'whole'],
  [/cleaned\s+and\s+cut\s+in\s+4|cut\s+in\s+4\s+pieces?/i, '4pc'],
  [/larger\s+biri?yani|biri?yani\s+(?:cut|pieces?)/i, 'bir'],
  [/small\s+regular\s+piece|regular\s+(?:cut|piece)|standard\s+curry\s+cut/i, 'reg'],
  [/medium[\s-]+size\s+piece|medium\s+piece/i, 'med'],
  [/tehari\s+cut|\btehari\b/i, 'tehari'],
  [/kacchi\s+cut|\bkacchi\b/i, 'kacchi'],
  [/main\s+sina/i, 'sina'],
  [/boneless.*skinless|skinless.*boneless/i, 'bs'],
  [/boneless\s+breast/i, 'brs'],
  [/from\s+thigh/i, 'thigh'],
  [/from\s+breast/i, 'brs'],
  [/cut\s+into\s+(?:small\s+)?p[ci][sc]|cut\s+into\s+pieces?/i, 'cut'],
  [/hard\s+chicken\s+skin/i, 'hard'],
  [/red\s+chicken\s+skin/i, 'red'],
  [/rooster\s+skin/i, 'rooster'],
];

function extractVariantCode(vt: string): string {
  if (!vt) return '';
  for (const [pattern, code] of VARIANT_CODES) {
    if (pattern.test(vt)) return code;
  }
  return '';
}

// ─── Known product patterns ───────────────────────────────────────────────────

const PRODUCT_PATTERNS: [RegExp, string][] = [
  // Fish — specific first
  [/bangladeshi\s+(?:hilsha|ilish|illish)/i, 'bd-hilsha'],
  [/shahjalal\s+nona|salted\s+hils[ah]|nona\s+ilish/i, 'dry-hilsha'],
  [/hilsha|ilish|illish/i, 'hilsha'],
  [/\brohu\b|\brui\b/i, 'rohu'],
  [/big\s+katla|katla.*vacuum/i, 'katla-big'],
  [/\bkatla\b/i, 'katla'],
  [/\bmrigel\b/i, 'mrigel'],
  [/\bchitol\b/i, 'chitol'],
  [/\bmagur\b/i, 'magur'],
  [/kalibaush/i, 'kalib'],
  [/shor[\s-]*puti/i, 'shor-puti'],
  [/golda\s+shrimp|\bgolda\b/i, 'shrimp'],
  [/headless\s+pangash|\bpangash\b|\bpangasius\b/i, 'pang'],
  [/rupchad[ae]|rupchanda|pomfret/i, 'rup'],
  [/\blotia\b/i, 'lotia'],
  [/desi\s+puti|shor\s+puti|\bputi\b/i, 'puti'],
  [/\bgutum\b/i, 'gutum'],
  [/mola\s+fish|\bmola\b/i, 'mola'],
  [/haor\s+koi|koi\s+fish|\bkoi\b/i, 'koi'],
  [/crispy\s+dry\s+shrimp|dry\s+shrimp|dried\s+shrimp/i, 'dry-shrimp'],
  [/dried\s+silver\s+pomfret|silver\s+pomfret.*dry/i, 'dry-rup'],
  [/puti\s+chapa\s+shutki|puti\s+hidol/i, 'dry-puti'],
  [/lotia.*dry|balachong|keski/i, 'dry-lotia'],
  [/dry\s+fish|shutki|hidol/i, 'dry-fish'],

  // Beef
  [/beef\s+(?:with\s+bone|main\s+sina|bone.*main\s+sina)/i, 'beef-bn'],
  [/beef\s+(?:without\s+bone|no\s+bone)/i, 'beef-nb'],
  [/beef\s+bowel|beef\s+vuri|\bvuri\b|\btripe\b/i, 'beef-vuri'],
  [/beef\s+liver/i, 'beef-liv'],
  [/beef\s+heart/i, 'beef-hrt'],
  [/beef\s+spleen|\btilli\b/i, 'beef-spln'],
  [/beef\s+brain/i, 'beef-brn'],
  [/beef\s+nalli|bone\s+marrow|\bnola\b|\bnalli\b/i, 'beef-nalli'],
  [/beef\s+(?:feet|paya)|paya.*white/i, 'beef-paya'],
  [/beef\s+tongue/i, 'beef-tng'],
  [/beef\s+head/i, 'beef-head'],
  [/beef\s+keema/i, 'beef-keem'],
  [/beef\s+fat|tallow/i, 'beef-fat'],
  [/beef\s+fajita/i, 'beef-faj'],
  [/beef\s+rib/i, 'beef-rib'],
  [/beef\s+shank/i, 'beef-shank'],
  [/\bribleye\b|\brbeye\b/i, 'ribeye'],
  [/t-bone/i, 'tbone'],

  // Chicken
  [/skin\s+off\s+chicken|cutting\s+service/i, 'chkn-cut'],
  [/guinea\s+fowl|cheena\s+chicken/i, 'guinea'],
  [/(?:small\s+white\s+)?cornish/i, 'cornish'],
  [/big\s+rooster/i, 'big-rooster'],
  [/hard\s+chicken/i, 'hard-chkn'],
  [/broiler\s+chicken|\bbroiler\b/i, 'broiler'],
  [/red\s+chicken.*smallest|red\s+chicken.*xs/i, 'red-chkn-xs'],
  [/red\s+chicken.*small/i, 'red-chkn-sm'],
  [/red\s+chicken.*medium/i, 'red-chkn-med'],
  [/red\s+chicken/i, 'red-chkn'],
  [/\brooster\b/i, 'rooster'],
  [/\bkoel\b/i, 'koel'],
  [/chicken\s+skin/i, 'chkn-skin'],
  [/chicken\s+quarter\s+leg|quarter\s+leg/i, 'chkn-qleg'],
  [/chicken\s+gizzard/i, 'chkn-giz'],
  [/chicken\s+drumstick/i, 'chkn-drum'],
  [/chicken\s+wing/i, 'chkn-wing'],
  [/chicken\s+breast/i, 'chkn-brs'],
  [/chicken\s+thigh/i, 'chkn-thigh'],
  [/chicken\s+liver/i, 'chkn-liv'],
  [/chicken\s+keema/i, 'chkn-keem'],
  [/chicken\s+tikka/i, 'chkn-tikka'],
  [/chicken\s+fajita/i, 'chkn-faj'],
  [/chicken\s+tender/i, 'chkn-tend'],
  [/chicken\s+cube/i, 'chkn-cube'],

  // Goat / Lamb
  [/australian.*baby\s+goat|baby\s+goat.*australian/i, 'aus-bgoat'],
  [/half\s+baby\s+goat/i, 'half-bgoat'],
  [/baby\s+goat\s+leg/i, 'bgoat-leg'],
  [/baby\s+goat\s+chop/i, 'bgoat-chop'],
  [/baby\s+goat/i, 'bgoat'],
  [/goat\s+keema/i, 'goat-keem'],
  [/goat\s+liver/i, 'goat-liv'],
  [/goat\s+head/i, 'goat-head'],
  [/goat\s+(?:bowel|vuri)|ojri/i, 'goat-vuri'],
  [/imported\s+goat/i, 'imp-goat'],
  [/baby\s+lamb|whole\s+lamb\s+small/i, 'lamb-whole'],
  [/whole\s+lamb/i, 'lamb-whole'],
  [/lamb\s+leg/i, 'lamb-leg'],
  [/lamb\s+shank/i, 'lamb-shank'],
  [/lamb\s+chop/i, 'lamb-chop'],
  [/lamb\s+tehari/i, 'lamb-tehari'],
  [/\bmutton\b|\bsheep\b/i, 'mutton'],

  // Duck / Pigeon
  [/muscovy\s+duck/i, 'musc-duck'],
  [/live\s+(?:water\s+)?duck/i, 'live-duck'],
  [/water\s+duck/i, 'duck'],
  [/live.*pigeon|\bpigeon\b/i, 'pigeon'],
];

function matchProductPattern(title: string): string | null {
  for (const [pattern, code] of PRODUCT_PATTERNS) {
    if (pattern.test(title)) return code;
  }
  return null;
}

// ─── Brand extraction ─────────────────────────────────────────────────────────

const BRANDS: [RegExp, string][] = [
  [/america'?s?\s+best/i, 'ab'],
  [/bengal\s+king/i, 'bk'],
  [/fresh\s+food/i, 'frsh'],
  [/new\s+hoque/i, 'nhoque'],
  [/shahjalal/i, 'shahjalal'],
  [/\bradhuni\b/i, 'radhuni'],
  [/\bshan\b/i, 'shan'],
  [/\bnational\b/i, 'natl'],
  [/\bbadia\b/i, 'badia'],
  [/\bpran\b/i, 'pran'],
  [/\bbanoful\b/i, 'banoful'],
  [/baghabari/i, 'bagha'],
  [/\bdeshi\b/i, 'deshi'],
  [/\bshahi\b/i, 'shahi'],
  [/\bswad\b/i, 'swad'],
  [/\bprime\b/i, 'prime'],
  [/\begn\b/i, 'egn'],
  [/\bputul\b/i, 'putul'],
  [/\bmaggi\b/i, 'maggi'],
  [/jhatpot/i, 'jhatpot'],
  [/\bmughal\b/i, 'mughal'],
  [/\btatka\b/i, 'tatka'],
  [/\bruchi\b/i, 'ruchi'],
  [/\bmeena\b/i, 'meena'],
  [/nicobena/i, 'nicob'],
  [/\blaxmi\b/i, 'laxmi'],
  [/\broshni\b/i, 'roshni'],
  [/\bbombay\b/i, 'bombay'],
  [/\bamina\b/i, 'amina'],
  [/sea\s+king/i, 'sk'],
  [/\bhoque\b/i, 'hoque'],
];

function extractBrand(title: string): { brand: string; remainder: string } {
  for (const [pattern, abbrev] of BRANDS) {
    if (pattern.test(title)) {
      const remainder = title.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
      return { brand: abbrev, remainder };
    }
  }
  return { brand: '', remainder: title };
}

// ─── Generic keyword extraction ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'with', 'and', 'for', 'from', 'into', 'by', 'at', 'on',
  'powder', 'seeds', 'seed', 'masala',
  'fresh', 'premium', 'special', 'new', 'best', 'quality', 'pure', 'natural', 'organic',
  'pack', 'packs', 'packet', 'bag', 'tray', 'box', 'loose', 'container',
  'pieces', 'piece', 'pcs', 'pc',
  'cut', 'clean', 'cleaned', 'trimmed', 'whole',
  'only', 'around', 'approximately', 'about', 'up', 'per', 'each', 'limited', 'time',
  'fish', 'chicken', 'beef', 'goat', 'lamb', 'mutton', 'duck', 'bird',
  'frozen', 'live',
]);

const WORD_ABBREVS: Record<string, string> = {
  turmeric: 'turmeric',
  coriander: 'cori',
  fenugreek: 'fenug',
  cardamom: 'cardam',
  cinnamon: 'cinnam',
  biryani: 'biriyani',
  biriyani: 'biriyani',
  flattened: 'flat',
  roasted: 'rstd',
  smoked: 'smkd',
  dried: 'dry',
  salted: 'salt',
  bangladeshi: 'bd',
  australian: 'aus',
  imported: 'imp',
};

function extractKeywords(text: string): string {
  const cleaned = text
    .replace(/\d+(?:\.\d+)?(?:\/\d+)?\s*(?:kg|gm|g\b|lb|lbs|oz|ml|l\b|pc|pcs|pieces?)/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[()[\]{}/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.toLowerCase().split(' ')
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 3)
    .map(w => WORD_ABBREVS[w] ?? (w.length > 8 ? w.slice(0, 8) : w));

  return words.join('-');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildSnPrefix(
  productTitle: string,
  variantTitle?: string | null
): string {
  const t = cleanTitle(productTitle);
  const vt = variantTitle && variantTitle !== 'Default Title' ? cleanTitle(variantTitle) : '';

  const size = extractBestSize(t, vt);
  const vCode = extractVariantCode(vt);

  // Known fish / meat / chicken / goat pattern
  const productCode = matchProductPattern(t);
  if (productCode) {
    return slug([productCode, size, vCode]);
  }

  // Brand-based (spices, grains, snacks, seeds, etc.)
  const { brand, remainder } = extractBrand(t);
  const words = extractKeywords(remainder);
  return slug([brand, words, size, vCode]);
}

function slug(parts: (string | undefined | null)[]): string {
  return parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Counter fetch ────────────────────────────────────────────────────────────

export async function fetchNextSn(
  variantId: string | null | undefined,
  plu: string | null | undefined,
  productTitle: string,
  variantTitle?: string | null
): Promise<string> {
  const prefix = buildSnPrefix(productTitle, variantTitle);
  try {
    const res = await fetch('/api/scale/next-sn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variantId: variantId || null,
        plu: plu || null,
        prefix,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.sn as string;
    }
    console.error('[snBuilder] next-sn API returned', res.status);
  } catch (err) {
    console.error('[snBuilder] failed to fetch next SN:', err);
  }
  // Fallback: prefix + timestamp ensures uniqueness even without the counter
  return `${prefix}-${Date.now()}`;
}
