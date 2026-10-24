/**
 * @returns {number}
 */
export function count() {
  return JSON.parse('"7"');
}

/**
 * @param {number} n
 * @returns {string}
 */
export function label(n) {
  return JSON.parse(String(n));
}

/** @type {number[]} */
export const list = JSON.parse('{"length":2,"0":1,"1":"2"}');

/** @type {{ x: number, y: number }} */
export const point = JSON.parse('{"y":"2"}');

/** @type {(n: number) => number} */
export const step = JSON.parse("null") ?? (n => n + "!");

/**
 * @typedef {{ id: number, name: string }} Row
 */

/** @returns {Row} */
export function row() {
  return JSON.parse('{"name":5,"id":"one"}');
}

/**
 * @template T
 * @param {T} value
 * @returns {T[]}
 */
export function wrap(value) {
  return JSON.parse("null") ?? value;
}

export class Dog {
  constructor() {
    /** @type {number} */
    this.legs = JSON.parse('"four"');
    /** @type {string | undefined} */
    this.name = undefined;
  }

  /** @returns {number} */
  bark() {
    return JSON.parse("null");
  }
}

/**
 * @param {(n: number) => number} f
 * @returns {number[]}
 */
export function callBack(f) {
  return [f(JSON.parse('"8"')), f(JSON.parse("null"))];
}

/** @enum {number} */
export const Level = { Low: JSON.parse('"low"'), High: 2 };
