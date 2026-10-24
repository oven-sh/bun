function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Source {
  extra: number;
}
class Source {
  own: number = 1;
}

class Account {
  whole: number = 0;
  fraction: number = 0.5;
  constructor(public given: number = 7) {}
  add(n: number): void {
    this.whole += n;
  }
}

function same(n: number): number {
  return n;
}

function sum(a: number, b: number): number {
  return a + b;
}

function orTen(n: number = 10): number {
  return n;
}

function rest(...all: number[]): number[] {
  return all;
}

function* yields(n: number): Generator<number, number, number> {
  const sent: number = yield n;
  return sent;
}

async function later(n: number): Promise<number> {
  return n;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const account = new Account(i);
  account.whole = i;
  account.fraction = i + 0.5;
  warm += same(i) + sum(i, 0.5) + orTen(i) + rest(i, 1)[0] + account.whole + account.fraction + account.given;
}
show("2000 honest rounds", () => warm);

const source = new Source();

show("a local", () => {
  let n: number = 1;
  n = source.extra;
  return n;
});
show("a parameter and a result", () => [same(source.extra), sum(source.extra, 1), sum(1, source.extra)]);
show("a parameter with a default takes the default", () => orTen(source.extra));
show("a rest parameter", () => rest(1, source.extra, 3));
show("a field that held whole numbers", () => {
  const account = new Account();
  account.whole = source.extra;
  return [account.whole, typeof account.whole, account.whole + 1, JSON.stringify(account), Object.keys(account)];
});
show("a field that held fractions", () => {
  const account = new Account();
  account.fraction = source.extra;
  return [account.fraction, typeof account.fraction, account.fraction * 2];
});
show("a parameter property takes its default", () => new Account(source.extra).given);
show("a field that is added to", () => {
  const account = new Account();
  account.add(source.extra);
  return account.whole;
});
show("an element of a list of whole numbers", () => {
  const list: number[] = [1, 2, 3];
  list[1] = source.extra;
  return [list, list[1] + 1, 1 in list];
});
show("an element of a list of fractions", () => {
  const list: number[] = [1.5, 2.5, 3.5];
  list[1] = source.extra;
  return [list, list[1] + 1, 1 in list];
});
show("pushed", () => {
  const list: number[] = [1.5];
  list.push(source.extra);
  return [list, list.length];
});
show("a list made of it", () => {
  const list: number[] = [source.extra, source.extra];
  return [list, list.indexOf(source.extra), list.includes(source.extra), list.join("-")];
});
show("filled", () => new Array<number>(2).fill(source.extra));
show("sorted among numbers", () => [3, source.extra, 1].sort());
show("a captured variable", () => {
  const held: number = source.extra;
  const read = (): number => held;
  const raised = (): number => held + 1;
  return [read(), raised()];
});
show("a captured variable that is stored to later", () => {
  let held: number = 5;
  const read = (): number => held;
  held = source.extra;
  return read();
});
show("a tuple", () => {
  const pair: [number, number] = [source.extra, 2];
  const [first, second] = pair;
  return [first, second];
});
show("a value of a map and a member of a set", () => {
  const map = new Map<string, number>([["k", source.extra]]);
  const set = new Set<number>([source.extra]);
  return [map.get("k"), map.has("k"), set.has(source.extra), set.size];
});
show("a literal", () => {
  const point: { x: number; y: number } = { x: source.extra, y: 2 };
  return [point.x, point.x + point.y, Object.keys(point), JSON.stringify(point)];
});
show("a typed array takes it as NaN or zero", () => {
  const doubles = new Float64Array(1);
  const ints = new Int32Array([5]);
  doubles[0] = source.extra;
  ints[0] = source.extra;
  return [doubles[0], ints[0]];
});
show("yielded, sent and returned", () => {
  const run = yields(source.extra);
  return [run.next().value, run.next(source.extra).value];
});
const awaited: number = await later(source.extra);
show("awaited", () => [awaited, awaited + 1]);

export {};
