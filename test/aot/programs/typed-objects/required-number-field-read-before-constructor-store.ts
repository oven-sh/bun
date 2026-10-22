// A required field of type number or boolean holds `undefined` from its definition until the constructor stores into it,
// and whatever untyped code puts there afterwards. Every read gives what plain Bun gives.

const seen: string[] = [];

function show(label: string, value: unknown): void {
  seen.push(`${label}: ${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`);
}

let leaked: Counter | undefined;

class Base {
  constructor() {
    this.inspect("base constructor");
  }
  inspect(_label: string): void {}
}

class Counter extends Base {
  count: number;
  ratio: number;
  done: boolean;

  constructor(count: number, ratio: number, done: boolean) {
    super();
    this.inspect("before the stores");
    leaked = this;
    readLeaked("leaked before the stores");
    this.count = count | 0;
    this.inspect("after the first store");
    this.ratio = ratio;
    this.done = done;
    this.inspect("after the stores");
  }

  override inspect(label: string): void {
    show(`${label}, count`, this.count);
    show(`${label}, ratio`, this.ratio);
    show(`${label}, done`, this.done);
    show(`${label}, has count`, "count" in this);
    show(`${label}, keys`, Object.keys(this).join());
  }
}

function readLeaked(label: string): void {
  const counter = leaked!;
  show(`${label}, count ^ 5`, counter.count ^ 5);
  show(`${label}, ratio + 1`, counter.ratio + 1);
  show(`${label}, !done`, !counter.done);
}

function readTyped(counter: Counter): string {
  return `${counter.count ^ 0} ${counter.count + 1} ${counter.ratio * 2} ${counter.done ? "yes" : "no"} ${counter.count} ${counter.ratio} ${counter.done}`;
}

function bump(counter: Counter): void {
  counter.count++;
  counter.ratio += 0.5;
  counter.done = !counter.done;
}

const counter = new Counter(7, 1.5, true);
show("typed reads", readTyped(counter));
bump(counter);
show("after bump", readTyped(counter));
console.log(seen.join("\n"));

const strangers: unknown[] = [
  undefined,
  null,
  NaN,
  -0,
  0,
  2 ** 31,
  2 ** 31 - 1,
  -(2 ** 31),
  -(2 ** 31) + 1,
  -(2 ** 31) + 2,
  -(2 ** 31) + 3,
  -(2 ** 31) + 4,
  -(2 ** 31) + 5,
  -(2 ** 31) - 1,
  0.5,
  Infinity,
  "text",
  true,
  false,
  { valueOf: () => 3 },
  10n,
];

for (const name of ["count", "ratio", "done"]) {
  for (const stranger of strangers) {
    const fresh = new Counter(1, 2, false);
    seen.length = 0;
    (fresh as any)[name] = stranger;
    let line: string;
    try {
      line = readTyped(fresh);
    } catch (error) {
      line = `threw ${(error as Error).constructor.name}`;
    }
    console.log(`${name} = ${typeof stranger} ${Object.is(stranger, -0) ? "-0" : typeof stranger === "object" && stranger ? "object" : String(stranger)}: ${line}`);
    try {
      bump(fresh);
      line = readTyped(fresh);
    } catch (error) {
      line = `threw ${(error as Error).constructor.name}`;
    }
    console.log(`  bumped: ${line}; keys ${Object.keys(fresh).join()}`);
    (fresh as any)[name] = name === "done" ? true : 4;
    console.log(`  restored: ${readTyped(fresh)}`);
  }
}

const deleted = new Counter(3, 4, true);
seen.length = 0;
delete (deleted as any).count;
console.log(`deleted: ${readTyped(deleted)}; keys ${Object.keys(deleted).join()}`);
deleted.count = 9;
console.log(`stored again: ${readTyped(deleted)}; keys ${Object.keys(deleted).join()}`);

const first = new Counter(11, 12.5, false);
console.log(seen.join("\n"));
console.log(readTyped(first));
(globalThis as any).keep = [Counter, Base, readTyped, bump, readLeaked];
