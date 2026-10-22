function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Vec {
  x: number;
  y: number;
  name = "vec";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
}

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

function answering(answers: Record<string, unknown>): Vec {
  return new Proxy(new Vec(3, 4), {
    get(target, key, receiver) {
      if (typeof key === "string" && key in answers) {
        log.push(key);
        return answers[key];
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

function total(v: Vec): number {
  return v.x + v.y;
}

function product(v: Vec): number {
  return v.x * v.y;
}

function asInteger(v: Vec): number {
  return v.x | 0;
}

function fixed(v: Vec): string {
  return v.x.toFixed(1);
}

function nameLength(v: Vec): number {
  return v.name.length;
}

function shout(v: Vec): string {
  return v.name.toUpperCase();
}

function norm(v: Vec): number {
  return v.norm() + 1;
}

function sum(v: Vec): number {
  return v.sum * 2;
}

function kinds(v: Vec): string {
  return [typeof v.x, typeof v.y, typeof v.name, typeof v.norm, typeof v.sum].join();
}

const uses: [string, (v: Vec) => unknown][] = [
  ["kinds", kinds],
  ["x + y", total],
  ["x * y", product],
  ["x | 0", asInteger],
  ["x.toFixed", fixed],
  ["length of the name", nameLength],
  ["the name in upper case", shout],
  ["norm() + 1", norm],
  ["sum * 2", sum],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Vec(i, 0.5);
  warm += total(honest) + product(honest) + asInteger(honest) + fixed(honest).length + nameLength(honest) + shout(honest).length + norm(honest) + sum(honest) + kinds(honest).length;
}
console.log("after 2000 honest vectors", warm);

const answers: [string, Record<string, unknown>][] = [
  ["nothing unusual", {}],
  ["x is a string", { x: "three" }],
  ["x is the text 3", { x: "3" }],
  ["x is undefined", { x: undefined }],
  ["x is null", { x: null }],
  ["x is a bigint", { x: 3n }],
  ["x is an object with valueOf", { x: { valueOf: () => 30 } }],
  ["x is -0 and y is NaN", { x: -0, y: NaN }],
  ["the name is a number", { name: 5 }],
  ["the name is undefined", { name: undefined }],
  ["the name is an array", { name: ["a", "b"] }],
  ["norm is a number", { norm: 5 }],
  ["norm is undefined", { norm: undefined }],
  ["norm returns a string", { norm: () => "long" }],
  ["norm is a class", { norm: Vec }],
  ["sum is a string", { sum: "seven" }],
];
for (const [name, answer] of answers) for (const [use, run] of uses) attempt(name + ": " + use, () => run(answering(answer)));
attempt("another answer at each read", () => {
  let reads = 0;
  const shifting = new Proxy(new Vec(3, 4), { get: (target, key, receiver) => (key === "x" ? (reads++ % 2 === 0 ? 1 : "one") : Reflect.get(target, key, receiver)) });
  return [shifting.x + shifting.x, typeof shifting.x === "number" ? shifting.x + 1 : "not a number", total(shifting)];
});
