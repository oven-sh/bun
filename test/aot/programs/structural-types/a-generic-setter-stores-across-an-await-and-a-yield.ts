function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

interface Point {
  x: number;
  name: string;
}

async function setLater<T, K extends keyof T>(target: T, key: K, value: Promise<T[K]>): Promise<void> {
  target[key] = await value;
}

function* setEach<T, K extends keyof T>(target: T, key: K): Generator<T[K], number, T[K]> {
  let count = 0;
  for (;;) {
    const value = yield target[key];
    target[key] = value;
    count++;
    if (count === 3) return count;
  }
}

const yes: boolean = process.argv.length > 0;

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p);
}

async function sumAround(p: Point, between: Promise<void>): Promise<string> {
  const before = p.x + 1;
  await between;
  const after = p.x + 1;
  return show(before) + " then " + show(after);
}

const a: Point = { x: 1, name: "a" };
await setLater(a, "x", Promise.resolve(2));
console.log("honest: " + describe(a) + " " + (a.x + 1));
await setLater(a, yes ? "x" : "name", Promise.resolve("late"));
console.log("a string arrives later: " + describe(a));
attempt("  x + 1", () => a.x + 1);
attempt("  x.toFixed(0)", () => a.x.toFixed(0));

const b: Point = { x: 1, name: "b" };
console.log("read, awaited, read again: " + (await sumAround(b, setLater(b, yes ? "x" : "name", Promise.resolve("between")))));
console.log("afterwards: " + describe(b));

const c: Point = { x: 1, name: "c" };
const steps = setEach(c, yes ? "x" : "name");
console.log("started: " + show(steps.next().value));
console.log("an honest value: " + show(steps.next(5).value) + " " + describe(c) + " " + (c.x + 1));
console.log("a string: " + show(steps.next("sent in").value) + " " + describe(c));
attempt("  x + 1", () => c.x + 1);
attempt("  x * 2", () => c.x * 2);
const last = steps.next(7);
console.log("the last one: " + show(last.value) + " " + last.done + " " + describe(c) + " " + (c.x + 1));

const d: Point = { x: 1, name: "d" };
await Promise.all([setLater(d, yes ? "x" : "name", Promise.resolve("first")), setLater(d, yes ? "name" : "x", Promise.resolve(9)), setLater(d, "x", Promise.resolve(3))]);
console.log("three at once: " + describe(d));
attempt("  x + 1", () => d.x + 1);
attempt("  name.length", () => d.name.length);
attempt("  name.toUpperCase()", () => d.name.toUpperCase());

export {};
