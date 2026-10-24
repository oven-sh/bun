import { secondReady } from "./second.ts";

export var count: number = 5;
export var title: string = "first";
export var list: number[] = [1, 2];
export let level: number = 6;
export const limit: number = 7;
export class Thing {
  static made: number = 0;
  size: number = 8;
}
export function helper(): number {
  return 9;
}
export function readsCount(): number {
  return count;
}
export function readsCountPlusOne(): number {
  return count + 1;
}
export function readsLimit(): number {
  return limit;
}
export function makesThing(): Thing {
  return new Thing();
}
export const arrow = (): number => 10;
export default 11;
export const sawSecond: boolean = secondReady;
