// A number field kept in four bytes that no use wants as an integer becomes a plain double where that costs no memory: also where the eight bytes are only free once the field beside it has moved into four free bytes elsewhere. Where the object is full it keeps its four bytes.
// CALLS- putIntoRoomy NumberBox
// CALLS+ putIntoFull PutNumberInNumberBox
// CALLS+ putIntoWritten PutNumberInNumberBox
declare const console: { log(...values: unknown[]): void };
interface Roomy { price: number; serial: number; first: string; second: string; third: string; flag: boolean }
interface Full { count: number; left: number; right: number; up: number }
interface Written { cost: number; order: number; one: string; two: string; three: string; mark: boolean }
export function putIntoRoomy(roomy: Roomy, i: number, j: number) { roomy.serial = (i | 0) + (j | 0); }
export function putIntoFull(full: Full, i: number, j: number) { full.count = (i | 0) + (j | 0); }
export function putIntoWritten(written: Written, i: number, j: number) { written.order = (i | 0) + (j | 0); }
export function textOf(written: Written): string { return JSON.stringify(written); }
function look(value: object): string {
  const seen: string[] = [];
  for (const [key, held] of Object.entries(value)) seen.push(key + "=" + (Object.is(held, -0) ? "-0" : String(held)));
  return seen.join();
}
const names: string[] = JSON.parse('["serial", "count", "order"]');
const odd: number[] = JSON.parse("[0.5, 1e300, 2147483648, -1073741825, -2147483649, 4294967296, 0, -1]");
odd.push(NaN, -0, Infinity, -Infinity);
const lines: string[] = [];
for (let i = 0; i < 4; i++) {
  const roomy: Roomy = { price: i + 0.5, serial: i, first: "a" + i, second: "b" + i, third: "c" + i, flag: (i & 1) === 0 };
  const full: Full = { count: i, left: i + 1, right: i + 2, up: i + 3 };
  const written: Written = { cost: i + 0.25, order: i, one: "d" + i, two: "e" + i, three: "f" + i, mark: (i & 1) === 1 };
  lines.push(look(roomy), look(full), textOf(written));
  for (const [a, b] of [[1, 2], [2147483647, 2147483647], [-2147483648, -2147483648], [-1073741824, -1], [0, 0]]) {
    putIntoRoomy(roomy, a, b); putIntoFull(full, a, b); putIntoWritten(written, a, b);
    lines.push(look(roomy), look(full), textOf(written));
  }
  for (const value of odd) {
    [roomy, full, written].forEach((holder, at) => { (holder as unknown as Record<string, number>)[names[at]] = value; });
    lines.push(look(roomy), look(full), textOf(written));
    putIntoRoomy(roomy, i, 1); putIntoFull(full, i, 1); putIntoWritten(written, i, 1);
    lines.push(look(roomy), look(full), textOf(written));
  }
}
console.log(lines.join("\n"));
