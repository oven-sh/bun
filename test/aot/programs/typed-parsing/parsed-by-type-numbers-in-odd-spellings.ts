function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Reading {
  n: number;
}

function uses(reading: Reading): unknown[] {
  const n = reading.n;
  return [n, typeof n, n + 1, n * 2, n | 0, n >>> 0, 1 / n, n === Math.floor(n), Number.isSafeInteger(n), String(n), JSON.stringify(reading)];
}
function sumOf(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

const spellings = ["0", "-0", "0.0", "-0.0", "0e0", "-0e-0", "1.0", "1.50", "1e0", "1E2", "1e+2", "1e-2", "100e-2", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "12345678901234567890", "1e21", "1e308", "1.7976931348623157e308", "5e-324", "1e-400", "-1e-400", "0.1", "0.30000000000000004", "123456789.123456789", "1.0000000000000000000000000000001", "0.000001", "0.0000001"];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses({ n: i }).length;
console.log("2000 honest literals with integers", warm);

for (const spelling of spellings) attempt(spelling, () => uses(JSON.parse<Reading>('{"n":' + spelling + "}")));
attempt("alone", () => spellings.map(spelling => JSON.parse<number>(spelling)));
attempt("in one list", () => {
  const list = JSON.parse<number[]>("[" + spellings.join(",") + "]");
  return [list.length, list, sumOf(list.slice(0, 12))];
});
attempt("integers and then a fraction", () => {
  const list = JSON.parse<number[]>("[1,2,3,4,5,6,7,8,0.5]");
  return [list, sumOf(list)];
});
attempt("integers and then negative zero", () => {
  const list = JSON.parse<number[]>("[1,2,-0]");
  return [list, 1 / list[2], list.indexOf(0), list.includes(-0), Object.is(list.at(-1), -0)];
});
