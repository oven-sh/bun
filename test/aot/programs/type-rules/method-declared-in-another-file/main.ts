// A function that begins with a store to `this` looks like a constructor function, but here another file stores it as a method, so its `this` may be anything that satisfies the type: an heir of a typed object too.
import { reset, fill as fillGauge, type Tally, type Gauge } from "./methods";
import turn, { type Dial } from "./default";
function makeTally(count: number): Tally { return { count, inner: { a: count }, reset }; }
const tallies: Tally[] = [makeTally(1), makeTally(2)];
const gauges: Gauge[] = [{ level: 1, inner: { a: 1 }, fill: fillGauge }, { level: 2, inner: { a: 2 }, fill: fillGauge }];
const dials: Dial[] = [{ level: 1, inner: { a: 1 }, turn }, { level: 2, inner: { a: 2 }, turn }];
let sum = 0;
for (const t of tallies) sum += t.reset(3) + t.inner.a;
for (const g of gauges) sum += g.fill(3) + g.inner.a;
for (const d of dials) sum += d.turn(3) + d.inner.a;
console.log(sum);
const call = function (o: any, name: string, x: any): any { try { return [o[name](x), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } };
console.log("the typed objects:", call(tallies[0], "reset", 5), "|", call(gauges[0], "fill", 5), "|", call(dials[0], "turn", 5));
console.log("heir; the method has the word export:", call(Object.create(tallies[0]!), "reset", 5));
console.log("heir; the method is named in an export list:", call(Object.create(gauges[0]!), "fill", 5));
console.log("heir; the method is the default export:", call(Object.create(dials[0]!), "turn", 5));
