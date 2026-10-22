import { half, halfLater, Point, Early } from "./inner/written-without-null-checks.ts";

function describe(n: number): string {
  return `${typeof n} ${n} ${n + 1} ${n | 0} ${n * 2 > 1}`;
}

console.log(describe(half(4)), "|", describe(half(-4)));
console.log(describe(await halfLater(4)), "|", describe(await halfLater(-4)));
const point = new Point();
console.log(describe(point.x), "|", describe(point.y), Object.keys(point).join());
const early = new Early();
console.log(early.seen, "|", describe(early.y));
let total = 0;
for (let i = -3; i < 4; i++) total += half(i) | 0;
console.log(total);
