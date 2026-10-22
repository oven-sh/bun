// `exec` and `test` with the `g` and `y` flags: where the search starts for every kind of `lastIndex`, and what `lastIndex` is afterwards.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const names = ["operationAOTRegExpTest", "operationAOTRegExpTestBoxed", "operationAOTRegExpExec"];
const entries = () => names.reduce((sum, name) => sum + count(name), 0);
function legacy() {
  return [RegExp.lastMatch, RegExp.$1, RegExp.leftContext.length, RegExp.rightContext.length].join("|");
}
function show(value: unknown) {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "object" : String(value);
}

const narrow = "let total = 12 + -345 * x9 - 0x1f; // 678 done, 90";
const wide = "\u4e2d\u6587 " + narrow + " \u7d42 12\u5186";
const subjects = [narrow, wide, "", "7", "no digit", "12", "ab12"];

function all(pattern: RegExp, subject: string) {
  const found: string[] = [];
  pattern.lastIndex = 0;
  for (let turn = 0; turn < 40; turn++) {
    const match = pattern.exec(subject);
    if (!match) {
      found.push(`null@${pattern.lastIndex}`);
      break;
    }
    found.push(`${JSON.stringify(match)}@${match.index}>${pattern.lastIndex}`);
    if (match[0] === "") pattern.lastIndex++;
  }
  return found.join(" ") + " [" + legacy() + "]";
}
const patterns = [/\d+/g, /(\w)(\d)?/g, /\s*/g, /\d+/y, /[a-z]+|\s+/y, /(?:)/g, /x(?<digit>\d)/g, /(\d)(\d)/dg, /\d+$/gm, /[^\x00-\xff]+/g, /\d/gy, /(?=\d)/g, /\d{3}/g];
for (const pattern of patterns) for (const subject of subjects) console.log(String(pattern), JSON.stringify(subject.slice(0, 12)), all(pattern, subject));

function from(pattern: RegExp, subject: string, lastIndex: any, assigns = true) {
  if (assigns) (pattern as any).lastIndex = lastIndex;
  let tested: unknown, after: unknown;
  try {
    tested = pattern.test(subject);
  } catch (error) {
    tested = (error as Error).name;
  }
  after = pattern.lastIndex;
  if (assigns) (pattern as any).lastIndex = lastIndex;
  let made: unknown;
  try {
    made = JSON.stringify(pattern.exec(subject));
  } catch (error) {
    made = (error as Error).name;
  }
  return `${tested} ${show(after)} ${made} ${show(pattern.lastIndex)}`;
}
let conversions = 0;
const starts: any[] = [0, 1, 11, 12, 13, 49, 50, 51, 52, 1000, -1, -0, 1.5, 12.9, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 12, "12", "x", null, undefined, true, { valueOf() { conversions++; return 12; } }];
for (const start of starts) console.log(show(start), "|", from(/\d+/g, narrow, start), "|", from(/\d+/y, narrow, start), "|", from(/\d+/, narrow, start), "|", from(/\d+/g, wide, start), conversions);

const pairs = "a\u{1F600}b\u{1F601}c";
for (let start = 0; start <= pairs.length + 1; start++) console.log(start, from(/./gu, pairs, start), "|", from(/./g, pairs, start), "|", from(/[^a-z]/yv, pairs, start), "|", from(/\udE00|\udE01/g, pairs, start));

const fixed = /\d+/g;
Object.defineProperty(fixed, "lastIndex", { writable: false, value: 3 });
console.log(from(fixed, narrow, 3, false), from(fixed, "none", 3, false));
const frozen = Object.freeze(/\d+/y);
console.log(from(frozen, "12", 0, false), from(frozen, "ab", 0, false));

const words = /[a-z]+/g;
const parts: string[] = [];
for (let begin = 0; begin < 30; begin += 7) {
  words.lastIndex = 2;
  const piece = narrow.slice(begin, begin + 9);
  const match = words.exec(piece);
  const next = words.lastIndex;
  const again = words.test(narrow.slice(begin, begin + 9));
  parts.push(`${JSON.stringify(match)} ${next} ${again} ${words.lastIndex} ${match?.input === piece}`);
}
console.log(parts.join(" | "));

const before = entries();
let total = 0;
const digits = /\d+/g, letters = /[a-z]+/y, blanks = /\s+/g;
for (let turn = 0; turn < 300; turn++) {
  for (const subject of [narrow, wide]) {
    digits.lastIndex = 0;
    while (digits.exec(subject)) total++;
    blanks.lastIndex = 0;
    while (blanks.test(subject)) total++;
    for (let at = 0; at < 20; at++) {
      letters.lastIndex = at;
      if (letters.test(subject)) total += letters.lastIndex;
    }
  }
}
console.log(total, entries() - before < 600 ? "few entries" : "MANY ENTRIES");
