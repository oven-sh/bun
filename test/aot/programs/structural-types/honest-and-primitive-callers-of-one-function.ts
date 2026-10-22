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

type HasLength = { length: number };

function measure(item: HasLength): number {
  return item.length * 2;
}

function measureSlowly(item: HasLength): number {
  let total = 0;
  try {
    for (let i = 0; i < 2; i++) total += item.length;
  } finally {
    total += 0;
  }
  return total;
}

function honestCallerOne(): number {
  return measure({ length: 1 }) + measureSlowly({ length: 1 });
}
function honestCallerTwo(): number {
  return measure({ length: 2 }) + measureSlowly({ length: 2 });
}
function honestCallerThree(n: number): number {
  const item = { length: n };
  return measure(item) + measureSlowly(item);
}
function stringCaller(): number {
  return measure("abc") + measureSlowly("abc");
}
function arrayCaller(): number {
  return measure([1, 2, 3, 4]) + measureSlowly([1, 2, 3, 4]);
}
function functionCaller(): number {
  return measure(measure) + measureSlowly(measure);
}

function applyTo(item: HasLength, use: (item: HasLength) => number): number {
  return use(item);
}

const table = { measure, measureSlowly };
const list = [measure, measureSlowly];

class Tool {
  use: (item: HasLength) => number = measure;
  run(item: HasLength): number {
    return this.use(item);
  }
}

attempt("the string caller comes first", stringCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestCallerOne() + honestCallerTwo() + honestCallerThree(i);
console.log("after 6000 honest calls", warm);

attempt("a plain call with a string", stringCaller);
attempt("a plain call with an array", arrayCaller);
attempt("a plain call with a function", functionCaller);
attempt("honest again", () => honestCallerOne() + honestCallerTwo() + honestCallerThree(3));
attempt("call", () => [measure.call(undefined, "abc"), measureSlowly.call(undefined, "abc"), measure.call(undefined, { length: 5 })]);
attempt("apply", () => [measure.apply(undefined, ["abc"]), measureSlowly.apply(undefined, ["abc"]), measure.apply(undefined, [{ length: 5 }])]);
attempt("bind", () => [measure.bind(undefined, "abc")(), measureSlowly.bind(undefined)("abc"), measure.bind(undefined, { length: 5 })()]);
attempt("Reflect.apply", () => [Reflect.apply(measure, undefined, ["abc"]), Reflect.apply(measureSlowly, undefined, [[1]])]);
attempt("handed to map over strings", () => ["a", "bc", ""].map(measure));
attempt("handed to map over literals", () => [{ length: 1 }, { length: 2 }].map(measure));
attempt("handed to map over a mix", () => ([{ length: 1 }, "bc", [1, 2, 3], measure] satisfies HasLength[]).map(measureSlowly));
attempt("handed to Array.from", () => Array.from(["ab", "c"], measure));
attempt("handed to a promise later", () => "see below");
attempt("as a function-typed parameter", () => [applyTo("abc", measure), applyTo({ length: 1 }, measure), applyTo("abc", measureSlowly)]);
attempt("read from a literal", () => [table.measure("abc"), table.measureSlowly("abc"), table.measure({ length: 1 })]);
attempt("read by a computed name", () => {
  const names: ("measure" | "measureSlowly")[] = ["measure", "measureSlowly"];
  return names.map(name => table[name]("abcd"));
});
attempt("read from an array", () => list.map(use => use("abcde")));
attempt("read from a field", () => [new Tool().run("abc"), new Tool().run({ length: 1 }), new Tool().use("ab")]);
attempt("honest at the end", () => honestCallerOne() + honestCallerTwo() + honestCallerThree(3));

const later: Promise<HasLength>[] = [Promise.resolve("abc"), Promise.resolve({ length: 1 }), Promise.resolve([1, 2])];
console.log("promise reactions", (await Promise.all(later.map(promise => promise.then(measure)))).join());

export {};
