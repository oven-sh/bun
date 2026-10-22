let factor = 2;

/** @param {number} n */
export function double(n) {
  return n * factor;
}

/** @param {number[]} list */
export function total(list) {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

/**
 * @param {number} x
 * @param {number} y
 */
export function makePoint(x, y) {
  return { x, y };
}

export const settings = { depth: 1, name: "settings" };
export const sizes = Object.freeze({ small: 1, large: 2 });

export const counter = {
  count: 0,
  next() {
    return ++this.count;
  },
};

export class Basket {
  constructor() {
    /** @type {number[]} */
    this.items = [];
  }

  /** @param {number} n */
  add(n) {
    return this.items.push(n);
  }

  sum() {
    return total(this.items);
  }
}

/**
 * @this {Basket}
 * @param {number} n
 */
function replacement(n) {
  return this.items.push(JSON.parse('"' + n + '"'));
}

export function spoil() {
  factor = JSON.parse('"two"');
  settings.depth = JSON.parse('"deep"');
  settings.name = JSON.parse("null");
  counter.count = JSON.parse('"c"');
  Basket.prototype.add = replacement;
}
