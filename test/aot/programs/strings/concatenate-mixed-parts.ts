// Chains of `+` and templates over strings, numbers, objects with toString and valueOf, and symbols: what is converted, in which order, and how often. One row differs from plain Bun: in `a + "" + s + b` with a symbol `s` the second addition throws before `b` is converted, as ECMAScript orders it; plain Bun converts every operand first.
const log: string[] = [];

class Logged {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  toString(): string {
    log.push("toString " + this.label);
    return "<" + this.label + ">";
  }
}

class LoggedNumber extends Logged {
  valueOf(): number {
    log.push("valueOf " + this.label);
    return 42;
  }
}

function attempt(label: string, run: () => string): void {
  log.length = 0;
  let outcome: string;
  try {
    const text = run();
    outcome = text.length > 80 ? "length " + text.length : JSON.stringify(text);
  } catch (error) {
    outcome = (error as Error).name + ": " + (error as Error).message;
  }
  console.log(label, outcome, log.join(", "));
}

function noParts(): string {
  return ``;
}
function oneNumber(a: number): string {
  return `${a}`;
}
function oneString(a: string): string {
  return `${a}`;
}
function oneValue(a: any): string {
  return `${a}`;
}
function twoParts(a: string, b: number): string {
  return a + b;
}
function threeParts(a: number, b: string, c: boolean): string {
  return `${a}${b}${c}`;
}
function fourParts(a: string, b: undefined, c: null, d: bigint): string {
  return `${a}${b}${c}${d}`;
}
function fiveParts(a: number, b: number, c: number): string {
  return a + "," + b + "," + c;
}
function sixParts(a: string | undefined | null, b: number | undefined | null, c: boolean | undefined | null): string {
  return `${a}|${b}|${c}|`;
}
function sevenParts(a: Logged, b: number, c: Logged, d: string): string {
  return `${a}:${b}:${c}:${d}`;
}
function eightParts(a: any, b: any, c: any, d: any): string {
  return `[${a},${b},${c},${d}`;
}
function nineParts(s: string, i: number, d: number, u: undefined, n: null, t: boolean, b: bigint, o: Logged, x: any): string {
  return `${s}${i}${d}${u}${n}${t}${b}${o}${x}`;
}

function twoStrings(a: string, b: string): string {
  return a + b;
}
function threeStrings(a: string, b: string, c: string): string {
  return `${a}${b}${c}`;
}
function fourStrings(a: string, b: string, c: string, d: string): string {
  return a + b + c + d;
}
function nineStrings(a: string, b: string, c: string): string {
  return a + b + c + a + b + c + a + b + c;
}

function plusObject(a: string, o: Logged): string {
  return a + o;
}
function templateObject(a: string, o: Logged): string {
  return `${a}${o}`;
}
function templateWithSymbol(a: Logged, s: any, b: Logged): string {
  return `${a}${s}${b}`;
}
function plusWithSymbol(a: Logged, s: any, b: Logged): string {
  return a + "" + s + b;
}
function numberBetween(a: string, n: number): string {
  return `${a}${n}${a}`;
}
function objectBetween(a: string, o: Logged): string {
  return `${a}${o}${a}`;
}

const numbers = [0, -0, 7, -1, 2147483647, -2147483648, 2147483648, 4294967301, 1e21, 1e-7, 0.5, -0.5, NaN, Infinity, -Infinity];
console.log(JSON.stringify(noParts()), noParts().length);
for (const n of numbers) console.log(oneNumber(n), twoParts("n=", n), threeParts(n, "/", n > 0), fiveParts(n, -n, n * 2), oneValue(n));
for (const text of ["", "a", "é", "日本語", "plain text"]) console.log(JSON.stringify(oneString(text)), oneString(text) === text, JSON.stringify(oneValue(text)));
console.log(oneValue(undefined), oneValue(null), oneValue(true), oneValue(12345678901234567890n), oneValue([1, [2, 3]]), oneValue({}));
console.log(fourParts("x", undefined, null, 0n), fourParts("", undefined, null, -(2n ** 70n)));
console.log(sixParts("s", 5, true), sixParts("", -0, false), sixParts(undefined, null, undefined), sixParts(null, undefined, null), sixParts("é", 1e21, true));
console.log(eightParts(1, "two", 3n, null), eightParts(undefined, true, -0, 1e21), eightParts(NaN, "", false, 0.1), eightParts([], [null], [[]], {}));

