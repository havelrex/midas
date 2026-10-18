export const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

// Whole dollars when exact, otherwise cents: $296, $296.50.
export const money = (n: number) => {
  const cents = Math.round(n * 100) / 100;
  return `$${Number.isInteger(cents) ? cents : cents.toFixed(2)}`;
};

// "WH-1000XM5", "wh1000xm5" and "WH 1000XM5" are the same model. Used for history files, caches and demo state.
export const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const productKey = (brand: string, model: string) => `${alnum(brand)}|${alnum(model)}`;
