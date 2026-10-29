import data from "./near-data.json";

const lines: string[] = [];
const say = (name: string, value: unknown) =>
  lines.push(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

say("a JSON module", data);

function shapes(count: number) {
  const made: Record<string, number>[] = [];
  for (let at = 0; at < count; at++) {
    const object: Record<string, number> = {};
    for (let key = 0; key <= at % 7; key++) object["k" + key] = at + key;
    made.push(object);
  }
  return made.reduce((sum, object) => sum + Object.values(object).reduce((a, b) => a + b, 0), 0);
}
say("objects of seven shapes", shapes(20000));

const callees = [
  (x: number) => x + 1,
  (x: number) => x * 2,
  (x: number) => x - 3,
  Math.abs,
  Math.floor,
  (x: number) => -x,
];
let total = 0;
for (let round = 0; round < 60000; round++) total = (total + callees[round % callees.length]!(round)) % 1000003;
say("a call site with six callees", total);

class Base {
  constructor(public value: number) {}
  get doubled() {
    return this.value * 2;
  }
  describe() {
    return `${this.constructor.name} ${this.doubled}`;
  }
}
class Derived extends Base {
  override describe() {
    return "derived " + super.describe();
  }
}
say("classes", [new Base(2).describe(), new Derived(3).describe()]);

function thrower(depth: number): number {
  if (depth === 0) throw new RangeError("the bottom");
  try {
    return thrower(depth - 1) + 1;
  } finally {
    total++;
  }
}
let caught = 0;
for (let round = 0; round < 300; round++) {
  try {
    thrower(round % 40);
  } catch (error) {
    if (error instanceof RangeError) caught++;
  }
}
say("thrown and caught", caught);

function deep(n: number): number {
  return n === 0 ? 0 : 1 + deep(n - 1);
}
try {
  deep(1e7);
  say("recursion", "no limit");
} catch (error) {
  say("recursion", (error as Error).name);
}

function* numbers(limit: number) {
  for (let at = 0; at < limit; at++) yield at;
}
say("a generator", [...numbers(5)]);
say("an async function", await (async () => (await Promise.all([1, 2, 3].map(async x => x * x))).join())());
say("the text of a native function", Math.max.toString());
say("bound", ((a: number, b: number) => a + b).bind(null, 2)(3));

const held: object[] = [];
for (let round = 0; round < 6; round++) {
  for (let at = 0; at < 30000; at++) held[at % 5000] = { at, text: "x" + at, list: [at] };
  Bun.gc(true);
}
say("six full collections", held.length);

const other = await import("./near-other.ts");
say("a module imported when asked for", other.answer());
say("a CommonJS module", require("./near-common.cjs").name);

console.log(lines.join("\n"));
