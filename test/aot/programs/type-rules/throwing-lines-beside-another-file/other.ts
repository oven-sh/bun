import { type Point, report, scale, sum } from "./lines";

class Pixel implements Point { constructor(public x: number, public y: number) {} }
const table: Record<string, Function> = { sum, scale };
export function useOtherwise() {
  report("other.ts, an instance of a class", () => sum(new Pixel(1, 2)));
  report("other.ts, a proxy", () => sum(new Proxy({ x: 2, y: 3 }, {})));
  report("other.ts, inherited fields", () => sum(Object.create({ x: 3, y: 4 })));
  report("other.ts, as a value", () => table.sum({ x: 4, y: 5 }) + table.scale(1));
  report("other.ts, as a value with a boolean", () => table.scale(true));
}
