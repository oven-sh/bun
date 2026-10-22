// The literal type 0 is the integer: a union of objects whose tags are 0, 1 and 2 is told apart by the tag alone, as one whose tags are 1, 2 and 3. A -0 where TypeScript lets it pass for 0 behaves as in plain Bun
type Circle = { shape: 0; radius: number };
type Square = { shape: 1; side: number };
type Box = { shape: 2; width: number; height: number };
function area(s: Circle | Square | Box): number { return s.shape === 0 ? s.radius * s.radius * 3 : s.shape === 1 ? s.side * s.side : s.width * s.height; }
const shapes: (Circle | Square | Box)[] = [{ shape: 0, radius: 1 }, { shape: 1, side: 2 }, { shape: 2, width: 3, height: 4 }];

class Light { state: 0 | 1 | 2 = 0; next(): 0 | 1 | 2 { this.state = this.state === 2 ? 0 : this.state === 1 ? 2 : 1; return this.state; } }
function compare(a: number, b: number): -1 | 0 | 1 { return a < b ? -1 : a > b ? 1 : 0; }

// TypeScript has one type for 0 and -0.
const negative: 0 = -0;
let held: 0 | 1 = -0;
function pass(zero: 0): 0 { return zero; }
function comparedWithZero(x: number): number { return x === 0 ? 1 / x : 2; }
function keptAfterComparison(x: number): number { const kept: 0 | 1 = x === 0 ? x : 1; return 1 / kept; }
function switched(x: number): number { switch (x) { case 0: return 1 / x; default: return 3; } }
function ofUnknown(x: unknown): number { return x === 0 ? 1 / x : 4; }
const tagged: Circle = { shape: -0, radius: 2 };

let total = 0;
const light = new Light();
for (let i = 0; i < 3000; i++) total += area(shapes[i % 3]) + light.next() + compare(i & 3, 2);

// A stranger reaches the function, so that its parameter is not known from its callers alone.
const stranger: any = JSON.parse(process.argv[2] ?? "null");
if (stranger !== null) total += (area as any)(stranger);
console.log(total, 1 / negative, 1 / held, 1 / pass(-0), 1 / pass(0), Object.is(pass(-0), -0));
held = 1;
console.log(held, comparedWithZero(-0), comparedWithZero(0), keptAfterComparison(-0), keptAfterComparison(0), switched(-0), switched(0), ofUnknown(-0), ofUnknown(0));
console.log(1 / tagged.shape, area(tagged), Object.is(tagged.shape, -0));
