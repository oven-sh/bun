// `@ts-ignore` hides the three errors that `strictNullChecks` only reports. The declared `number` holds `undefined` at run time, as in plain Bun.
function half(n: number): number {
  // @ts-ignore
  if (n < 0) return;
  return n / 2;
}
class Point {
  // @ts-ignore
  x: number;
}
class Early {
  y: number;
  seen: string;
  constructor() {
    // @ts-ignore
    this.seen = typeof this.y + " " + (this.y + 1);
    this.y = 1;
  }
}
function describe(n: number): string {
  return `${typeof n} ${n} ${n + 1} ${n | 0} ${n * 2 > 1}`;
}
console.log(describe(half(4)), "|", describe(half(-4)));
console.log(describe(new Point().x));
const early = new Early();
console.log(early.seen, "|", describe(early.y));
let total = 0;
for (let i = -3; i < 4; i++) total += half(i) | 0;
console.log(total);
