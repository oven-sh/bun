import { HotA, pingPong, throwAt } from "fake-shapes/hot";
export class HotB { n: number; kind = "B"; extra = true; constructor(n: number) { this.n = n; } value(): number { return this.n + 1000; } get twice(): number { return this.n * 2 + 1; } }
export class HotAB extends HotA { override kind = "AB"; override value(): number { return super.value() + 10; } }
export function sumNTyped(list: Array<{ n: number }>): number { let s = 0; for (const each of list) s += each.n; return s; }
export function sumValueTyped(list: Array<{ value(): number }>): number { let s = 0; for (const each of list) s += each.value(); return s; }
export function srcPing(n: number, back: (n: number, other: any) => number): number { return n <= 0 ? 0 : 1 + back(n - 1, srcPing); }
export function srcThrow(n: number, back: (n: number, other: any) => number): number { if (n <= 0) throw new TypeError("src bottom"); try { return back(n - 1, srcThrow); } catch (e) { throw e; } }
export const srcClosures: Array<(x: number) => number> = [x => x + 1, function (x: number) { return x + 2; }, Math.abs, (x: number) => pingPong(x % 3, srcPing), (x: number) => { try { return throwAt(x % 2, srcThrow); } catch { return -1; } }];
