function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

interface Tally {
  (): number;
  calls: number;
  label: string;
}

function declared(): number {
  return ++declared.calls;
}
declared.calls = 0;
declared.label = "declared";

const arrow = (): number => ++arrow.calls;
arrow.calls = 0;
arrow.label = "arrow";

const assigned: Tally = Object.assign(function (): number {
  return ++assigned.calls;
}, { calls: 0, label: "assigned" });

function withGetter(): Tally {
  let reads = 0;
  const f = Object.assign((): number => reads, { calls: 0, label: "getter" });
  Object.defineProperty(f, "calls", { get: () => ++reads * 100, set: () => {}, enumerable: true });
  return f;
}

function frozen(): Tally {
  return Object.freeze(Object.assign((): number => -1, { calls: 5, label: "frozen" }));
}

function proxied(): Tally {
  return new Proxy(assigned, {
    apply: () => 1000,
    get: (target, key, receiver) => (key === "label" ? "proxied" : Reflect.get(target, key, receiver)),
  });
}

class Static {
  static calls = 0;
  static label = "static";
}

function use(tally: Tally): string {
  const before = tally.calls;
  let result: string;
  try {
    result = text(tally());
  } catch (error) {
    result = failure(error);
  }
  let stored: string;
  try {
    tally.calls += 10;
    stored = "stored";
  } catch (error) {
    stored = failure(error);
  }
  return tally.label + ": before " + text(before) + ", result " + result + ", " + stored + ", after " + text(tally.calls) + ", keys " + Object.keys(tally).join() + ", copy " + JSON.stringify({ ...tally });
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += declared();
console.log("2000 calls: " + warm + ", calls " + declared.calls);

const tallies: [string, () => Tally][] = [
  ["declared", () => declared],
  ["arrow", () => arrow],
  ["assigned", () => assigned],
  ["a getter", withGetter],
  ["frozen", frozen],
  ["a proxy", proxied],
];
for (const [label, make] of tallies) console.log(label + " | " + use(make()));
console.log("declared again | " + use(declared));

interface Sized {
  name: string;
  length: number;
}
function sizeOf(sized: Sized): string {
  return text(sized.name) + " " + text(sized.length);
}
function three(a: number, b: number, c: number): number {
  return a + b + c;
}
const renamed = Object.defineProperty((a: number): number => a, "name", { value: "renamed" });
const resized = Object.defineProperty((a: number): number => a, "length", { value: 99 });
console.log("every function has a name and a length: " + [sizeOf(three), sizeOf(declared), sizeOf(Static), sizeOf(renamed), sizeOf(resized), sizeOf({ name: "literal", length: 1 })].join(" | "));

const bound = declared.bind(null);
console.log("a bound copy has none of the members: " + Object.keys(bound).join() + "|" + ("calls" in bound));

interface Removable {
  (): string;
  cache?: string;
}
const cached: Removable = () => (cached.cache ??= "computed");
console.log("a cache on the function: " + text(cached.cache) + " " + cached() + " " + text(cached.cache) + " " + delete cached.cache + " " + text(cached.cache) + " " + Object.keys(cached).length);

function memo(n: number): number {
  const hit = memo.table.get(n);
  if (hit !== undefined) return hit;
  const value = n < 2 ? n : memo(n - 1) + memo(n - 2);
  memo.table.set(n, value);
  return value;
}
memo.table = new Map<number, number>();
console.log("a table on the function: " + memo(50) + " " + memo.table.size);

namespace declared {
  export const merged = "from a namespace";
}
console.log("merged with a namespace: " + declared.merged + " " + Object.keys(declared).join());
