import type { Point } from "./reader.ts";

export const log: string[] = [];

export class Reversed {
  y = 4;
  x = 3;
}

export function flipped(): Point {
  return { y: 2, x: 1 };
}

export function wide(): Point {
  const all = { a: "a", y: 6, b: "b", x: 5, c: "c" };
  return all;
}

export function accessors(): Point {
  let x = 7;
  return {
    get x() {
      log.push("get x");
      return x;
    },
    set x(value: number) {
      log.push("set x " + value);
      x = value;
    },
    y: 8,
  };
}

export function inherited(): Point {
  return Object.create({ x: 9, y: 10 });
}

export function frozen(): Point {
  return Object.freeze({ x: 11, y: 12 });
}

export const makers: [string, () => Point][] = [
  ["flipped", flipped],
  ["wide", wide],
  ["a class", () => new Reversed()],
  ["accessors", accessors],
  ["inherited", inherited],
  ["frozen", frozen],
];
