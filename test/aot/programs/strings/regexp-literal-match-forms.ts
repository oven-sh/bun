// `test`, `exec`, `search` and `match` of RegExp literals with no flag, `g`, `y`, `gy`, `u` and `d`: every kind of subject, every kind of `lastIndex`, one pattern with and without `g`, literals that get no code, and what `RegExp.$1` holds afterward.
type Found = RegExpExecArray | RegExpMatchArray | null;
type Forms = {
  literal: RegExp;
  test(s: string): boolean;
  exec(s: string): Found;
  search(s: string): number;
  match(s: string): Found;
};

const plain = /(\d)(\d)?/;
const global = /(\d)(\d)?/g;
const sticky = /(\d)(\d)?/y;
const globalSticky = /(\d)(\d)?/gy;
const unicode = /(\d)(\d)?/u;
const indices = /(\d)(\d)?/d;
const anyCodePoint = /(.)(\d)?/u;
const anyCodePointGlobal = /(.)(\d)?/gu;
const anyCodePointSticky = /(.)(\d)?/uy;
const text = /12/;
const textGlobal = /12/g;
const withoutCode = /(\d)(\d)?|x{2147483648}/;
const withoutCodeGlobal = /(\d)(\d)?|x{2147483648}/g;
const withoutCodeSticky = /(\d)(\d)?|x{2147483648}/y;

const literals: Forms[] = [
  { literal: plain, test: s => plain.test(s), exec: s => plain.exec(s), search: s => s.search(plain), match: s => s.match(plain) },
  { literal: global, test: s => global.test(s), exec: s => global.exec(s), search: s => s.search(global), match: s => s.match(global) },
  { literal: sticky, test: s => sticky.test(s), exec: s => sticky.exec(s), search: s => s.search(sticky), match: s => s.match(sticky) },
  { literal: globalSticky, test: s => globalSticky.test(s), exec: s => globalSticky.exec(s), search: s => s.search(globalSticky), match: s => s.match(globalSticky) },
  { literal: unicode, test: s => unicode.test(s), exec: s => unicode.exec(s), search: s => s.search(unicode), match: s => s.match(unicode) },
  { literal: indices, test: s => indices.test(s), exec: s => indices.exec(s), search: s => s.search(indices), match: s => s.match(indices) },
  { literal: anyCodePoint, test: s => anyCodePoint.test(s), exec: s => anyCodePoint.exec(s), search: s => s.search(anyCodePoint), match: s => s.match(anyCodePoint) },
  { literal: anyCodePointGlobal, test: s => anyCodePointGlobal.test(s), exec: s => anyCodePointGlobal.exec(s), search: s => s.search(anyCodePointGlobal), match: s => s.match(anyCodePointGlobal) },
  { literal: anyCodePointSticky, test: s => anyCodePointSticky.test(s), exec: s => anyCodePointSticky.exec(s), search: s => s.search(anyCodePointSticky), match: s => s.match(anyCodePointSticky) },
  { literal: text, test: s => text.test(s), exec: s => text.exec(s), search: s => s.search(text), match: s => s.match(text) },
  { literal: textGlobal, test: s => textGlobal.test(s), exec: s => textGlobal.exec(s), search: s => s.search(textGlobal), match: s => s.match(textGlobal) },
  { literal: withoutCode, test: s => withoutCode.test(s), exec: s => withoutCode.exec(s), search: s => s.search(withoutCode), match: s => s.match(withoutCode) },
  { literal: withoutCodeGlobal, test: s => withoutCodeGlobal.test(s), exec: s => withoutCodeGlobal.exec(s), search: s => s.search(withoutCodeGlobal), match: s => s.match(withoutCodeGlobal) },
  { literal: withoutCodeSticky, test: s => withoutCodeSticky.test(s), exec: s => withoutCodeSticky.exec(s), search: s => s.search(withoutCodeSticky), match: s => s.match(withoutCodeSticky) },
];

const narrow = "ab 12 cd 345 e6";
const wide = "中文 12 \u{1f600}3 終 45";
function join(left: string, right: string): string {
  return left + right;
}
function cut(whole: string, from: number, to: number): string {
  return whole.slice(from, to);
}
const subjects: [string, () => string][] = [
  ["flat", () => narrow],
  ["rope", () => join(cut(narrow, 0, 4), cut(narrow, 4, narrow.length))],
  ["substring", () => cut("<<<" + narrow + ">>>", 3, 3 + narrow.length)],
  ["16-bit", () => wide],
  ["16-bit rope", () => join(cut(wide, 0, 4), cut(wide, 4, wide.length))],
  ["8-bit and 16-bit rope", () => join("7 ", wide)],
  ["16-bit substring", () => cut("中<<" + wide + ">>", 3, 3 + wide.length)],
  ["no digit", () => join("no ", "digit")],
  ["one digit", () => "7"],
  ["empty", () => ""],
];

