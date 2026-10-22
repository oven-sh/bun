// Code made at run time reads a property that a typed object has and its type does not declare, many times at one place, so that what the interpreter remembers of the object is used.
declare const gc: undefined | (() => void);
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
interface Box {
  w: number;
  h: number;
}
interface Wide {
  a: number;
  b: string;
  c: boolean;
  d: number;
  e: string;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}
function hide(value: unknown): any {
  return value;
}
const makeBox = (): Box => ({ w: 3, h: 4 });
const makeWide = (): Wide => ({ a: 1, b: "b", c: true, d: 2.5, e: "e" });
const give = <T>(o: T, name: string, value: unknown): T => ((hide(o)[name] = value), o);
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (x === undefined ? "undefined" : x));
let texts = 0;
const makeLoop = (name: string) => new Function("o", "turns", "let last = " + texts++ + "; for (let i = 0; i < turns; i++) last = o." + name + "; return last;") as (o: unknown, turns: number) => unknown;
const readers: Record<string, (o: unknown) => unknown> = {};
for (const name of ["extra", "more", "w", "sum", "missing"]) readers[name] = new Function("o", "return o." + name + ";") as (o: unknown) => unknown;

function measure(label: string, run: () => unknown) {
  const result = run();
  console.log(label + ":", show(result));
}
measure("one more property on a record", () => makeLoop("extra")(give(makeBox(), "extra", "x"), 500));
measure("the second of two", () => makeLoop("more")(give(give(makeBox(), "extra", 1), "more", { m: 2 }), 500));
measure("on a record of five fields", () => makeLoop("extra")(give(makeWide(), "extra", 1.5), 500));
measure("on an instance of a class", () => makeLoop("extra")(give(new Point(1, 2), "extra", null), 500));
measure("many objects that got the same property", () => {
  const loop = makeLoop("extra");
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += loop(give(makeBox(), "extra", i), 10) as number;
  return sum;
});

{
  const several: unknown[] = [give(makeBox(), "extra", 0), give(new Point(1, 2), "extra", 1), JSON.parse('{"w":1,"extra":2}'), makeBox(), { extra: "own" }, give(makeWide(), "extra", 5)];
  console.log("objects of several kinds at one place:", show([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5].map(i => readers.extra(several[i]))));
}
{
  const box = give(makeBox(), "extra", 1);
  const again = () => Array.from({ length: 12 }, () => readers.extra(box))[11];
  console.log("it changes:", show([again(), (hide(box).extra = "two"), again(), (hide(box).extra = undefined), again()]));
  console.log("another comes behind it:", show([give(box, "more", "m") === box, again(), readers.more(box)]));
  console.log("it goes and comes again:", show([delete hide(box).extra, again(), give(box, "extra", 22) === box, again(), Object.keys(box).join()]));
  Object.defineProperty(box, "extra", { value: 23, writable: false, enumerable: true, configurable: true });
  console.log("it can no longer be written:", show(again()));
  let reads = 0;
  Object.defineProperty(box, "extra", { get: () => ++reads, enumerable: true, configurable: true });
  console.log("it is an accessor:", show([again(), reads]));
}
{
  const frozen = Object.freeze(give(makeBox(), "extra", "f"));
  const sealed = Object.seal(give(makeBox(), "extra", "s"));
  console.log("frozen and sealed:", show([readers.extra(frozen), readers.extra(frozen), readers.extra(frozen), readers.extra(sealed), readers.w(frozen), readers.missing(frozen)]));
}
{
  const old = Array.from({ length: 50 }, (_, i) => give(makeBox(), "extra", { i, text: "kept " + i }));
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < 2000; i++) [i, "garbage " + i];
    collect();
    if (!old.every((box, i) => show(readers.extra(box)) === show({ i, text: "kept " + i }))) console.log("lost in turn " + turn);
  }
  console.log("behind collections: all there");
}
