import { Dog } from "./dog.ts";

declare module "./dog.ts" {
  interface Dog {
    roll(times: number): number;
    sit(): string;
  }
}

export function installRoll(): void {
  Dog.prototype.roll = function (this: Dog, times: number): number {
    return this.legs * times;
  };
}

export function rollOf(dog: Dog, times: number): number {
  return dog.roll(times);
}
