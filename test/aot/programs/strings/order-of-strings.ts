// < <= > >= on pairs of strings: equal texts, prefixes, 8-bit against 16-bit, surrogate pairs (the order is by code unit, not by code point), ropes and substrings, undefined and null; one comparison of a pair or all four, in loops, outside, and as the comparator of sort().
const opaque = new Function("value", "return value") as <T>(value: T) => T;
const unseen = new Function("f", "return (...values) => f(...values)") as <F>(f: F) => F;

const flat = (text: string): string => opaque(text.split("").join(""));
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const deepRope = (text: string): string => (text.length < 3 ? rope(text) : rope(text.slice(0, 2)) + flat(text.slice(2, -1)) + flat(text.slice(-1)));
const substring = (text: string): string => flat("<" + text + ">").slice(1, -1);
const wide = (text: string): string => flat(text + "☃").replace("☃", "");
const wideSubstring = (text: string): string => flat("☃" + text).slice(1);
const wideRope = (text: string): string => (text.length < 2 ? wide(text) : wide(text.slice(0, 1)) + wide(text.slice(1)));
const mixedRope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + wide(text.slice(1)));
const makers = [flat, rope, deepRope, substring, wide, wideSubstring, wideRope, mixedRope];

const texts = [
  "", "a", "b", "B", "aa", "ab", "abc", "abd", "abcdefg", "abcdefgh", "abcdefgi", "abcdefghi", "abcdefgh\0", "abcdefghabcdefgh", "abcdefghabcdefgi", "10", "9",
  "x".repeat(40), "x".repeat(39) + "y", "x".repeat(41),
  "\x7f", "\x80", "é", "ÿ", "aÿ", "Ā", "aĀ",
  "퟿", "\ud800", "\u{10000}", "\u{1F600}", "\u{1F600}a", "\udfff", "", "￿", "a\u{1F600}", "a￿",
];

const isLess = 1 | 2;
const isEqual = 2 | 8;
const isGreater = 4 | 8;
const describe = (mask: number): string => (mask === isLess ? "<" : mask === isEqual ? "=" : mask === isGreater ? ">" : mask === 0 ? "-" : "(" + mask + ")");
const quoted = (text: string): string => '"' + text.split("").map(unit => (unit.charCodeAt(0) >= 0x20 && unit.charCodeAt(0) < 0x7f ? unit : "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"))).join("") + '"';

function expectedOrder(a: string, b: string): number {
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i++) {
    const difference = a.charCodeAt(i) - b.charCodeAt(i);
    if (difference !== 0) return difference < 0 ? isLess : isGreater;
  }
  return a.length === b.length ? isEqual : a.length < b.length ? isLess : isGreater;
}

function allFour(a: string, b: string): number { return (a < b ? 1 : 0) | (a <= b ? 2 : 0) | (a > b ? 4 : 0) | (a >= b ? 8 : 0); }
function allFourOptional(a: string | undefined | null, b: string | undefined | null): number { return (a! < b! ? 1 : 0) | (a! <= b! ? 2 : 0) | (a! > b! ? 4 : 0) | (a! >= b! ? 8 : 0); }
function allFourUntyped(a: any, b: any): number { return (a < b ? 1 : 0) | (a <= b ? 2 : 0) | (a > b ? 4 : 0) | (a >= b ? 8 : 0); }
function allFourAsValues(a: string, b: string): number { return Number(a < b) | (Number(a <= b) << 1) | (Number(a > b) << 2) | (Number(a >= b) << 3); }
function less(a: string, b: string): boolean { return a < b; }
function lessOrEqual(a: string, b: string): boolean { return a <= b; }
function greater(a: string, b: string): boolean { return a > b; }
function greaterOrEqual(a: string, b: string): boolean { return a >= b; }
const calledLess = unseen(less), calledLessOrEqual = unseen(lessOrEqual), calledGreater = unseen(greater), calledGreaterOrEqual = unseen(greaterOrEqual);
function oneAtATime(a: string, b: string): number { return (calledLess(a, b) ? 1 : 0) | (calledLessOrEqual(a, b) ? 2 : 0) | (calledGreater(a, b) ? 4 : 0) | (calledGreaterOrEqual(a, b) ? 8 : 0); }
function sign(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function fromSign(a: string, b: string): number { const order = sign(a, b); return order < 0 ? isLess : order > 0 ? isGreater : isEqual; }
const masksBySign = [isLess, isEqual, isGreater];
function fromSignAsIndex(a: string, b: string): number { return masksBySign[sign(a, b) + 1]; }
const comparisons: ((a: string, b: string) => number)[] = [allFour, allFourOptional, allFourUntyped, allFourAsValues, oneAtATime, fromSign, fromSignAsIndex, unseen(allFour), unseen(allFourUntyped)];

let compared = 0;
let wrong = 0;
for (const first of makers) {
  for (const second of makers) {
    for (const x of texts) {
      for (const y of texts) {
        const expected = expectedOrder(x, y);
        const a = first(x), b = second(y);
        for (let k = 0; k < comparisons.length; k++) {
          const comparisonIndex = (compared + k) % comparisons.length;
          const mask = comparisons[comparisonIndex](a, b);
          if (mask !== expected && wrong++ < 20) console.log("comparison " + comparisonIndex + " of " + quoted(x) + " (" + makers.indexOf(first) + ") with " + quoted(y) + " (" + makers.indexOf(second) + "): " + describe(mask) + ", expected " + describe(expected));
        }
        compared++;
      }
    }
  }
}
console.log(compared + " pairs, " + wrong + " wrong");

function table(rows: string[], columns: string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    let line = "";
    for (let j = 0; j < columns.length; j++) {
      const b = columns[j];
      line += a < b ? "<" : a > b ? ">" : a <= b && a >= b ? "=" : "-";
    }
    lines.push(line);
  }
  return lines;
}
for (const line of table(texts.map(flat), texts.map(rope))) console.log(line);
console.log(String(table(texts.map(wideRope), texts.map(substring)).join() === table(texts.map(deepRope), texts.map(wide)).join()));

const same = rope("abcdefghi");
console.log("one cell " + describe(allFour(same, same)) + describe(allFourUntyped(same, same)) + describe(oneAtATime(same, same)));

const sometimesMissing: (string | undefined | null)[] = [undefined, null, flat(""), flat("a"), rope("10"), flat("0"), rope("null"), substring("undefined")];
for (const a of sometimesMissing) console.log("missing " + sometimesMissing.map(b => describe(allFourOptional(a, b)) + describe(allFourUntyped(a, b))).join(" "));

const others: unknown[] = [9, 10.5, NaN, true, 10n, [2], {}, { valueOf: () => 11 }, { toString: () => "b" }];
for (const text of ["10", "9", "a", ""]) console.log("against other values " + quoted(text) + " " + others.map(other => describe(allFourUntyped(rope(text), other)) + describe(allFourUntyped(other, wide(text)))).join(" "));

const sorted = texts.map(rope).reverse().sort(sign);
console.log(sorted.map(quoted).join(" "));
console.log("sort() agrees " + String(sorted.join("|") === texts.map(wide).sort().join("|")));
