// An heir of a typed object is the `this` of a method that declares `this: Large`. Any object passes a written `this` type, whatever the properties of the type are, and the method reads and stores through the heir as in plain JavaScript.
interface Small { weight: number; run(this: Small, x: number): number }
interface Large { weight: number; inner: { a: number }; run(this: Large, x: number): number }
function makeSmall(weight: number): Small { return { weight, run(x: number): number { return x + this.weight; } }; }
function makeLarge(weight: number): Large { return { weight, inner: { a: weight }, run(x: number): number { return x + this.weight; } }; }
const smalls: Small[] = [makeSmall(1), makeSmall(2)];
const larges: Large[] = [makeLarge(1), makeLarge(2)];
let sum = 0;
for (const s of smalls) sum += s.run(1);
for (const l of larges) sum += l.run(1) + l.inner.a;
console.log(sum);
const call = function (o: any, x: any): any { try { return o.run(x); } catch (error: any) { return error.constructor.name + ": " + String(error.message).split("\n")[0]; } };
console.log("heir of Small:", call(Object.create(smalls[0]!), 5));
console.log("heir of Large:", call(Object.create(larges[0]!), 5));
console.log("plain like Small:", call({ weight: 3, run: smalls[0]!.run }, 5));
console.log("plain like Large:", call({ weight: 3, inner: { a: 1 }, run: larges[0]!.run }, 5));
interface Wide { weight: number; inner: { a: number }; run(this: Wide, x: number): number }
function runWide(this: Wide, x: number): number { return x + this.weight; }
function makeWide(weight: number): Wide { return { weight, inner: { a: weight }, run: runWide }; }
const wides: Wide[] = [makeWide(1), makeWide(2)];
let wideSum = 0;
for (const w of wides) wideSum += w.run(1) + w.inner.a;
console.log(wideSum);
console.log("heir of Wide, whose method is a function declared on its own:", call(Object.create(wides[0]!), 5));
console.log("by call:", (function (f: any, o: any): any { try { return f.call(o, 5); } catch (error: any) { return error.constructor.name; } })(runWide, Object.create(wides[1]!)));
interface Counter { count: number; inner: { a: number }; bump(this: Counter): number }
function makeCounter(count: number): Counter { return { count, inner: { a: count }, bump(): number { this.count = this.count + 1; return this.count; } }; }
const counters: Counter[] = [makeCounter(1), makeCounter(5)];
let counted = 0;
for (const c of counters) counted += c.bump() + c.inner.a;
console.log(counted);
console.log("heir of Counter, whose method begins with a store to this:", (function (o: any): any { try { return [o.bump(), Object.keys(o).join(), Object.getPrototypeOf(o).count].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(counters[0]!)));
interface Tally { count: number; inner: { a: number }; reset(this: Tally, to: number): number }
function reset(this: Tally, to: number): number { this.count = to; return this.count + 1; }
function makeTally(count: number): Tally { return { count, inner: { a: count }, reset }; }
const tallies: Tally[] = [makeTally(1), makeTally(2)];
let tallied = 0;
for (const t of tallies) tallied += t.reset(3) + t.inner.a;
console.log(tallied);
console.log("heir of Tally, whose method is a declared function that begins with a store to this:", (function (o: any): any { try { return [o.reset(5), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(tallies[0]!)));
interface Gauge { level: number; inner: { a: number }; fill?: (this: Gauge, to: number) => number }
function fill(this: Gauge, to: number): number { this.level = to; return this.level * 2; }
const gauges: Gauge[] = [{ level: 1, inner: { a: 1 } }, { level: 2, inner: { a: 2 } }];
for (const g of gauges) g.fill = fill;
let gauged = 0;
for (const g of gauges) gauged += g.fill!(4) + g.inner.a;
console.log(gauged);
console.log("heir of Gauge, to which such a function was assigned:", (function (o: any): any { try { return [o.fill(5), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(gauges[0]!)));
interface Meter { level: number; inner: { a: number }; set(this: Meter, to: number): number }
function setMeter(this: Meter, to: number): number { this.level = to; return this.level + 3; }
const sameFunction = setMeter;
const meters: Meter[] = [{ level: 1, inner: { a: 1 }, set: sameFunction }, { level: 2, inner: { a: 2 }, set: sameFunction }];
let metered = 0;
for (const m of meters) metered += m.set(4) + m.inner.a;
console.log(metered);
console.log("heir of Meter, whose method went through a variable:", (function (o: any): any { try { return [o.set(5), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(meters[0]!)));
interface Dial { level: number; inner: { a: number }; turn?: (this: Dial, to: number) => number }
function turnDial(this: Dial, to: number): number { this.level = to; return this.level + 4; }
function attach(dial: Dial, turn: (this: Dial, to: number) => number): void { dial.turn = turn; }
const dials: Dial[] = [{ level: 1, inner: { a: 1 } }, { level: 2, inner: { a: 2 } }];
for (const d of dials) attach(d, turnDial);
let dialed = 0;
for (const d of dials) dialed += d.turn!(4) + d.inner.a;
console.log(dialed);
console.log("heir of Dial, whose method went through an argument:", (function (o: any): any { try { return [o.turn(5), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(dials[0]!)));
interface Scale { level: number; inner: { a: number } }
function setScale(this: Scale, to: number): number { this.level = to; return this.level + 5; }
const scales: Scale[] = [{ level: 1, inner: { a: 1 } }, { level: 2, inner: { a: 2 } }];
let scaled = 0;
for (const s of scales) scaled += setScale.call(s, 4) + s.inner.a;
console.log(scaled);
console.log("heir of Scale, handed over by call:", (function (o: any): any { try { return [setScale.call(o, 5), Object.keys(o).join()].join(" "); } catch (error: any) { return error.constructor.name; } })(Object.create(scales[0]!)));
