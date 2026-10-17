// Untyped code reads the fields of typed objects by name: numbers kept as doubles, whole numbers, booleans, each with and without `undefined`, `null` or no value at all, strings and records that may be missing. Every value at the edges reads as it does under plain Bun.
import * as library from "./library.js";
const { readAll, readInLoop, has, kinds, compute }: any = library;
interface Other { a: number }
interface Row {
  fraction: number; whole: number; flag: boolean; maybeFlag: boolean | undefined; flagOrNull: boolean | null; optionalFlag?: boolean;
  maybeNumber: number | undefined; numberOrNull: number | null; optionalNumber?: number;
  maybeText: string | undefined; textOrNull: string | null; optionalText?: string;
  maybeRecord: Other | undefined; recordOrNull: Other | null; small: number; anything: unknown;
}
function make(i: number): Row {
  return { fraction: i + 0.5, whole: i, flag: i % 2 === 0, maybeFlag: undefined, flagOrNull: null, maybeNumber: undefined, numberOrNull: null, maybeText: undefined, textOrNull: null, maybeRecord: undefined, recordOrNull: null, small: i & 7, anything: i };
}
const rows: Row[] = [];
for (let i = 0; i < 8; i++) rows.push(make(i));
for (let round = 0; round < 3; round++) console.log(readAll(rows[1]), "|", kinds(rows[1]));
console.log(readInLoop(rows, 50));
const numbers = [0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 1073741823, 1073741824, -1073741824, -1073741825, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e308, 5e-324, 1e21, 123456789.125];
const row = rows[0];
for (const n of numbers) {
  row.fraction = n; row.whole = n; row.maybeNumber = n; row.numberOrNull = n; row.optionalNumber = n; row.anything = n;
  console.log(readAll(row), "|", compute(row, 2, 3));
}
for (const flag of [true, false]) {
  row.flag = flag; row.maybeFlag = flag; row.flagOrNull = flag; row.optionalFlag = flag;
  console.log(readAll(row), "|", has(row), "|", kinds(row));
}
row.maybeFlag = undefined; row.flagOrNull = null; row.optionalFlag = undefined; row.maybeNumber = undefined; row.numberOrNull = null; row.optionalNumber = undefined;
console.log(readAll(row), "|", has(row), "|", kinds(row));
delete row.optionalFlag; delete row.optionalNumber; delete row.optionalText;
console.log(readAll(row), "|", has(row));
row.maybeText = ""; row.textOrNull = "t"; row.optionalText = "o" + rows.length; row.maybeRecord = { a: 1 }; row.recordOrNull = { a: 2 };
console.log(readAll(row), "|", has(row));
row.maybeText = undefined; row.textOrNull = null; row.optionalText = undefined; row.maybeRecord = undefined; row.recordOrNull = null;
console.log(readAll(row), "|", has(row));
Object.setPrototypeOf(rows[2], { optionalFlag: "inherited", optionalNumber: "inherited too" });
console.log(readAll(rows[2]), "|", has(rows[2]));
rows[3].fraction = NaN; rows[4].maybeFlag = true; rows[5].maybeText = "five"; rows[6].maybeNumber = 6.5; rows[7].flagOrNull = false;
console.log(readInLoop(rows, 50));
