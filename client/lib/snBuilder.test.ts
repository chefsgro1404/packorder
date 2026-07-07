import { describe, it, expect } from 'vitest';
import { buildSnPrefix } from './snBuilder';

// ─── Fish ─────────────────────────────────────────────────────────────────────

describe('fish', () => {
  it('rohu with ready-to-cook variant', () => {
    expect(buildSnPrefix('Rohu (Rui) Fish - 2 kg', 'Scaled/Clean (Ready to cook)')).toBe('rohu-2k-rc');
  });
  it('rohu not-scaled variant', () => {
    expect(buildSnPrefix('Rohu (Rui) Fish - 2 kg', 'Not Scaled')).toBe('rohu-2k-ns');
  });
  it('rohu 4 kg', () => {
    expect(buildSnPrefix('Rohu (Rui) Fish - 4 kg', 'Scaled/Clean (Ready to cook)')).toBe('rohu-4k-rc');
  });
  it('bangladeshi hilsha', () => {
    expect(buildSnPrefix('Bangladeshi Hilsha - 1 kg', 'Default Title')).toBe('bd-hilsha-1k');
  });
  it('hilsha (ilish spelling)', () => {
    expect(buildSnPrefix('Ilish Fish - 500gm', '')).toBe('hilsha-500g');
  });
  it('katla', () => {
    expect(buildSnPrefix('Katla Fish - 3 kg', 'Ready to cook')).toBe('katla-3k-rc');
  });
  it('mrigel', () => {
    expect(buildSnPrefix('Mrigel Fish - 2 kg', 'Not Scaled')).toBe('mrigel-2k-ns');
  });
  it('pangash', () => {
    expect(buildSnPrefix('Pangash Fish - 2 kg', 'Ready to cook')).toBe('pang-2k-rc');
  });
  it('golda shrimp', () => {
    expect(buildSnPrefix('Golda Shrimp - 1 kg', '')).toBe('shrimp-1k');
  });
  it('rupchanda / pomfret', () => {
    expect(buildSnPrefix('Rupchanda Fish - 1 kg', '')).toBe('rup-1k');
  });
  it('dry shrimp', () => {
    expect(buildSnPrefix('Dry Shrimp - 200gm', 'Default Title')).toBe('dry-shrimp-200g');
  });
  it('strips Bengali parenthetical synonyms', () => {
    const sn = buildSnPrefix('Rohu (Rui) Fish - 2 kg', 'Ready to cook');
    expect(sn).not.toContain('rui');
    expect(sn).toMatch(/^rohu-/);
  });
});

// ─── Beef ─────────────────────────────────────────────────────────────────────

describe('beef', () => {
  it('beef with bone regular cut', () => {
    expect(buildSnPrefix('Beef with Bone - 3lb', 'Regular Cut – Standard curry cut')).toBe('beef-bn-3lb-reg');
  });
  it('beef with bone tehari cut', () => {
    expect(buildSnPrefix('Beef with Bone - 3lb', 'Tehari Cut')).toBe('beef-bn-3lb-tehari');
  });
  it('beef with bone kacchi cut', () => {
    expect(buildSnPrefix('Beef with Bone - 3lb', 'Kacchi Cut')).toBe('beef-bn-3lb-kacchi');
  });
  it('beef without bone', () => {
    expect(buildSnPrefix('Beef without Bone - 2lb', 'Default Title')).toBe('beef-nb-2lb');
  });
  it('beef liver', () => {
    expect(buildSnPrefix('Beef Liver - 2lb', '')).toBe('beef-liv-2lb');
  });
  it('beef vuri / bowels', () => {
    expect(buildSnPrefix('Beef Bowels (Vuri) - 2lb', '')).toBe('beef-vuri-2lb');
  });
  it('beef nalli / bone marrow', () => {
    expect(buildSnPrefix('Beef Nalli (Bone Marrow) - 2lb', '')).toBe('beef-nalli-2lb');
  });
  it('beef keema', () => {
    expect(buildSnPrefix('Beef Keema - 1lb', '')).toBe('beef-keem-1lb');
  });
  it('beef paya / feet', () => {
    expect(buildSnPrefix('Beef Feet (Paya) - 2lb', '')).toBe('beef-paya-2lb');
  });
});

// ─── Chicken ──────────────────────────────────────────────────────────────────

