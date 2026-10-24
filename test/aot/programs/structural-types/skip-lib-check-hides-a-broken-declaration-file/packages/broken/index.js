export function make(kind) {
  return { number: 3, text: "3", nothing: null, point: { x: 1, y: 2 }, texts: { y: "2", x: "1" }, list: [1, 2] }[kind];
}

export const limit = "10";

export function pair() {
  return ["1", 2];
}

export function nope() {
  return "nope";
}

export function list() {
  return [1, "2", null];
}

export function step() {
  return n => n + "!";
}

export function options() {
  return { size: "large", extra: 1 };
}

export class Widget {
  width = "wide";
  grow() {
    return this.width + 1;
  }
}

export const count = [1];

export function sound(n) {
  return n + 1;
}
