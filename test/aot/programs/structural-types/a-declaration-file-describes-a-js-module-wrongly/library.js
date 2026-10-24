export function count() {
  return "7";
}

export function label() {
  return 42;
}

export function list() {
  return { length: 2, 0: 1, 1: "2" };
}

export function point() {
  return { y: "2", get x() { return 1; } };
}

export function step() {
  return n => String(n) + "!";
}

export function maybe() {}

export const limit = "10";
export const version = 4;
export const names = new Set(["a", "b"]);
export let mutable = 1;

export function spoil() {
  mutable = "spoiled";
}

export class Dog {
  constructor(name) {
    this.title = name;
  }
  bark() {
    return "woof";
  }
}

export function takes(s, n) {
  return typeof s + ":" + typeof n;
}

export const Color = { Red: "red", Green: 5 };
export const Level = { Low: 10, High: 20 };

export function callBack(f) {
  return [f("8"), f(null), f()];
}

export default function main() {
  return null;
}
