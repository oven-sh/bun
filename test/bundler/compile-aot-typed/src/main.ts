const out: unknown[] = [];

interface Pair { x: number; y: number }
function readsTyped(p: Pair) { return p.x + p.y; }
function readsUntyped(p: any) { return p.x + p.y; }
function writesTyped(p: Pair, v: number) { p.x = v; return p; }
function writesUntyped(p: any, v: number) { p.x = v; return p; }
function makesPair(i: number): Pair { return { x: i, y: i + 1 }; }
out.push(readsTyped(makesPair(1)), readsUntyped(makesPair(1)), writesTyped(makesPair(1), 5).x, writesUntyped(makesPair(1), 6).x);

interface Sound { a: number; b: number }
function readsSound(p: Sound) { return p.a + p.b; }
function writesSound(p: Sound, v: number) { p.a = v; return p; }
function makesSound(i: number): Sound { return { a: i, b: i + 1 }; }
out.push(readsSound(makesSound(1)), writesSound(makesSound(1), 5).a, readsSound({ b: 2, a: 1 }));

class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  add(o: Vector) { return new Vector(this.x + o.x, this.y + o.y); }
  get length2() { return this.x * this.x + this.y * this.y; }
}
class Loose {
  [key: string]: unknown;
  constructor(x: number) { this.x = x; }
}
function addsVectors(i: number) { return new Vector(i, 1).add(new Vector(2, i)).length2; }
function makesLoose(i: number) { return new Loose(i).x; }
out.push(addsVectors(1), makesLoose(3));

const parsed = JSON.parse('{"y":2,"x":1}') as Pair;
const reordered = { y: 4, x: 3 } as Pair;
const extra = { x: 5, y: 6, z: 7 } as Pair;
const wrongKinds = { x: "a", y: "b" } as unknown as Pair;
const missing = { x: 1 } as unknown as Pair;
const withGetter = { get x() { return 8; }, y: 9 } as Pair;
const inherited = Object.create({ x: 10, y: 11 }) as Pair;
const proxy = new Proxy({ x: 12, y: 13 }, {}) as Pair;
for (const p of [parsed, reordered, extra, wrongKinds, missing, withGetter, inherited, proxy]) out.push(readsTyped(p));
out.push(writesTyped(parsed, 20).x, writesTyped(extra, 21).x, writesTyped(inherited, 22).x, Object.keys(inherited).join());
out.push(String(writesTyped(wrongKinds, 23).x) + wrongKinds.y);
const frozen = Object.freeze({ x: 1, y: 2 }) as Pair;
try { "use strict"; writesTyped(frozen, 24); out.push("written"); } catch (e) { out.push((e as Error).constructor.name); }
out.push(frozen.x);

type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function area(s: Shape) { return s.kind === "circle" ? 3 * s.r * s.r : s.side * s.side; }
out.push(area({ kind: "circle", r: 2 }), area({ kind: "square", side: 3 }), area(JSON.parse('{"kind":"square","side":4}')));

console.log(out.join());
