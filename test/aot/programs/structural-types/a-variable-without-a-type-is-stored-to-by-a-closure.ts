const table = [10, 20, 30, 40];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

class Counter {
  constructor(public n: number) {}
  next(): number {
    return this.n + 1;
  }
}

function afterACall(late: unknown, spoils: boolean): unknown {
  let value;
  const store = () => {
    value = late;
  };
  value = 1;
  if (spoils) store();
  const n: number = value;
  return [n, typeof n, n + 1, n * 2, table[n], plusOne(n), new Counter(n).next()];
}

function startsAsNull(late: unknown, spoils: boolean): unknown {
  let value = null;
  const store = () => {
    value = late;
  };
  value = "ab";
  if (spoils) store();
  const s: string = value;
  return [s, typeof s, s.length, s + "!", s.toUpperCase()];
}

function inALoop(late: unknown, at: number): unknown {
  let value;
  const store = () => {
    value = late;
  };
  let total = 0;
  for (let i = 0; i < 4; i++) {
    value = i;
    if (i === at) store();
    total += value;
  }
  return [total, typeof total];
}

function anObject(late: unknown, spoils: boolean): unknown {
  let value;
  const store = () => {
    value = late;
  };
  value = { x: 1, y: 2 };
  if (spoils) store();
  return [value.x, value.y, value.x + value.y, Object.keys(value).join()];
}

function aFunction(late: unknown, spoils: boolean): unknown {
  let value;
  const store = () => {
    value = late;
  };
  value = (n: number) => n + 1;
  if (spoils) store();
  return [value(1), value(1) + 1];
}

let shared;
function storeShared(late: unknown): void {
  shared = late;
}

function aModuleVariable(late: unknown, spoils: boolean): unknown {
  shared = 2;
  if (spoils) storeShared(late);
  const n: number = shared;
  return [n, n + 1, table[n], plusOne(n)];
}

const cases: [string, (late: unknown, spoils: boolean) => unknown][] = [
  ["after a call", afterACall],
  ["starts as null", startsAsNull],
  ["in a loop", (late, spoils) => inALoop(late, spoils ? 2 : -1)],
  ["an object", anObject],
  ["a function", aFunction],
  ["a module variable", aModuleVariable],
];

const late: [string, unknown][] = [
  ["a text", "3"],
  ["a fraction", 1.5],
  ["minus zero", -0],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
  ["a bigint", 3n],
  ["a list", [3]],
  ["an object with valueOf", { valueOf: () => 3 }],
  ["other members", { y: "2", x: "1", z: 0 }],
  ["a function that returns a text", () => "text"],
];

for (const [name, run] of cases) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run(0, false);
    rounds++;
  }
  attempt(name + ", honest after " + rounds + " rounds", () => run(0, false));
  for (const [what, value] of late) attempt(name + ", " + what, () => run(value, true));
  attempt(name + ", honest again", () => run(0, false));
}

export {};
