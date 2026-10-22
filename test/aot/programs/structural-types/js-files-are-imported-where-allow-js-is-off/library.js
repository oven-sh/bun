/** @returns {number} */
export function tagged() {
  return "the tag is never read";
}

export function make(kind) {
  return { number: 3, text: "3", point: { x: 1, y: 2 }, texts: { y: "2", x: "1" } }[kind];
}

export class Pixel {
  constructor(x, y) {
    this.y = y;
    this.x = x;
  }
  sum() {
    return this.x + this.y;
  }
}

export let current = 1;

export function setCurrent(value) {
  current = value;
}
