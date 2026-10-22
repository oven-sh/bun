interface Box {
  id: number;
  count?: number;
  label?: string;
  inner?: Box;
}

class Crate {
  id = 1;
  count?: number;
  declare label?: string;
  inner?: Box = undefined;
}

function countOf(b: Box): number | undefined {
  return b.count;
}

function labelOf(b: Box): string | undefined {
  return b.label;
}

function innerOf(b: Box): Box | undefined {
  return b.inner;
}

function copyMembers(from: Box, to: Box): void {
  to.count = from.count;
  to.label = from.label;
  to.inner = from.inner;
}

function state(b: Box): string {
  return Object.keys(b).join() + " " + JSON.stringify(b) + " " + ("count" in b) + ("label" in b) + ("inner" in b);
}

function deleted(): Box {
  const b: Box = { id: 2, count: 1, label: "l", inner: { id: 0 } };
  delete b.count;
  delete b.label;
  delete b.inner;
  return b;
}

function strippedCrate(): Box {
  const c: Box = new Crate();
  delete c.count;
  delete c.inner;
  return c;
}

const sources: [string, () => Box][] = [
  ["never there", () => ({ id: 1 })],
  ["deleted", deleted],
  ["undefined", () => ({ id: 3, count: undefined, label: undefined, inner: undefined })],
  ["a fresh instance", () => new Crate()],
  ["an instance with its fields deleted", strippedCrate],
];

async function throughAwait(b: Box): Promise<string> {
  const v = await b.count;
  return typeof v;
}

function* throughYield(b: Box): Generator<number | undefined> {
  yield b.count;
}

for (const [name, make] of sources) {
  const b = make();
  const n = countOf(b);
  const s = labelOf(b);
  const o = innerOf(b);
  console.log(name + ", kinds: " + typeof n + " " + typeof s + " " + typeof o);
  console.log(name + ", compared: " + (n === undefined) + " " + (s === undefined) + " " + (o === undefined) + " " + Object.is(n, undefined) + " " + (n == null) + " " + (n === s));
  console.log(name + ", two of them: " + (countOf(make()) === countOf(make())) + " " + (innerOf(make()) === innerOf(b)));
  console.log(name + ", as text: " + String(n) + " " + `${s}` + " " + (o + "") + " " + [n, s, o].join("|"));
  const list = [n, n];
  list.push(b.count);
  console.log(name + ", in a list: " + list.length + " " + JSON.stringify(list) + " " + (0 in list) + " " + list.includes(undefined) + " " + list.indexOf(undefined));
  const holder = { n, s, o };
  console.log(name + ", in a literal: " + Object.keys(holder).join() + " " + JSON.stringify(holder) + " " + ("n" in holder));
  const map = new Map([["k", n]]);
  console.log(name + ", in a map and a set: " + map.has("k") + " " + map.get("k") + " " + new Set([n, s, o]).size);
  console.log(name + ", defaults: " + (n ?? "d") + " " + ((p = 5) => p)(n) + " " + (([q = 6]: (number | undefined)[]) => q)([n]));
  console.log(name + ", arithmetic: " + (Number(n) + 1) + " " + ((n ?? 0) | 0) + " " + (o?.id ?? "none"));
  console.log(name + ", as arguments: " + ((...all: unknown[]) => all.length + ":" + all.map(v => typeof v).join())(n, s, o));
  const captured = () => n;
  console.log(name + ", captured: " + typeof captured());
  console.log(name + ", awaited: " + (await throughAwait(b)) + ", yielded: " + typeof throughYield(b).next().value);
  switch (n) {
    case undefined:
      console.log(name + ", switch: undefined");
      break;
    default:
      console.log(name + ", switch: something else");
  }
  const target: Box = { id: 9 };
  copyMembers(b, target);
  console.log(name + ", copied into a literal: " + state(target));
  const full: Box = { id: 10, count: 1, label: "l", inner: { id: 0 } };
  copyMembers(b, full);
  console.log(name + ", copied over values: " + state(full));
  const crate = new Crate();
  copyMembers(b, crate);
  console.log(name + ", copied into an instance: " + state(crate));
  console.log(name + ", cloned: " + state(structuredClone(b)) + " / spread: " + state({ ...b }));
}

const steady: Box = { id: 1, count: 1 };
let sum = 0;
for (let i = 0; i < 2000; i++) sum += countOf(steady) ?? 0;
console.log("2000 that have it: " + sum);
console.log("then: " + sources.map(([, make]) => String(countOf(make()))).join());

export {};
