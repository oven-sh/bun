const log: string[] = [];

function lookUp(m: Map<string, number>, key: string): number | undefined {
  return m.get(key);
}

function count(m: Map<string, number>): string {
  let total = 0;
  for (const [, value] of m) total += value;
  m.forEach(value => (total += value));
  return total + " size " + m.size + " has " + m.has("a");
}

function put(m: Map<string, number>, key: string, value: number): number {
  m.set(key, value);
  return m.size;
}

function contains(s: Set<number>, n: number): boolean {
  return s.has(n);
}

function grow(s: Set<number>, n: number): number {
  return s.add(n).size;
}

function year(d: Date): number {
  return d.getUTCFullYear();
}

function stamp(d: Date): string {
  return d.getTime() + " " + +d + " " + d.toISOString() + " " + JSON.stringify(d);
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const m = new Map([
  ["a", 1],
  ["b", 2],
]);
const honestMap = new Map([["a", 1]]);
const s = new Set([1, 2]);
const d = new Date(0);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += (lookUp(m, "a") ?? 0) + (contains(s, 1) ? 1 : 0) + year(d) + count(m).length + (lookUp(honestMap, "a") ?? 0);
line("2000 honest", warm);
line("before", lookUp(m, "a") + " | " + count(m) + " | " + put(m, "c", 3) + " | " + contains(s, 5) + " | " + grow(s, 3) + " | " + year(d) + " | " + stamp(d));

m.get = key => {
  log.push("own get " + key);
  return -1;
};
m.has = () => false;
m.set = function (key, value) {
  log.push("own set " + key);
  return this;
};
m.forEach = () => {
  log.push("own forEach");
};
line("a map with own members", lookUp(m, "a") + " | " + count(m) + " | " + put(m, "d", 4) + " | keys " + [...m.keys()].join());
line("the honest map", lookUp(honestMap, "a") + " | " + count(honestMap));

m[Symbol.iterator] = function* (): Generator<[string, number], undefined, unknown> {
  log.push("own iterator");
  yield ["z", 26];
  return undefined;
};
line("an iterator of its own", count(m) + " | " + [...m].join(";") + " | " + new Map(m).size + " | " + [...m.entries()].length);

for (const key of Reflect.ownKeys(m)) Reflect.deleteProperty(m, key);
line("all removed", lookUp(m, "a") + " | " + count(m) + " | " + put(m, "d", 4));

s.has = () => true;
s.add = function (n) {
  log.push("own add " + n);
  return this;
};
line("a set with own members", contains(s, 99) + " | " + grow(s, 99) + " | " + [...s].join());
Reflect.deleteProperty(s, "has");
Reflect.deleteProperty(s, "add");
line("removed", contains(s, 99) + " | " + grow(s, 99));

d.getUTCFullYear = () => 3000;
d.getTime = () => 5;
d.valueOf = () => 6;
d.toISOString = () => "own iso";
line("a date with own members", year(d) + " | " + stamp(d));
d.toJSON = () => "own json";
line("and a toJSON", stamp(d));
for (const key of Reflect.ownKeys(d)) Reflect.deleteProperty(d, key);
line("removed", year(d) + " | " + stamp(d));

export {};
