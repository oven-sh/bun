// The smallest program in which a declared type stayed closed to an object that satisfies it: an heir of a typed object, as the `this` of a method that declares `this: Large`. Large has a property that is an object, so it was not opened as a flat type is.
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
