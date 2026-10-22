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

enum Level {
  Low = 1,
  High = 10,
}

class Price {
  constructor(private cents: number) {}
  toFixed(digits: number): string {
    return "price " + (this.cents / 100).toFixed(digits);
  }
}

function money(amount: Fixable): string {
  return amount.toFixed(2);
}

function moneyAtEveryPrecision(amount: Fixable): string {
  let text = "";
  for (let digits = 0; digits < 4; digits++) text += amount.toFixed(digits) + " ";
  return text;
}

function tooPrecise(amount: Fixable): string {
  return amount.toFixed(101);
}

function kindOf(amount: Fixable): string {
  return typeof amount;
}

function whichMethod(amount: Fixable): boolean {
  return amount.toFixed === Number.prototype.toFixed;
}

const values: [string, Fixable][] = [
  ["a literal", { toFixed: digits => "literal " + digits }],
  ["a price", new Price(1999)],
  ["5", 5],
  ["2.5", 2.5],
  ["-0", -0],
  ["0", 0],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["1e21", 1e21],
  ["2 ** 31", 2 ** 31],
  ["-1.005", -1.005],
  ["the largest safe integer", Number.MAX_SAFE_INTEGER],
  ["the smallest double", Number.MIN_VALUE],
  ["an enum member", Level.High],
  ["a Number object", new Number(7.25)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Fixable = { toFixed: digits => String(digits + i) };
  warm += money(honest).length + moneyAtEveryPrecision(honest).length + tooPrecise(honest).length + kindOf(honest).length + (whichMethod(honest) ? 1 : 0);
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": two digits", () => money(value));
  attempt(name + ": zero to three digits", () => moneyAtEveryPrecision(value));
  attempt(name + ": 101 digits", () => tooPrecise(value));
  attempt(name + ": typeof", () => kindOf(value));
  attempt(name + ": the built-in method", () => whichMethod(value));
}

function sumAsText(amounts: Fixable[]): string {
  let text = "";
  for (const amount of amounts) text += amount.toFixed(1) + ";";
  return text;
}
attempt("an array of numbers", () => sumAsText([1, 2.25, -3]));
attempt("an array of numbers and objects", () => sumAsText([1, new Price(250), 0.5, { toFixed: () => "x" }, NaN]));
attempt("numbers computed at run time", () => {
  const amounts: Fixable[] = [];
  for (let i = 0; i < 5; i++) amounts.push(i / 2);
  return sumAsText(amounts);
});