const log: string[] = [];
const lastIndexes: [string, () => unknown][] = [
  ["0", () => 0],
  ["3", () => 3],
  ["7", () => 7],
  ["-1", () => -1],
  ["1.5", () => 1.5],
  ["past the end", () => 100],
  ["2 ** 32 + 3", () => 2 ** 32 + 3],
  ["valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["symbol", () => Symbol.iterator],
];

function legacy(): string {
  return [RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp.leftContext.length].join("|");
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (!Array.isArray(value)) return typeof value === "object" && value !== null ? "object" : String(value);
  const found = value as RegExpMatchArray;
  return `${JSON.stringify(found)}@${found.index}${found.indices ? JSON.stringify(found.indices) : ""}`;
}

function attempt(action: () => unknown): string {
  try {
    return show(action());
  } catch (error) {
    return (error as Error).name;
  }
}

const formNames = ["test", "exec", "search", "match"] as const;
for (const forms of literals) {
  for (const formName of formNames) {
    console.log(`${forms.literal} ${formName}`);
    for (const [subjectName, createSubject] of subjects) {
      const cells = lastIndexes.map(([lastIndexName, createLastIndex]) => {
        (forms.literal as any).lastIndex = createLastIndex();
        const result = attempt(() => forms[formName](createSubject()));
        return `${lastIndexName}: ${result} ${show((forms.literal as any).lastIndex)} ${log.splice(0).length} [${legacy()}]`;
      });
      console.log(`  ${subjectName}: ${cells.join(", ")}`);
    }
  }
}

function walk(forms: Forms, s: string): string {
  forms.literal.lastIndex = 0;
  const steps: string[] = [];
  for (let step = 0; step < 8; step++) steps.push(`${forms.test(s)} ${forms.literal.lastIndex} ${RegExp.$1}`);
  forms.literal.lastIndex = 0;
  for (let step = 0; step < 8; step++) steps.push(`${show(forms.exec(s))} ${forms.literal.lastIndex}`);
  return steps.join(", ");
}
for (const forms of literals) console.log(`repeated ${forms.literal}: ${walk(forms, narrow)} | ${walk(forms, wide)}`);

function testInline(s: string): string {
  return [/(\d)(\d)?/.test(s), /(\d)(\d)?/g.test(s), /(\d)(\d)?/y.test(s), /(\d)(\d)?/gy.test(s), /(\d)(\d)?/u.test(s), /(\d)(\d)?/d.test(s), /(\d)(\d)?|x{2147483648}/.test(s)].join();
}
function execInline(s: string): string {
  return [/(\d)(\d)?/.exec(s), /(\d)(\d)?/g.exec(s), /(\d)(\d)?/y.exec(s), /(\d)(\d)?/gy.exec(s), /(\d)(\d)?/u.exec(s), /(\d)(\d)?/d.exec(s), /(\d)(\d)?|x{2147483648}/.exec(s)].map(show).join();
}
function searchInline(s: string): string {
  return [s.search(/(\d)(\d)?/), s.search(/(\d)(\d)?/g), s.search(/(\d)(\d)?/y), s.search(/(\d)(\d)?/gy), s.search(/(\d)(\d)?/u), s.search(/(\d)(\d)?/d), s.search(/(\d)(\d)?|x{2147483648}/)].join();
}
function matchInline(s: string): string {
  return [s.match(/(\d)(\d)?/), s.match(/(\d)(\d)?/g), s.match(/(\d)(\d)?/y), s.match(/(\d)(\d)?/gy), s.match(/(\d)(\d)?/u), s.match(/(\d)(\d)?/d), s.match(/(\d)(\d)?|x{2147483648}/)].map(show).join();
}
for (const [subjectName, createSubject] of subjects) {
  for (let round = 0; round < 2; round++) {
    console.log(`inline, ${subjectName}: ${testInline(createSubject())} [${legacy()}] ${execInline(createSubject())} ${searchInline(createSubject())} ${matchInline(createSubject())} [${legacy()}]`);
  }
}

function fix(re: RegExp, value: number): RegExp {
  return Object.defineProperty(re, "lastIndex", { writable: false, value });
}
function withReadOnlyLastIndex(s: string, value: number): string {
  const none = fix(/(\d)(\d)?/, value);
  const g = fix(/(\d)(\d)?/g, value);
  const y = fix(/(\d)(\d)?/y, value);
  return [
    attempt(() => none.test(s)), attempt(() => none.exec(s)), attempt(() => s.search(none)), attempt(() => s.match(none)),
    attempt(() => g.test(s)), attempt(() => g.exec(s)), attempt(() => s.search(g)), attempt(() => s.match(g)),
    attempt(() => y.test(s)), attempt(() => y.exec(s)), attempt(() => s.search(y)), attempt(() => s.match(y)),
    none.lastIndex, g.lastIndex, y.lastIndex,
  ].join(" ");
}
for (const [subjectName, createSubject] of subjects) {
  console.log(`read-only lastIndex, ${subjectName}: at 0 ${withReadOnlyLastIndex(createSubject(), 0)} | at 3 ${withReadOnlyLastIndex(createSubject(), 3)}`);
}

export {};
