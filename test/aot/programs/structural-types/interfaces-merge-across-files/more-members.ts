import { Dog, Point } from "./shapes.ts";

declare module "./shapes.ts" {
  interface Point {
    z: number;
    label: string;
    norm(): number;
  }
  interface Dog {
    tail: { length: number };
    wag(): number;
  }
}

export function volume(p: Point): number {
  return p.x * p.y * p.z;
}

export function tailLength(d: Dog): number {
  return d.tail.length;
}

export function installWag(): void {
  Dog.prototype.wag = function (this: Dog): number {
    return this.legs * 10;
  };
}
