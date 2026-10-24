export interface Shape {
  size: number;
  grow(by: number): Shape;
  readonly inner?: { depth: number };
}
export type Callback = (value: number) => string;
export type Pair<T> = { first: T; second: T };
export class Box {
  static count = 0;
  constructor(public width: number) {}
  area(): number {
    return this.width * this.width;
  }
}
export abstract class Base<T> {
  abstract make(): T;
}
export enum Color {
  Red,
  Green,
}
export namespace Units {
  export interface Meter {
    meters: number;
  }
}
export function unused(): number {
  return 1;
}
export const table = { a: 1, b: "two" };
export function guard(value: unknown): value is Shape {
  return typeof value === "object";
}