describe('chicken', () => {
  it('hard chicken with skin', () => {
    expect(buildSnPrefix('Hard Chicken', 'With Skin')).toBe('hard-chkn-ws');
  });
  it('hard chicken without skin', () => {
    expect(buildSnPrefix('Hard Chicken', 'Without Skin')).toBe('hard-chkn-wos');
  });
  it('hard chicken whole with skin', () => {
    expect(buildSnPrefix('Hard Chicken', 'Whole with Skin')).toBe('hard-chkn-whole-ws');
  });
  it('broiler', () => {
    expect(buildSnPrefix('Broiler Chicken', 'Default Title')).toBe('broiler');
  });
  it('red chicken standard', () => {
    expect(buildSnPrefix('Red Chicken - Standard', '')).toBe('red-chkn');
  });
  it('red chicken small', () => {
    expect(buildSnPrefix('Red Chicken - Small (Best for Roast)', '')).toBe('red-chkn-sm');
  });
  it('red chicken medium', () => {
    expect(buildSnPrefix('Red Chicken - Medium', '')).toBe('red-chkn-med');
  });
  it('red chicken xs/smallest', () => {
    expect(buildSnPrefix('Red Chicken (Smallest)', '')).toBe('red-chkn-xs');
  });
  it('chicken wings', () => {
    expect(buildSnPrefix('Chicken Wings', '2 lb')).toBe('chkn-wing-2lb');
  });
  it('chicken breast', () => {
    expect(buildSnPrefix('Chicken Breast - 1lb', '')).toBe('chkn-brs-1lb');
  });
  it('chicken liver', () => {
    expect(buildSnPrefix('Chicken Liver', '')).toBe('chkn-liv');
  });
  it('chicken gizzard', () => {
    expect(buildSnPrefix('Chicken Gizzard - 2lb', '')).toBe('chkn-giz-2lb');
  });
  it('guinea fowl', () => {
    expect(buildSnPrefix('Guinea Fowl', 'Default Title')).toBe('guinea');
  });
  it('cornish', () => {
    expect(buildSnPrefix('Small White Cornish', '')).toBe('cornish');
  });
});

// ─── Goat / Lamb ──────────────────────────────────────────────────────────────

describe('goat and lamb', () => {
  it('baby goat small regular pieces', () => {
    expect(buildSnPrefix('Baby Goat', 'Smaller regular pieces / 2 lb')).toBe('bgoat-2lb-reg');
  });
  it('baby goat larger biriyani pieces', () => {
    expect(buildSnPrefix('Baby Goat', 'Larger biriyani pieces / 2 lb')).toBe('bgoat-2lb-bir');
  });
  it('australian baby goat', () => {
    expect(buildSnPrefix('Australian Baby Goat', '2 lb / Regular Cut')).toBe('aus-bgoat-2lb-reg');
  });
  it('half baby goat', () => {
    expect(buildSnPrefix('Half Baby Goat', '')).toBe('half-bgoat');
  });
  it('imported goat', () => {
    expect(buildSnPrefix('Imported Goat - 2lb', '')).toBe('imp-goat-2lb');
  });
  it('mutton', () => {
    expect(buildSnPrefix('Mutton - 2lb', '')).toBe('mutton-2lb');
  });
  it('whole lamb', () => {
    expect(buildSnPrefix('Whole Lamb', '')).toBe('lamb-whole');
  });
  it('lamb chop', () => {
    expect(buildSnPrefix('Lamb Chop - 2lb', '')).toBe('lamb-chop-2lb');
  });
});

// ─── Spices (branded) ─────────────────────────────────────────────────────────

describe('branded spices / grains / seeds', () => {
  it('radhuni turmeric powder', () => {
    expect(buildSnPrefix('Radhuni Turmeric Powder - 200gm', 'Default Title')).toBe('radhuni-turmeric-200g');
  });
  it('shan biryani masala', () => {
    const sn = buildSnPrefix('Shan Chicken Biryani Masala - 50g', 'Default Title');
    expect(sn).toMatch(/^shan-/);
    expect(sn).toContain('50g');
  });
  it('pran mustard oil', () => {
    const sn = buildSnPrefix('Pran Mustard Oil - 1000ml', 'Default Title');
    expect(sn).toMatch(/^pran-/);
    expect(sn).toContain('1l');
  });
  it('egn chia seeds', () => {
    expect(buildSnPrefix('EGN Chia Seeds - 200GM', 'Default Title')).toBe('egn-chia-200g');
  });
  it('egn field bean seeds', () => {
    const sn = buildSnPrefix('PRIME Field Bean Seeds (Bari-1)', 'Default Title');
    expect(sn).toMatch(/^prime-/);
  });
  it('shahjalal brand', () => {
    const sn = buildSnPrefix('Shahjalal Turmeric Powder - 200gm', '');
    expect(sn).toMatch(/^shahjalal-/);
  });
  it('radhuni mustard oil 1000ml → 1l', () => {
    const sn = buildSnPrefix('Radhuni Mustard Oil - 1000ml', '');
    expect(sn).toContain('1l');
  });
  it('egn turmeric 1kg', () => {
    const sn = buildSnPrefix('EGN Turmeric Powder - 1 kg', '');
    expect(sn).toBe('egn-turmeric-1k');
  });
});

