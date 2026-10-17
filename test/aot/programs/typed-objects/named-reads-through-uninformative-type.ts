// Fields of class instances and records, and accessors of every origin, read and written by name through `any`: each site sees many shapes, and values at the edges of what a field holds in place.
const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (JSON.stringify(value, (_, v) => (v === undefined ? "<undefined>" : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v)) ?? String(value)));
}
class Leaf { constructor(public label: string) {} }
class Holder {
  leaf: Leaf | null | undefined;
  count: number;
  ratio: number;
  flag: boolean;
  maybeFlag?: boolean;
  text: string;
  maybeText?: string;
  anything: unknown;
  maybeCount?: number;
  constructor(leaf: Leaf | null | undefined, count: number, ratio: number, flag: boolean, text: string, anything: unknown) {
    this.leaf = leaf; this.count = count; this.ratio = ratio; this.flag = flag; this.text = text; this.anything = anything;
  }
  get doubled(): number { return this.count * 2; }
  set doubled(value: number) { this.count = value / 2; }
  describe(): string { return this.text + ":" + this.count; }
}
class Derived extends Holder {
  extra = "extra";
  get doubled(): number { return this.count * 4; }
}
interface Pair { leaf: Leaf; count: number }

function readLeaf(o: any) { return o.leaf; }
function readCount(o: any) { return o.count; }
function readRatio(o: any) { return o.ratio; }
function readFlag(o: any) { return o.flag; }
function readMaybeFlag(o: any) { return o.maybeFlag; }
function readText(o: any) { return o.text; }
function readMaybeText(o: any) { return o.maybeText; }
function readAnything(o: any) { return o.anything; }
function readMaybeCount(o: any) { return o.maybeCount; }
function readDoubled(o: any) { return o.doubled; }
function readExtra(o: any) { return o.extra; }
function readDescribe(o: any) { return typeof o.describe; }
function callDescribe(o: any) { return o.describe(); }
function writeCount(o: any, v: any) { o.count = v; }
function writeLeaf(o: any, v: any) { o.leaf = v; }
function writeDoubled(o: any, v: any) { o.doubled = v; }
function attempt(f: (...rest: any[]) => unknown, ...rest: unknown[]) {
  try { return f(...rest); } catch (error) { return (error as Error).constructor.name; }
}
function all(o: unknown) {
  return [readLeaf, readCount, readRatio, readFlag, readMaybeFlag, readText, readMaybeText, readAnything, readMaybeCount, readDoubled, readExtra, readDescribe, callDescribe].map(f => attempt(f, o));
}

const counts = [0, -0, 1, -1, 2 ** 29, 2 ** 30 - 1, 2 ** 30, -(2 ** 30), -(2 ** 30) - 1, 2 ** 31 - 1, -(2 ** 31), 2 ** 31, 2 ** 32, 0.5, -1.5, NaN, Infinity, 1e300];
for (const count of counts) {
  const holder = new Holder(new Leaf("l" + count), count, count / 3, count > 0, "t" + count, count);
  say("count " + count, [all(holder), all(new Derived(null, count, count, false, "", undefined))]);
}
{
  const pair: Pair = { leaf: new Leaf("pair"), count: 7 };
  const objects: unknown[] = [
    new Holder(undefined, 1, 2, true, "a", null), new Holder(null, 1, 2, true, "a", { deep: 1 }), new Derived(new Leaf("d"), 3, 4, false, "b", [1]), pair,
    JSON.parse('{"leaf":1,"count":"plain","doubled":"data"}'), Object.create(new Holder(new Leaf("proto"), 9, 9, true, "proto", 9)), Object.create(null), [], "text", 5, null, undefined,
  ];
  for (let round = 0; round < 3; round++) say("objects " + round, objects.map(all));
  for (const o of objects) {
    say("written", [attempt(writeCount, o, 2 ** 31), attempt(readCount, o), attempt(writeCount, o, -5), attempt(readCount, o), attempt(writeCount, o, 1.25), attempt(readCount, o), attempt(writeLeaf, o, null), attempt(readLeaf, o), attempt(writeLeaf, o, new Leaf("new")), attempt(readLeaf, o), attempt(writeDoubled, o, 10), attempt(readDoubled, o), attempt(readCount, o)]);
  }
}
{
  const holder = new Holder(new Leaf("x"), 1, 1, true, "x", 1);
  holder.maybeFlag = false; holder.maybeText = ""; holder.maybeCount = 0;
  say("optional members present", all(holder));
  holder.maybeFlag = undefined; holder.maybeText = undefined; holder.maybeCount = undefined;
  say("optional members undefined", all(holder));
  delete holder.maybeFlag; delete holder.maybeText; delete holder.maybeCount;
  say("optional members deleted", all(holder));
  (Holder.prototype as any).maybeText = "from the prototype";
  say("an absent member is found on the prototype", [readMaybeText(holder), readMaybeText(new Derived(null, 1, 1, true, "", 0))]);
  delete (Holder.prototype as any).maybeText;
  say("and no longer", [readMaybeText(holder), readMaybeText(new Derived(null, 1, 1, true, "", 0))]);
}
{
  const made = (n: number) => ({ tag: n, get doubled() { return n * 2; }, get thrower(): number { throw new RangeError("no " + n); } });
  function readThrower(o: any) { return o.thrower; }
  const several = [made(1), made(2), made(3)];
  for (let round = 0; round < 3; round++) say("own accessors of one shape", several.map(o => [readDoubled(o), attempt(readThrower, o)]));
  let kept = 0.5;
  for (const o of several) { kept += 0.25; try { kept += readThrower(o); } catch { kept += readDoubled(o) + 0.125; } }
  say("a double is kept across accessors", kept);
  const derived = new Derived(null, 5, 1, true, "", 0);
  say("before", [readDoubled(derived), readDoubled(new Holder(null, 5, 1, true, "", 0))]);
  Object.defineProperty(Derived.prototype, "doubled", { get() { return "redefined"; }, configurable: true });
  say("redefined", [readDoubled(derived), readDoubled(new Holder(null, 5, 1, true, "", 0))]);
  delete (Derived.prototype as any).doubled;
  say("deleted", [readDoubled(derived), readDoubled(new Holder(null, 5, 1, true, "", 0))]);
  Object.defineProperty(Holder.prototype, "doubled", { value: "data now", configurable: true, writable: true });
  say("data", [readDoubled(derived), readDoubled(new Holder(null, 5, 1, true, "", 0))]);
  Object.defineProperty(derived, "doubled", { get() { return "own"; }, configurable: true });
  say("own", [readDoubled(derived), readDoubled(new Derived(null, 5, 1, true, "", 0))]);
  Object.setPrototypeOf(Derived.prototype, { doubled: "another chain", describe() { return "other"; } });
  say("another chain", [readDoubled(new Derived(null, 5, 1, true, "", 0)), attempt(callDescribe, new Derived(null, 5, 1, true, "", 0))]);
}
console.log(lines.join("\n"));
