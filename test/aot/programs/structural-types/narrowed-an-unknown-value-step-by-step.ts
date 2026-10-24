function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Point {
  x: number;
  y: number;
}

function isPoint(v: unknown): v is Point {
  return typeof v === "object" && v !== null && "x" in v && typeof v.x === "number" && "y" in v && typeof v.y === "number";
}

function sum(v: unknown): unknown {
  if (isPoint(v)) return [v.x, v.y, v.x + v.y, v.x * v.y];
  return "not a point";
}

function stepByStep(v: unknown): unknown {
  if (typeof v !== "object") return "no object: " + typeof v;
  if (v === null) return "null";
  if (!("x" in v)) return "no x";
  if (typeof v.x !== "number") return "x is a " + typeof v.x;
  return [v.x, v.x + 1, v.x * 2];
}

function listOfNumbers(v: unknown): unknown {
  if (!Array.isArray(v)) return "no array";
  if (!v.every(n => typeof n === "number")) return "not all numbers";
  let total = 0;
  for (const n of v) total += n;
  return [v.length, total];
}

class Real {
  x = 1;
  y = 2;
}

class Computed {
  get x(): number {
    return 3;
  }
  get y(): number {
    return 4;
  }
}

function alternating(): object {
  let reads = 0;
  return {
    get x() {
      return reads++ % 2 === 0 ? 1 : "text";
    },
    y: 2,
  };
}

function onceANumber(): object {
  let reads = 0;
  return {
    get x() {
      return reads++ === 0 ? 1 : undefined;
    },
    get y() {
      return reads++ === 1 ? 2 : null;
    },
  };
}

const values: [string, () => unknown][] = [
  ["a literal", () => ({ x: 1, y: 2 })],
  ["a class instance", () => new Real()],
  ["getters on a prototype", () => new Computed()],
  ["parsed text", () => JSON.parse('{"x":1,"y":2}')],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, {})],
  ["an array with members", () => Object.assign([0], { x: 1, y: 2 })],
  ["a function with members", () => Object.assign(() => 0, { x: 1, y: 2 })],
  ["a getter that alternates", alternating],
  ["getters that are numbers once", onceANumber],
  ["a proxy that has everything", () => new Proxy({}, { has: () => true, get: () => 5 })],
  ["a string", () => "text"],
  ["null", () => null],
  ["x is a string", () => ({ x: "1", y: 2 })],
  ["NaN and negative zero", () => ({ x: NaN, y: -0 })],
];

for (let i = 0; i < 2000; i++) {
  sum({ x: i, y: 1 });
  stepByStep({ x: i });
  listOfNumbers([i, 1]);
}
for (const [name, make] of values) {
  attempt(name + ": the guard", () => sum(make()));
  attempt(name + ": step by step", () => stepByStep(make()));
}
attempt("a list of numbers", () => listOfNumbers([1, 2, 3]));
attempt("a list with a string", () => listOfNumbers([1, "2", 3]));
attempt("a list with a hole", () => {
  const list = [1, 2, 3];
  delete list[1];
  return listOfNumbers(list);
});
attempt("a proxy of a list", () => listOfNumbers(new Proxy([1, 2, 3], {})));
attempt("a list whose element alternates", () => {
  const list: unknown[] = [0, 2];
  let reads = 0;
  Object.defineProperty(list, 0, { get: () => (reads++ % 2 === 0 ? 1 : "text"), enumerable: true });
  return listOfNumbers(list);
});
