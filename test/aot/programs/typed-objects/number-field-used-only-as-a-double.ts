// A number field into which the program only stores integers is kept in four bytes where some use wants an integer; where every use is arithmetic with fractions it is a plain double, and a read of it is one load. JSON.stringify() wants an integer.
// CALLS- scaled scvtf
// CALLS- sumWithFraction scvtf
// CALLS- throughSum scvtf
// CALLS- compared scvtf
// CALLS+ putIndex ^putIndex: 1[0-9] instructions;
// CALLS+ putFlags ^putFlags: 1[0-9] instructions;
// CALLS+ putCount ^putCount: 1[0-9] instructions;
// CALLS+ worth scvtf
declare const console: { log(...values: unknown[]): void };
interface Price { cents: number; units: number; weight: number; rank: number }
interface Entry { index: number; flags: number; key: number; next: number }
interface Line { count: number; size: number; left: number; right: number }
const table: string[] = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
export function scaled(price: Price): number { return price.cents * 0.01; }
export function sumWithFraction(price: Price, rate: number): number { return price.units + rate; }
export function throughSum(price: Price, text: string, rate: number): number { return (price.weight + text.length) * rate; }
export function compared(price: Price, limit: number): boolean { return price.rank < limit; }
export function putIndex(entry: Entry, i: number) { entry.index = i & 7; }
export function putFlags(entry: Entry, i: number) { entry.flags = i & 255; }
export function nameOf(entry: Entry): string { return table[entry.index]; }
export function hasFlag(entry: Entry, flag: number): boolean { return (entry.flags & flag) !== 0; }
export function isKey(entry: Entry, key: number): boolean { return entry.key === (key | 0); }
export function follows(entry: Entry, other: Entry): boolean { return entry.next > other.next; }
export function putCount(line: Line, i: number) { line.count = i & 255; }
export function worth(line: Line, rate: number): number { return line.count * rate; }
export function written(line: Line): string { return JSON.stringify(line); }
function show(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
const lines: string[] = [];
const odd: number[] = JSON.parse("[0.5, 1e300, 2147483648, -1073741825, -2147483649, 4294967296, 0, -1]");
odd.push(NaN, -0, Infinity, -Infinity);
for (let i = 0; i < 6; i++) {
  const price: Price = { cents: i * 25, units: i, weight: i + 2, rank: i & 3 };
  const entry: Entry = { index: i, flags: i * 5, key: i - 3, next: 6 - i };
  lines.push([show(scaled(price)), show(sumWithFraction(price, 0.5)), show(throughSum(price, "abc", 1.5)), compared(price, 1.5), nameOf(entry), hasFlag(entry, 4), isKey(entry, 0), follows(entry, { index: 0, flags: 0, key: 0, next: 3 })].join(" "));
  putIndex(entry, i + 9); putFlags(entry, i + 300);
  lines.push(nameOf(entry) + " " + hasFlag(entry, 1));
}
for (const value of odd) {
  const price: Price = { cents: 1, units: 2, weight: 3, rank: 4 };
  const entry: Entry = { index: 1, flags: 2, key: 3, next: 4 };
  for (const name of ["cents", "units", "weight", "rank"]) (price as unknown as Record<string, number>)[name] = value;
  for (const name of ["index", "flags", "key", "next"]) (entry as unknown as Record<string, number>)[name] = value;
  lines.push([show(scaled(price)), show(sumWithFraction(price, 0.5)), show(throughSum(price, "abc", 1.5)), compared(price, 1.5), nameOf(entry), hasFlag(entry, 4), isKey(entry, 0), follows(entry, { index: 0, flags: 0, key: 0, next: 3 }), JSON.stringify(entry)].join(" "));
}
for (const value of odd) {
  const line: Line = { count: 1, size: 2, left: 3, right: 4 };
  lines.push(show(worth(line, 0.5)) + " " + written(line));
  (line as unknown as Record<string, number>).count = value;
  lines.push(show(worth(line, 0.5)) + " " + written(line));
  putCount(line, 300);
  lines.push(show(worth(line, 0.5)) + " " + written(line));
}
console.log(lines.join("\n"));
