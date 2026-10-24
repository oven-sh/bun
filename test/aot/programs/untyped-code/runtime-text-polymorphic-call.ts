// Call sites in functions created from text at run time call and construct compiled, bound, native, interpreted and proxy callees while each site goes from unlinked to monomorphic, polymorphic and virtual.
type Site = (callee: unknown, a: number) => unknown;
type Callee = (a: number) => unknown;
type Entries = [number, number][];

const createCallSite = () => new Function("f", "a", "return f(a)") as Site;
const createTailCallSite = () => new Function("f", "a", '"use strict"; return f(a)') as Site;
function createConstructSite(): Site {
  const site = new Function("C", "a", "return new C(a)") as (C: unknown, a: Entries) => unknown;
  return (C, a) => site(C, [[a, a + 1]]);
}

function double(a: number) {
  return a * 2;
}
function createCounter(): Callee {
  let calls = 0;
  return a => a + 1000 * ++calls;
}
class Scale {
  factor = 3;
  createArrow(): Callee {
    return a => a * this.factor;
  }
}
async function negate(a: number) {
  return -a;
}
function* countFrom(a: number) {
  yield a;
}
const adders: Callee[] = [];
for (let i = 0; i < 20; i++) adders.push(a => a + i * 100);
const arrow = new Scale().createArrow();
const decrement = new Function("a", "b", "return b === undefined ? a - 1 : NaN") as Callee;

class Pair {
  sum: number;
  constructor(entries: Entries) {
    this.sum = entries[0][0] + entries[0][1];
  }
}
function Product(this: { product: number }, entries: Entries) {
  this.product = entries[0][0] * entries[0][1];
}

const functions: [string, unknown][] = [
  ["function", double],
  ["closure", createCounter()],
  ["arrow", arrow],
  ["loop closure", adders[7]],
  ["bound function", double.bind(null)],
  ["Math.abs", Math.abs],
  ["String", String],
  ["async function", negate],
  ["generator function", countFrom],
  ["interpreted function", decrement],
  ["proxy", new Proxy(double, { apply: (target, _receiver, [a]) => target(a) + 0.5 })],
];
const constructors: [string, unknown][] = [
  ["class", Pair],
  ["function", Product],
  ["bound class", Pair.bind(null)],
  ["Map", Map],
];

const promises: Promise<number>[] = [];
function show(value: unknown): string {
  if (value instanceof Promise) {
    promises.push(value);
    return "Promise";
  }
  if (value instanceof Map) return "Map" + JSON.stringify([...value]);
  if (typeof value !== "object" || value === null) return String(value);
  const generator = value as Generator<number>;
  if (typeof generator.next === "function") return "Generator" + generator.next().value;
  return value.constructor.name + JSON.stringify(value);
}

function run(label: string, site: Site, callees: unknown[], calls = callees.length) {
  const results: string[] = [];
  for (let turn = 0; turn < calls; turn++) {
    try {
      results.push(show(site(callees[turn % callees.length], -1 - turn)));
    } catch (error) {
      results.push((error as Error).constructor.name);
    }
  }
  console.log(label + ": " + results.join(" "));
}

function runSequences(kind: string, createSite: () => Site, callees: [string, unknown][]) {
  callees.forEach(([name, callee], index) => {
    const [nextName, next] = callees[(index + 1) % callees.length];
    run(`${kind}, ${name}`, createSite(), [callee], 12);
    run(`${kind}, ${name} and ${nextName}`, createSite(), [callee, next], 12);
  });
  const all = callees.map(([, callee]) => callee);
  run(`${kind}, every callee`, createSite(), all, all.length * 3);
  run(`${kind}, every callee in reverse`, createSite(), [...all].reverse(), all.length * 3);
}

function runCallSequences(kind: string, createSite: () => Site) {
  const mixedClosures: unknown[] = [adders[0], String, adders[1], Math.abs, decrement];
  const warmUp: unknown[] = [Math.abs, decrement, Math.abs, decrement];
  const invalid: unknown[] = [...warmUp, undefined, Math.abs, 1, decrement, {}, Math.abs, Pair, decrement, double];
  runSequences(kind, createSite, functions);
  run(`${kind}, twenty closures of one function`, createSite(), adders, 40);
  run(`${kind}, closures of one function among others`, createSite(), mixedClosures, 15);
  run(`${kind}, invalid callees`, createSite(), invalid);
}

runCallSequences("call", createCallSite);
runCallSequences("tail call", createTailCallSite);
runSequences("construct", createConstructSite, constructors);
const invalidConstructors: unknown[] = [Map, Pair, Map, Pair, arrow, Pair, Math.abs, Product, undefined, Map, {}, Pair];
run("construct, invalid callees", createConstructSite(), invalidConstructors);
Promise.all(promises).then(values => {
  console.log(`${values.length} promises, sum ${values.reduce((sum, value) => sum + value, 0)}`);
});

export {};
