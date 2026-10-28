// Number fields kept in four bytes: an integer is stored over a number that did not fit, a number that does not fit over an integer, again and again, by typed code and by code that knows no types.
// CALLS- putSmall NumberBox
// CALLS+ putInt32 PutNumberInNumberBox
// CALLS+ putSum PutNumberInNumberBox
// CALLS- putLength NumberBox
declare const console: { log(...values: unknown[]): void };
interface Cell { a: number; b: number; c: number; d: number }
interface Loose { label: string; x?: number; y?: number; z?: number | null }
const odd: number[] = JSON.parse("[0.5, -0.5, 1e300, 2147483647, 2147483648, -1073741824, -1073741825, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 0, 1, -1]");
odd.push(NaN, -0, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 53);
function show(value: number | null | undefined): string {
  return value === undefined ? "undefined" : value === null ? "null" : Object.is(value, -0) ? "-0" : String(value);
}
function cellText(cell: Cell): string {
  return show(cell.a) + " " + show(cell.b) + " " + show(cell.c) + " " + show(cell.d);
}
function looseText(loose: Loose): string {
  return show(loose.x) + " " + show(loose.y) + " " + show(loose.z) + " " + Object.keys(loose).join();
}
function makeCell(i: number): Cell {
  return { a: i & 1023, b: (i >> 1) & 1023, c: i & 7, d: (i * 3) & 255 };
}
function putOdd(cell: Cell, name: string, value: number) {
  (cell as unknown as Record<string, number>)[name] = value;
}
export function putSmall(cell: Cell, i: number) { cell.a = i & 255; }
export function putInt32(cell: Cell, i: number) { cell.b = i | 0; }
export function putSum(cell: Cell, i: number, j: number) { cell.c = (i | 0) + (j | 0); }
export function putLength(cell: Cell, text: string) { cell.d = text.length; }
export function copyField(to: Loose, from: Cell) { to.y = from.b; to.z = from.d; }
export function putIndexes(cells: Cell[]) { for (let k = 0; k < cells.length; k++) cells[k].d = k; }
export function putNumber(loose: Loose, value: number) { loose.x = value; }
export function putMaybe(loose: Loose, value: number | undefined) { loose.y = value; }
export function putNullable(loose: Loose, value: number | null) { loose.z = value; }
export function putSmallLoose(loose: Loose, i: number) { loose.x = i & 15; loose.y = i & 7; loose.z = i & 3; }

const lines: string[] = [];
const half: number = JSON.parse("0.5");
const names: string[] = JSON.parse('["a", "b", "c", "d"]');
const cells: Cell[] = [];
for (let i = 0; i < 8; i++) cells.push(makeCell(i * 37));
for (const value of odd) {
  const cell = makeCell(5);
  for (const name of names) putOdd(cell, name, value);
  lines.push("odd " + cellText(cell));
  putSmall(cell, 300); putInt32(cell, -7); putSum(cell, 4, 5); putLength(cell, "four");
  lines.push("over " + cellText(cell));
  for (const name of names) putOdd(cell, name, value);
  lines.push("again " + cellText(cell));
  putInt32(cell, value); putSum(cell, value, value);
  lines.push("wrapped " + cellText(cell));
  for (const name of names) putOdd(cell, name, value);
  const other: Loose = { label: "other" };
  copyField(other, cell);
  lines.push("copied " + looseText(other));
  copyField(other, makeCell(11));
  lines.push("back " + looseText(other));
  copyField(other, cell);
  lines.push("once more " + looseText(other));
}
for (const i of [-1073741824, -1073741825, 2147483647, -2147483648, 0]) {
  const cell = makeCell(1);
  putInt32(cell, i); putSum(cell, i, i);
  lines.push("limits " + cellText(cell));
  putInt32(cell, 1); putSum(cell, 1, 0);
  lines.push("small " + cellText(cell));
}
putOdd(cells[3], names[3], half);
putOdd(cells[5], names[3], odd[2]);
putIndexes(cells);
lines.push("indexes " + cells.map(cell => show(cell.d)).join());

for (const value of odd) {
  const loose: Loose = { label: "l" };
  lines.push("empty " + looseText(loose));
  putNumber(loose, value); putMaybe(loose, value); putNullable(loose, value);
  lines.push("put " + looseText(loose));
  putSmallLoose(loose, 77);
  lines.push("small " + looseText(loose));
  putNumber(loose, value); putMaybe(loose, undefined); putNullable(loose, null);
  lines.push("nil " + looseText(loose));
  putMaybe(loose, value); putNullable(loose, value);
  lines.push("anew " + looseText(loose));
  putNumber(loose, 3); putMaybe(loose, 4); putNullable(loose, 5);
  lines.push("whole " + looseText(loose));
  delete loose.x;
  lines.push("gone " + looseText(loose));
  putNumber(loose, value);
  lines.push("there " + looseText(loose));
}

let sum = 0;
const busy = makeCell(2);
const busyLoose: Loose = { label: "busy" };
for (let turn = 0; turn < 200000; turn++) {
  if (turn & 1) { putOdd(busy, names[0], turn + half); putNumber(busyLoose, turn + half); }
  else { putSmall(busy, turn); putSmallLoose(busyLoose, turn); }
  sum += busy.a + busyLoose.x!;
}
lines.push("busy " + sum);
const many: Cell[] = [];
for (let i = 0; i < 20000; i++) {
  const cell = makeCell(i);
  putOdd(cell, names[1], i + half);
  if (i & 1) putInt32(cell, i);
  if (i & 2) putOdd(cell, names[1], i - half);
  if ((i & 1023) === 0) many.push(cell);
}
lines.push("many " + many.map(cell => show(cell.b)).join());
console.log(lines.join("\n"));
