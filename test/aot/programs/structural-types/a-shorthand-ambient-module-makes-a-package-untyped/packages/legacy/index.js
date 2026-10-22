export function make(kind) {
  return { number: 3, text: "3", nothing: null, point: { x: 1, y: 2 }, texts: { y: "2", x: "1" }, list: [1, 2] }[kind];
}

export const limit = "10";

export class Widget {
  constructor(width) {
    this.width = width;
  }
  grow() {
    return this.width + 1;
  }
}

export function call(f, ...operands) {
  return f(...operands);
}

export default function legacy() {
  return "the default";
}
