type Loose = ReturnType<typeof JSON.parse>;

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function sum(p: Point): number {
  return p.x + p.y;
}

function report(p: Point): string {
  let line: string;
  try {
    line = show([p.x, p.y, sum(p), typeof p.x, Object.keys(p).join(), JSON.stringify(p)]);
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  return line;
}

const lookUp: Function = (p: Point) => p;

function viaArguments(...rest: unknown[]) {
  return arguments[0];
}

const ways: [string, (p: Point) => Loose][] = [
  ["Reflect.get", p => Reflect.get({ p }, "p")],
  ["Object()", p => Object(p)],
  ["Object.setPrototypeOf", p => Object.setPrototypeOf(p, Object.prototype)],
  ["a value of type Function", p => lookUp(p)],
  ["Reflect.apply", p => Reflect.apply(lookUp, undefined, [p])],
  ["arguments", p => viaArguments(p)],
  ["a descriptor", p => Object.getOwnPropertyDescriptor({ p }, "p")?.value],
  [
    "Object.values",
    p => {
      const holder: object = { p };
      return Object.values(holder)[0];
    },
  ],
  ["JSON.parse or the point", p => JSON.parse("null") ?? p],
];

const changes: [string, (loose: Loose) => void][] = [
  ["nothing", () => {}],
  ["x = a text", loose => (loose.x = "1")],
  ["x = undefined", loose => (loose.x = undefined)],
  ["x = null", loose => (loose.x = null)],
  ["x = a bigint", loose => (loose.x = 1n)],
  ["x = an object", loose => (loose.x = { valueOf: () => 40 })],
  ["x = minus zero", loose => (loose.x = -0)],
  ["x += a text", loose => (loose.x += "!")],
  ["delete x", loose => delete loose.x],
  ["delete x and put it back", loose => (delete loose.x, (loose.x = 9))],
  ["a new member", loose => (loose.z = 3)],
  ["a new member by a computed name", loose => (loose["w" + 1] = 4)],
  ["an index", loose => (loose[0] = "zero")],
  ["both swapped", loose => ([loose.x, loose.y] = ["b", "a"])],
  ["a getter", loose => Object.defineProperty(loose, "x", { get: () => "got", enumerable: true, configurable: true })],
  ["hidden", loose => Object.defineProperty(loose, "x", { enumerable: false })],
  ["assigned over", loose => Object.assign(loose, { y: "two", x: "one" })],
  ["another prototype", loose => Object.setPrototypeOf(loose, { x: "inherited", extra: 1 })],
  ["another prototype and x deleted", loose => (Object.setPrototypeOf(loose, { x: "inherited" }), delete loose.x)],
  ["frozen", loose => Object.freeze(loose)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 });
console.log("2000 honest rounds: " + warm);

for (const [way, alias] of ways) {
  for (const [change, apply] of changes) {
    const p: Point = { x: 1, y: 2 };
    const loose = alias(p);
    let threw = "";
    try {
      apply(loose);
    } catch (error) {
      threw = " (the change threw " + (error instanceof Error ? error.constructor.name : typeof error) + ")";
    }
    console.log(way + ", " + change + " -> " + report(p) + " same object: " + (loose === p) + threw);
    try {
      p.x = 5;
      p.y += 1;
    } catch (error) {
      console.log("  a typed store threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
    console.log("  after typed stores -> " + report(p));
  }
}

export {};
