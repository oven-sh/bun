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

function put<T>(list: T[], index: number, item: T): void {
  list[index] = item;
}

function add<T>(list: T[], ...items: T[]): number {
  return list.push(...items);
}

function replaceAll<T>(list: T[], item: T): void {
  for (let i = 0; i < list.length; i++) list[i] = item;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function bits(numbers: number[]): number {
  let all = 0;
  for (let i = 0; i < numbers.length; i++) all |= numbers[i];
  return all;
}

function signs(numbers: number[]): string {
  let text = "";
  for (let i = 0; i < numbers.length; i++) text += 1 / numbers[i] < 0 ? "-" : "+";
  return text;
}

function report(title: string, numbers: number[]): void {
  console.log(title + ": " + show(numbers));
  attempt("  sum", () => sum(numbers));
  attempt("  bits", () => bits(numbers));
  attempt("  signs", () => signs(numbers));
  attempt("  JSON", () => JSON.stringify(numbers));
  attempt("  sorted", () => numbers.toSorted((a, b) => a - b));
  attempt("  index of the second", () => numbers.indexOf(numbers[1]));
  attempt("  includes the second", () => numbers.includes(numbers[1]));
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const numbers = [i, 1, 2];
  put(numbers, 1, i);
  add(numbers, 3);
  total += sum(numbers) + bits(numbers);
}
console.log("2000 rounds with integers: " + total);

for (const value of [0.5, 2 ** 31, -(2 ** 31) - 1, -0, NaN, Infinity, 2 ** 53, 5e-324]) {
  const stored = [1, 2, 3];
  put(stored, 1, value);
  report("stored " + show(value), stored);
  const pushed = [1];
  add(pushed, value, 3);
  report("pushed " + show(value), pushed);
}

const all = [1, 2, 3];
replaceAll(all, 0.25);
report("every one is replaced by a quarter", all);
replaceAll(all, 4);
report("and by an integer again", all);

const tuple: [number, number] = [1, 2];
put(tuple, 0, 0.5);
console.log("a tuple of two integers: " + show(tuple) + " " + (tuple[0] + tuple[1]) + " " + (tuple[0] | tuple[1]));

const grown: number[] = [];
for (let i = 0; i < 10; i++) add(grown, i);
add(grown, 10.5);
for (let i = 11; i < 20; i++) add(grown, i);
report("twenty numbers, the eleventh is a fraction", grown);

const computed = [1, 2, 3];
for (let i = 0; i < computed.length; i++) put(computed, i, computed[i] / 2);
report("each is halved in place", computed);
const scaled = [1, 2, 3];
for (let i = 0; i < scaled.length; i++) put(scaled, i, scaled[i] * 1e9);
report("each is multiplied past 32 bits in place", scaled);

export {};
