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

type Fixable = { toFixed(digits: number): string };

function format(amount: Fixable): string {
  return amount.toFixed(1);
}

function formatSlowly(amount: Fixable): string {
  let text = "";
  try {
    for (let digits = 0; digits < 2; digits++) text += amount.toFixed(digits) + " ";
  } finally {
    text += ".";
  }
  return text;
}

function kindOf(value: {}): string {
  return typeof value;
}

function unwrap(value: { valueOf(): number }): number {
  return value.valueOf() * 2;
}

const own: Fixable & { valueOf(): number } = { toFixed: digits => "own " + digits, valueOf: () => 21 };

function honestOne(): string {
  return format(own) + formatSlowly(own) + kindOf(own) + unwrap(own);
}
function honestTwo(): string {
  const other = { toFixed: (digits: number) => "other " + digits, valueOf: () => 4 };
  return format(other) + formatSlowly(other) + kindOf(other) + unwrap(other);
}
function integerCaller(): string {
  return format(7) + formatSlowly(7) + kindOf(7) + unwrap(7);
}
function doubleCaller(): string {
  return format(2.25) + formatSlowly(2.25) + kindOf(2.25) + unwrap(2.25);
}
function computedCaller(n: number): string {
  const value = n / 4;
  return format(value) + formatSlowly(value) + kindOf(value) + unwrap(value);
}

function applyTo(amount: Fixable, use: (amount: Fixable) => string): string {
  return use(amount);
}

const table = { format, formatSlowly };

class Printer {
  constructor(private use: (amount: Fixable) => string) {}
  print(amount: Fixable): string {
    return this.use(amount);
  }
}

attempt("the integer caller comes first", integerCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestOne().length + honestTwo().length;
console.log("after 4000 honest calls", warm);

attempt("a plain call with an integer", integerCaller);
attempt("a plain call with a double", doubleCaller);
attempt("a plain call with a computed number", () => [computedCaller(1), computedCaller(4), computedCaller(0), computedCaller(-0)]);
attempt("honest again", () => honestOne() + honestTwo());
attempt("call", () => [format.call(undefined, 7), formatSlowly.call(undefined, 0.5), format.call(undefined, own)]);
attempt("apply", () => [format.apply(undefined, [7]), formatSlowly.apply(undefined, [0.5]), format.apply(undefined, [own])]);
attempt("bind", () => [format.bind(undefined, 7)(), formatSlowly.bind(undefined)(0.5), format.bind(undefined, own)()]);
attempt("Reflect.apply", () => [Reflect.apply(format, undefined, [7]), Reflect.apply(unwrap, undefined, [0.5])]);
attempt("handed to map over integers", () => [1, 2, 3].map(format));
attempt("handed to map over doubles", () => [0.5, 1.5, NaN, -0].map(format));
attempt("handed to map over objects", () => [own, own].map(format));
attempt("handed to map over a mix", () => ([own, 1, 0.5, own] satisfies Fixable[]).map(formatSlowly));
attempt("handed to a typed array's map source", () => Array.from(new Float64Array([0.25, 2]), format));
attempt("typeof handed to map", () => ([1, 0.5, "s", own, true] satisfies {}[]).map(kindOf));
attempt("valueOf handed to map", () => ([1, 0.5, own, -0] satisfies { valueOf(): number }[]).map(unwrap));
attempt("as a function-typed parameter", () => [applyTo(7, format), applyTo(own, format), applyTo(0.5, formatSlowly)]);
attempt("read from a literal", () => [table.format(7), table.formatSlowly(0.5), table.format(own)]);
attempt("read by a computed name", () => (["format", "formatSlowly"] satisfies (keyof typeof table)[]).map(name => table[name](1.5)));
attempt("held in a private field", () => [new Printer(format).print(7), new Printer(format).print(own), new Printer(formatSlowly).print(0.5)]);
attempt("honest at the end", () => honestOne() + honestTwo());
console.log("in promise reactions", (await Promise.all([Promise.resolve<Fixable>(7).then(format), Promise.resolve<Fixable>(own).then(format), Promise.resolve<Fixable>(0.5).then(format)])).join());

export {};
