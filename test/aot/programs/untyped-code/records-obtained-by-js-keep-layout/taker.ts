export interface Inner { v: number }
export interface Point { x: number; y: number; inner: Inner }
let held: Point | undefined;
const list: Point[] = [];
export function bump(p: Point): Point { p.x += 1; p.inner.v += 1; held = p; list.push(p); return p; }
export function seen(): number { return held ? held.x : -1; }
export function sumOfAll(): number { let sum = 0; for (const p of list) sum += p.x + p.y + p.inner.v; return sum; }
export function own(): Point { return { x: 10, y: 20, inner: { v: 30 } }; }
