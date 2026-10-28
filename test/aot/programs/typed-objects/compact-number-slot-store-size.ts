// A store of `number | null` into a compact (32-bit) number slot: the range check is two instructions on ARM64, and the slow path passes the number unboxed.
// SIZE< putNullable 200
type Point = { x: number; y: number; label: string };
type Opt = { x: number; y?: number; label?: string };
type Cat = { kind: "cat"; lives: number; name: string };
type Dog = { kind: "dog"; name: string; lives: number };
type Pet = Cat | Dog;
type Holder = { p: Point; n: number | null; list: number[] };
export function putNumber(p: Point) { p.x = 1; }
export function putNumberOf(p: Point, n: number) { p.x = n; }
export function putString(p: Point, s: string) { p.label = s; }
export function putOptional(p: Opt) { p.y = 2; }
export function putOptionalString(p: Opt, s: string) { p.label = s; }
export function putUnion(p: Pet, n: number) { p.lives = n; }
export function putUnionString(p: Pet, s: string) { p.name = s; }
export function putObject(h: Holder, p: Point) { h.p = p; }
export function putNullable(h: Holder, n: number | null) { h.n = n; }
export function putArray(h: Holder, l: number[]) { h.list = l; }
export function make(): [Point, Opt, Pet, Pet, Holder] { const p: Point = { x: 1, y: 2, label: "a" }; return [p, { x: 3 }, { kind: "cat", lives: 9, name: "c" }, { kind: "dog", name: "d", lives: 1 }, { p, n: null, list: [] }]; }
const [p, o, c, d, h] = make();
putNumber(p); putNumberOf(p, 2); putString(p, "b"); putOptional(o); putOptionalString(o, "s"); putUnion(c, 1); putUnion(d, 2); putUnionString(c, "x"); putObject(h, p); putNullable(h, 1); putArray(h, [1]);
console.log(p.x + (o.y ?? 0) + c.lives + h.list.length);