// ─── Size normalisation ───────────────────────────────────────────────────────

describe('size formatting', () => {
  it('200gm → 200g', () => expect(buildSnPrefix('Rohu Fish - 200gm', '')).toContain('200g'));
  it('1000gm → 1k',  () => expect(buildSnPrefix('Rohu Fish - 1000gm', '')).toContain('1k'));
  it('1200gm → 1k2', () => expect(buildSnPrefix('Rohu Fish - 1200gm', '')).toContain('1k2'));
  it('2 kg → 2k',   () => expect(buildSnPrefix('Rohu Fish - 2 kg', '')).toContain('2k'));
  it('3lb stays 3lb', () => expect(buildSnPrefix('Beef - 3lb', '')).toContain('3lb'));
  it('1000ml → 1l',  () => expect(buildSnPrefix('Radhuni Oil - 1000ml', '')).toContain('1l'));
});

// ─── Variant code extraction ──────────────────────────────────────────────────

describe('variant code extraction', () => {
  it('Default Title → no code', () => {
    const sn = buildSnPrefix('Katla Fish - 2 kg', 'Default Title');
    expect(sn).not.toMatch(/-(rc|ns|ws|wos|whole|reg|bir)$/);
  });
  it('Ready to cook → rc', () => expect(buildSnPrefix('Rohu Fish - 2 kg', 'Ready to cook')).toMatch(/-rc$/));
  it('Not Scaled → ns',    () => expect(buildSnPrefix('Rohu Fish - 2 kg', 'Not Scaled')).toMatch(/-ns$/));
  it('With Skin → ws',     () => expect(buildSnPrefix('Hard Chicken', 'With Skin')).toMatch(/-ws$/));
  it('Without Skin → wos', () => expect(buildSnPrefix('Hard Chicken', 'Without Skin')).toMatch(/-wos$/));
  it('Whole with Skin → whole-ws', () => expect(buildSnPrefix('Hard Chicken', 'Whole with Skin')).toMatch(/-whole-ws$/));
  it('Tehari Cut → tehari', () => expect(buildSnPrefix('Beef with Bone', 'Tehari Cut')).toMatch(/-tehari$/));
  it('Kacchi Cut → kacchi', () => expect(buildSnPrefix('Beef with Bone', 'Kacchi Cut')).toMatch(/-kacchi$/));
  it('Regular Cut → reg',   () => expect(buildSnPrefix('Beef with Bone', 'Regular Cut')).toMatch(/-reg$/));
  it('Larger biriyani pieces → bir', () => expect(buildSnPrefix('Baby Goat', 'Larger biriyani pieces')).toMatch(/-bir$/));
});

// ─── Slug sanitisation ────────────────────────────────────────────────────────

describe('slug output', () => {
  it('output is lowercase', () => {
    const sn = buildSnPrefix('ROHU FISH - 2 KG', 'READY TO COOK');
    expect(sn).toBe(sn.toLowerCase());
  });
  it('output contains only a-z, 0-9, hyphen', () => {
    const sn = buildSnPrefix('Radhuni Turmeric Powder - 200gm', '');
    expect(sn).toMatch(/^[a-z0-9-]+$/);
  });
  it('no double hyphens', () => {
    const sn = buildSnPrefix('Beef with Bone - 3lb', 'Tehari Cut');
    expect(sn).not.toContain('--');
  });
  it('no leading or trailing hyphens', () => {
    const sn = buildSnPrefix('Rohu Fish - 2 kg', '');
    expect(sn).not.toMatch(/^-|-$/);
  });
  it('strips Bengali Unicode', () => {
    const sn = buildSnPrefix('Rohu (Rui) Fish রুই - 2 kg', '');
    expect(sn).toMatch(/^[a-z0-9-]+$/);
  });
  it('strips emoji', () => {
    const sn = buildSnPrefix('🔥 Special Rohu Fish - 2 kg', '');
    expect(sn).toMatch(/^[a-z0-9-]+$/);
  });
  it('strips price text', () => {
    const sn = buildSnPrefix('Water Duck $24.99 - Limited Time', 'Whole');
    expect(sn).not.toContain('24');
    expect(sn).not.toContain('limited');
  });
});
