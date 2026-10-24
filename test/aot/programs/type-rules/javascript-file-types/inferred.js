/** @param {number} n */
export function half(n) { return n / 2; }
export class Meter {
  /** @type {number} */
  level = 0;
  /** @param {number} by */
  raise(by) { this.level += by; return this.level; }
}
/** @param {{ name: string }} p */
export function label(p) { return p.name; }
/** @param {(n: any) => unknown} f */
export function callWithText(f) { return f("8"); }
