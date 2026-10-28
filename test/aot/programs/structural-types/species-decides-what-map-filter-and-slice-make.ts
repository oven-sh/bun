const log: string[] = [];

class Loud extends Array<number> {
  push(...items: number[]): number {
    log.push("loud push " + items.join());
    return super.push(...items.map(n => n * 10));
  }
  get first(): number {
    return this[0];
  }
}

class Same extends Array<number> {}

class ToPlain extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    log.push("species: plain");
    return Array;
  }
}

class ToLoud extends Array<number> {}

Object.defineProperty(ToLoud, Symbol.species, {
  get() {
    log.push("species: loud");
    return Loud;
  },
});

function kind(list: number[]): string {
  return list.constructor.name + " [" + list.join() + "] length " + list.length + " array " + Array.isArray(list);
}

function grow(list: number[]): string {
  const n = list.push(7);
  return n + " " + kind(list);
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " {" + log.join("; ") + "}");
  log.length = 0;
}

function fill<T extends number[]>(list: T): T {
  Array.prototype.push.call(list, 1, 2, 3, 4);
  return list;
}

const makers: [string, () => number[]][] = [
  ["a plain array", () => [1, 2, 3, 4]],
  ["a subclass", () => fill(new Same())],
  ["a subclass whose species is Array", () => fill(new ToPlain())],
  ["a subclass whose species is another subclass", () => fill(new ToLoud())],
];

const uses: [string, (list: number[]) => number[]][] = [
  ["map", list => list.map(n => n + 1)],
  ["filter", list => list.filter(n => n % 2 === 0)],
  ["slice", list => list.slice(1, 3)],
  ["splice", list => list.splice(1, 2)],
  ["concat", list => list.concat([9])],
  ["flat", list => list.flat()],
  ["flatMap", list => list.flatMap(n => [n, n])],
  ["toSorted", list => list.toSorted((a, b) => b - a)],
  ["toReversed", list => list.toReversed()],
  ["with", list => list.with(0, 100)],
  ["spread", list => [...list]],
  ["Array.from", list => Array.from(list)],
];

for (const [name, make] of makers) {
  for (const [use, run] of uses) line(name + ", " + use, kind(run(make())));
  line(name + ", then push into what map made", grow(make().map(n => n)));
  line(name + ", then push into what filter made", grow(make().filter(() => true)));
}

function doubledSum(list: number[]): number {
  const doubled = list.map(n => n * 2);
  doubled.push(1);
  let sum = 0;
  for (let i = 0; i < doubled.length; i++) sum += doubled[i];
  return sum;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += doubledSum([1, 2, 3]);
line("2000 honest", String(warm));
for (const [name, make] of makers) line("then " + name, String(doubledSum(make())));

export {};
