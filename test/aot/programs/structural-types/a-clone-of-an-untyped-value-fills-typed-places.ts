interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
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

class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  get sum(): number {
    return this.x + this.y;
  }
}

const things = new Map<string, unknown>([
  ["honest", { x: 1, y: 2 }],
  ["swapped", { y: 2, x: 1 }],
  ["texts", { x: "1", y: "2" }],
  ["an instance", new Pixel(1, 2)],
  ["getters", { get x() { return 1; }, get y() { return 2; } }],
  ["inherited", Object.create({ x: 1, y: 2 })],
  ["boxes", { x: new Number(1), y: new String("2") }],
  ["dates", { x: new Date(1), y: new Date(2) }],
  ["bigints", { x: 1n, y: 2n }],
  ["zeros", { x: -0, y: NaN }],
  ["a list", [1, 2]],
  ["a list with members", Object.assign([0], { x: 1, y: 2 })],
  ["a map", new Map([["x", 1], ["y", 2]])],
  ["an error", Object.assign(new Error("e"), { x: 1, y: 2 })],
  ["a typed array", new Float64Array([1, 2])],
  ["frozen", Object.freeze({ x: 1, y: 2 })],
  ["a function", () => 1],
  ["a symbol", Symbol("s")],
  ["a number", 5],
  ["a boxed number", new Number(5)],
  ["a text", "xy"],
  ["null", null],
  ["undefined", undefined],
]);
const lookUp: Function = (name: string) => things.get(name);

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  p: Point;
  constructor(name: string) {
    this.p = structuredClone(lookUp(name));
  }
  sum(): number {
    return this.p.x + this.p.y;
  }
}

const uses: [string, (name: string) => unknown][] = [
  [
    "a local",
    name => {
      const p: Point = structuredClone(lookUp(name));
      return [p.x, p.y, p.x + p.y, typeof p.x, Object.keys(p).join(), p === lookUp(name)];
    },
  ],
  ["a parameter", name => sum(structuredClone(lookUp(name)))],
  ["a field", name => new Holder(name).sum()],
  [
    "an element",
    name => {
      const list: Point[] = structuredClone([{ x: 1, y: 2 }, lookUp(name)]);
      let total = 0;
      for (const p of list) total += p.x;
      return total;
    },
  ],
  [
    "a map value",
    name => {
      const map: Map<string, Point> = structuredClone(new Map([["k", lookUp(name)]]));
      const p = map.get("k");
      return p === undefined ? "nothing" : sum(p);
    },
  ],
  [
    "a store",
    name => {
      const p: Point = structuredClone(lookUp(name));
      p.x = 7;
      return [p.x, sum(p), JSON.stringify(p)];
    },
  ],
  [
    "a number",
    name => {
      const n: number = structuredClone(lookUp(name));
      return [typeof n, n + 1, plusOne(n), [10, 20][n]];
    },
  ],
];

for (const [use, run] of uses) {
  let rounds = 0;
  for (let i = 0; i < 500; i++) {
    run(use === "a number" ? "a number" : "honest");
    rounds++;
  }
  console.log(use + ": " + rounds + " honest rounds");
  for (const name of things.keys()) attempt(use + ", " + name, () => run(name));
}

export {};
