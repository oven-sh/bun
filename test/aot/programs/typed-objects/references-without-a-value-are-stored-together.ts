// An object is born with a constant in every reference that has no value yet. Neighbors are stored together.
// SIZE< Panel 80
class Knot {
  a?: Knot; b?: Knot; c?: Knot; d?: Knot; e?: Knot; f?: Knot; g?: Knot; h?: Knot;
  i: Knot | null = null; j: Knot | null = null; k: Knot | null = null; l: Knot | null = null;
  m?: string; n?: string; o?: string; p?: string;
  size: number;
  constructor(size: number) { this.size = size; }
}
const kept: Knot[] = [];
function bear(size: number): Knot { const knot = new Knot(size); kept.push(knot); return knot; }
function look(knot: Knot): string {
  return [knot.a, knot.b, knot.c, knot.d, knot.e, knot.f, knot.g, knot.h, knot.i, knot.j, knot.k, knot.l, knot.m, knot.n, knot.o, knot.p]
    .map(value => value === undefined ? "u" : value === null ? "n" : typeof value === "string" ? value : String(value.size)).join("");
}
interface Pins { a: Knot | null; b: Knot | undefined; c: Knot | null; d: Knot | undefined; e: null; f: undefined; g: Knot | null; h: Knot | null; }
function pin(): Pins { const pins: Pins = { a: null, b: undefined, c: null, d: undefined, e: null, f: undefined, g: null, h: null }; held.push(pins); return pins; }
const held: Pins[] = [];
for (let i = 0; i < 40; i++) bear(i);
console.log(look(kept[0]), Object.keys(kept[0]).join(""), kept.length);
const first = kept[1], other = kept[2];
first.b = other; first.e = other; first.h = other; first.i = other; first.l = other; first.m = "x"; first.p = "y";
console.log(look(first));
first.a = other; first.b = undefined; first.j = other; first.i = null; first.n = "z"; first.m = undefined;
console.log(look(first), look(kept[3]));
let garbage: unknown[] = [];
for (let round = 0; round < 100; round++) { garbage = []; for (let i = 0; i < 500; i++) garbage.push(bear(i)); kept.length = 40; }
console.log(look(first), look(kept[39]), look(garbage[499] as Knot), garbage.length);
const pins = pin();
console.log(JSON.stringify(pins), Object.keys(pins).join(""), pins.b === undefined, pins.f === undefined, pins.h);
pins.b = first; pins.g = other;
console.log(pins.a, pins.b!.size, pins.c, pins.d, pins.e, pins.f, pins.g!.size, pins.h, [bear, look, pin].map(one => one.name).join());
class Panel {
  n: number;
  a = (x: number) => x + this.n; b = (x: number) => x - this.n; c = (x: number) => x * this.n; d = (x: number) => x + 1; e = (x: number) => x + 2; f = (x: number) => x + 3;
  g = (x: number) => x + 4; h = (x: number) => x + 5; i = (x: number) => x + 6; j = (x: number) => x + 7; k = (x: number) => x + 8; l = (x: number) => x + 9;
  m = (x: number) => x + 10; o = (x: number) => x + 11; p = (x: number) => x + 12; q = (x: number) => x + 13; r = (x: number) => x + 14; s = (x: number) => x + 15;
  t = (x: number) => x + 16; u = (x: number) => x + 17; v = (x: number) => x + 18; w = (x: number) => x + 19; y = (x: number) => x + 20; z = (x: number) => x + 21;
  constructor(n: number) { this.n = n; }
}
const panels: Panel[] = [];
function mount(n: number): Panel { const panel = new Panel(n); panels.push(panel); return panel; }
for (let i = 0; i < 10; i++) mount(i);
const third = panels[3];
console.log([third.a, third.b, third.c, third.d, third.l, third.m, third.y, third.z].map(one => one(2)).join(), third.z === third.z, third.a === panels[4].a, Object.keys(third).join(""), mount.name);
