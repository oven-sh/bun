function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface MaybeCount {
  count?: number;
}

interface MaybeList {
  name: string;
  items?: number[];
}

interface MaybeRun {
  name: string;
  run?: () => number;
}

function double(m: MaybeCount): number {
  return (m.count ?? 0) * 2;
}

function truncate(m: MaybeCount): number {
  return (m.count ?? 0) | 0;
}

function fixed(m: MaybeCount): string {
  return m.count === undefined ? "none" : m.count.toFixed(1);
}

function kind(m: MaybeCount): string {
  return typeof m.count;
}

function forget(value: {}): MaybeCount {
  return value;
}

const sources: [string, {}][] = [
  ["nothing", {}],
  ["a number", { count: 4 }],
  ["a string", { count: "12" }],
  ["a word", { count: "many" }],
  ["an array", { count: [3] }],
  ["an object", { count: { valueOf: () => 8 } }],
  ["null", { count: null }],
  ["true", { count: true }],
  ["a function", { count: () => 1 }],
  ["a big integer", { count: 5n }],
];

for (const [label, source] of sources) {
  const m = forget(source);
  attempt(label + ", typeof", () => kind(m));
  attempt(label + ", doubled", () => double(m));
  attempt(label + ", truncated", () => truncate(m));
  attempt(label + ", a method of the number", () => fixed(m));
  attempt(label + ", added to a number", () => (m.count ?? 0) + 1);
  attempt(label + ", compared", () => (m.count ?? 0) > 3);
}

let sum = 0;
const honest: MaybeCount = { count: 2 };
for (let i = 0; i < 2000; i++) sum += double(honest) + truncate(honest);
console.log("2000 honest: " + sum);
attempt("then a string", () => double(forget({ count: "12" })) + " " + truncate(forget({ count: "12" })));
attempt("then a big integer", () => double(forget({ count: 5n })));
attempt("then honest", () => double(honest));

const named = { name: "named", items: "abc" };
const onlyName: { name: string } = named;
const list: MaybeList = onlyName;
attempt("a string where an array may be, length", () => list.items?.length);
attempt("a string where an array may be, element", () => list.items?.[0]);
attempt("a string where an array may be, map", () => list.items?.map(n => n + 1).join());
attempt("a string where an array may be, for-of", () => {
  let total = 0;
  for (const n of list.items ?? []) total += n;
  return total;
});

const runner = { name: "runner", run: 5 };
const onlyRunnerName: { name: string } = runner;
const maybeRun: MaybeRun = onlyRunnerName;
attempt("a number where a function may be, optional call", () => maybeRun.run?.());
attempt("a number where a function may be, guarded by truthiness", () => (maybeRun.run ? maybeRun.run() : "none"));
attempt("a number where a function may be, guarded by typeof", () => (typeof maybeRun.run === "function" ? maybeRun.run() : "not a function"));

class Store {
  entry: MaybeCount = forget({ count: "7" });
  entries: MaybeCount[] = sources.map(row => forget(row[1]));
  total(): unknown {
    let total = this.entry.count ?? 0;
    for (const e of this.entries.slice(0, 4)) total += e.count ?? 0;
    return total;
  }
}
attempt("fields and elements", () => new Store().total());

const numbers: number[] = [];
for (const [, source] of sources.slice(0, 4)) numbers.push(forget(source).count ?? -1);
console.log("collected into a number array: " + JSON.stringify(numbers) + " " + numbers.map(n => typeof n).join());

export {};