attempt("objects in a template", () => sevenParts(new Logged("a"), 1.5, new Logged("c"), "d"));
attempt("objects among untyped parts", () => eightParts(new Logged("a"), new LoggedNumber("b"), 3, new Logged("d")));
attempt("nine parts", () => nineParts("s", 1, -0, undefined, null, false, 9n, new Logged("o"), new LoggedNumber("x")));
attempt("nine parts, numbers", () => nineParts("", -2147483648, 1e21, undefined, null, true, -1n, new LoggedNumber("o"), NaN));
attempt("plus prefers valueOf", () => plusObject("=", new LoggedNumber("n")));
attempt("a template prefers toString", () => templateObject("=", new LoggedNumber("n")));
attempt("plus without valueOf", () => plusObject("=", new Logged("n")));
attempt("a symbol in a template", () => templateWithSymbol(new Logged("before"), Symbol("s"), new Logged("after")));
attempt("a symbol in a chain", () => plusWithSymbol(new Logged("before"), Symbol.iterator, new Logged("after")));
attempt("a symbol alone", () => oneValue(Symbol()));
attempt("a symbol last", () => eightParts(new Logged("a"), new Logged("b"), new Logged("c"), Symbol("last")));

function countByKey(prefix: string, rounds: number): string {
  const counts = new Map<string, number>();
  const table: Record<string, number> = {};
  for (let i = 0; i < rounds; i++) {
    const key = prefix + ":" + (i % 7) + ":" + (i % 2 === 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const name = `${prefix}.${i % 5}.${i % 3 ? undefined : null}`;
    table[name] = (table[name] ?? 0) + i;
    const index = "" + (i % 4);
    table[index] = (table[index] ?? 0) + 1;
  }
  const lines: string[] = [];
  for (const [key, count] of counts) lines.push(key + "=" + count);
  for (const name of Object.keys(table)) lines.push(name + "=" + table[name]);
  return lines.join(" ");
}
console.log(countByKey("k", 1));
console.log(countByKey("key", 20000));
console.log(countByKey("", 210));

function mixedInLoop(rounds: number, name: string, flag: boolean, big: bigint): number {
  let checksum = 0;
  for (let i = 0; i < rounds; i++) {
    const text = `${name}#${i}/${i / 2}/${flag}/${big}/${i % 3 ? undefined : null}`;
    checksum = (checksum * 31 + text.length + text.charCodeAt(i % text.length)) | 0;
  }
  return checksum;
}
function ropesInLoop(rounds: number, a: string, b: string, c: string): number {
  let checksum = 0;
  for (let i = 0; i < rounds; i++) {
    const two = a + b;
    const three = `${a}${b}${c}`;
    const four = a + b + c + two;
    const nine = nineStrings(c, two, a);
    checksum = (checksum * 31 + two.length + three.length * 3 + four.length * 5 + nine.length * 7 + (nine + "!").charCodeAt(i % (nine.length + 1))) | 0;
  }
  return checksum;
}
console.log(mixedInLoop(30000, "name", true, 123456789012345678901234567890n), mixedInLoop(3, "", false, 0n));
console.log(ropesInLoop(30000, "ab", "cde", "f"), ropesInLoop(30000, "", "é", ""), ropesInLoop(30000, "", "", ""), ropesInLoop(2, "日", "本", "語"));
console.log(fourStrings("a", "", "b", ""), nineStrings("x", "", "yz"), threeStrings("", "", "").length);

function keepsText(x: string, empty: string): boolean {
  const results = ["" + x, x + "", empty + x, x + empty, `${x}`, `${empty}${x}`, `${x}${empty}${empty}`, empty + x + empty, empty + empty + x + empty];
  for (const result of results) {
    if (result !== x || result.length !== x.length) return false;
  }
  return true;
}
const rope = twoStrings("left ", "right");
for (const text of ["", "a", "é", "plain text", "日本語", rope, rope.slice(2, 8)]) {
  let areAllEqual = true;
  for (let i = 0; i < 2000; i++) areAllEqual = areAllEqual && keepsText(text, "");
  console.log(JSON.stringify(text), areAllEqual);
}

function doubled(times: number): string {
  let text = "x";
  for (let i = 0; i < times; i++) text = text + text;
  return text;
}
const half = doubled(30);
const quarter = doubled(29);
attempt("under the limit", () => twoStrings(half, quarter));
attempt("an empty part at any length", () => threeStrings("", half, ""));
attempt("two strings over the limit", () => twoStrings(half, half));
attempt("three strings over the limit", () => threeStrings(half, quarter, half));
attempt("four strings over the limit", () => fourStrings(quarter, half, quarter, "y"));
attempt("a number between", () => numberBetween(half, 7));
attempt("an object between", () => objectBetween(half, new Logged("middle")));
attempt("after the failures", () => nineParts("s", 2, 2.5, undefined, null, true, 2n, new Logged("o"), "x"));
