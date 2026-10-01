export interface Point { x: number; y: number }
export const origin: Point = { x: 0, y: 0 };
export let counter = 0;
export function bump(by: number): number { counter += by; return counter; }
export function makePoint(x: number, y: number): Point { return { x, y }; }
export class Vec { constructor(public x: number, public y: number) {} plus(o: Vec): Vec { return new Vec(this.x + o.x, this.y + o.y); } get len(): number { return Math.hypot(this.x, this.y); } static zero = new Vec(0, 0); }
export class Vec3 extends Vec { z = 1; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } override plus(o: Vec): Vec3 { return new Vec3(this.x + o.x, this.y + o.y, this.z); } }
export class NoCtor { tag = "none"; list: number[] = []; }
export function OldStyle(this: any, n: number) { this.n = n; }
OldStyle.prototype.twice = function () { return this.n * 2; };
export function plain(n: number) { return { n }; }
