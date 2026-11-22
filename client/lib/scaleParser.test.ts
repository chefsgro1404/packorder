import { describe, it, expect } from 'vitest';
import { parseScaleBuffer } from './scaleParser';

describe('parseScaleBuffer — weight only', () => {
  it('keeps the weight and throws away the ITEM number and price', () => {
    const result = parseScaleBuffer('ITEM 5   1.82 lb   $4.99/lb   $9.08\r\n');
    expect(result).toEqual({ success: true, itemWeight: '1.82 lb' });
    expect(result).not.toHaveProperty('itemNumber');
    expect(result).not.toHaveProperty('itemName');
  });

  it('gives the same result whatever item number the scale has recalled', () => {
    const a = parseScaleBuffer('ITEM 5   1.82 lb\r\n');
    const b = parseScaleBuffer('ITEM 0   1.82 lb\r\n');
    const c = parseScaleBuffer('ITEM 123   1.82 lb\r\n');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('accepts a weight-only signal with no ITEM line', () => {
    expect(parseScaleBuffer('   2.35 lb\r\n')).toEqual({ success: true, itemWeight: '2.35 lb' });
  });

  it('prefers the weight on the ITEM line over other weights in the buffer', () => {
    const buffer = 'TARE 0.05 lb\r\nITEM 7   3.10 lb   $2.00/lb\r\n';
    expect(parseScaleBuffer(buffer).itemWeight).toBe('3.10 lb');
  });

  it('falls back to any weight when the ITEM line has none', () => {
    expect(parseScaleBuffer('ITEM 7\r\n   1.20 lb\r\n').itemWeight).toBe('1.20 lb');
  });

  it('reports overload', () => {
    expect(parseScaleBuffer('OVERLOAD\r\n')).toEqual({ success: false, error: 'OVERLOAD' });
  });

  it('reports no weight when the buffer has none', () => {
    expect(parseScaleBuffer('ITEM 5   $4.99\r\n')).toEqual({ success: false, error: 'NO_WEIGHT' });
  });
});
