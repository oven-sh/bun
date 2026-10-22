// RegExp literals that nothing but matches ever touches, in a program that never reads what the last match left in `RegExp`: `test`, `exec`, `search` and `match` on every kind of subject give what plain Bun gives.
// Two literals with one text are two objects: `compile()`, an object in `lastIndex` or an own `exec` on one of them changes nothing for the other.
type Found = RegExpExecArray | RegExpMatchArray | null;

const digits = /(\d)(\d)?/;
const named = /(?<word>[a-z]+)-(?<number>\d+)/;
const ignoringCase = /b+c/i;
const codePoints = /(.)\d/u;
const withIndices = /(\d)(\d)?/d;
const everyDigit = /\d/g;
const atStart = /\d\d/y;
const plainText = /12/;

function show(found: Found): string {
  if (!found) return "null";
  const groups = found.groups ? JSON.stringify(found.groups) : "-";
  const indices = (found as RegExpExecArray).indices ? JSON.stringify((found as RegExpExecArray).indices) : "-";
  return `${JSON.stringify(found)}@${found.index} ${found.length} ${groups} ${indices}`;
}
function join(left: string, right: string): string {
  return left + right;
}
function cut(whole: string, from: number, to: number): string {
  return whole.slice(from, to);
}

const narrow = "ab-12 BBc 345 e6";
const wide = "中文 ab-12 \u{1f600}3 bbC 45";
const subjects: [string, () => string][] = [
  ["flat", () => narrow],
  ["rope", () => join(cut(narrow, 0, 4), cut(narrow, 4, narrow.length))],
  ["substring", () => cut("<<<" + narrow + ">>>", 3, 3 + narrow.length)],
  ["16-bit", () => wide],
  ["16-bit rope", () => join(cut(wide, 0, 9), cut(wide, 9, wide.length))],
  ["8-bit and 16-bit rope", () => join("7 ", wide)],
  ["half a pair", () => cut(wide, 10, wide.length)],
  ["no match", () => join("no ", "match")],
  ["empty", () => ""],
];

for (const [name, subject] of subjects) {
  console.log(name, "digits", digits.test(subject()), show(digits.exec(subject())), subject().search(digits), show(subject().match(digits)));
  console.log(name, "named", named.test(subject()), show(named.exec(subject())), subject().search(named), show(subject().match(named)));
  console.log(name, "ignoringCase", ignoringCase.test(subject()), show(ignoringCase.exec(subject())), subject().search(ignoringCase), show(subject().match(ignoringCase)));
  console.log(name, "codePoints", codePoints.test(subject()), show(codePoints.exec(subject())), subject().search(codePoints), show(subject().match(codePoints)));
  console.log(name, "withIndices", withIndices.test(subject()), show(withIndices.exec(subject())), subject().search(withIndices), show(subject().match(withIndices)));
  console.log(name, "plainText", plainText.test(subject()), show(plainText.exec(subject())), subject().search(plainText), show(subject().match(plainText)));
  console.log(name, "everyDigit", everyDigit.test(subject()), everyDigit.lastIndex, show(everyDigit.exec(subject())), everyDigit.lastIndex, subject().search(everyDigit), everyDigit.lastIndex, show(subject().match(everyDigit)), everyDigit.lastIndex);
  console.log(name, "atStart", atStart.test(subject()), atStart.lastIndex, show(atStart.exec(subject())), atStart.lastIndex, subject().search(atStart), atStart.lastIndex, show(subject().match(atStart)), atStart.lastIndex);
}

for (const start of [0, 3, 4, 1.5, -1, 100, 2 ** 40, NaN, Infinity, -0]) {
  everyDigit.lastIndex = start;
  atStart.lastIndex = start;
  console.log(start, everyDigit.test(narrow), everyDigit.lastIndex, atStart.test(narrow), atStart.lastIndex);
  digits.lastIndex = start;
  console.log(start, digits.test(narrow), digits.lastIndex, show(digits.exec(narrow)), digits.lastIndex);
}

function inLoop(text: string): number {
  let hits = 0;
  for (let turn = 0; turn < 2000; turn++) {
    if (/(\d+)-x/.test(text + turn + "-x")) hits++;
    if (/^[a-z]+$/.exec(text) !== null) hits += 2;
    if ((text + turn).search(/9$/) >= 0) hits += 4;
    if ((text + turn).match(/(7)(7)/)) hits += 8;
  }
  return hits;
}
console.log(inLoop("abc"), inLoop("中"));

const kept = /a+b/;
const compiledAgain = /a+b/;
console.log(kept.test("aab"), compiledAgain.test("aab"), kept.test("ccd"), compiledAgain.test("ccd"));
(compiledAgain as any).compile("c+d", "g");
console.log(kept.test("aab"), compiledAgain.test("aab"), kept.test("ccd"), compiledAgain.test("ccd"), compiledAgain.lastIndex);
console.log(kept.source, kept.flags, kept.global, compiledAgain.source, compiledAgain.flags, compiledAgain.global);

const calls: string[] = [];
const untouched = /x+y/g;
const converted = /x+y/g;
(converted as any).lastIndex = {
  valueOf() {
    calls.push("valueOf");
    return 2;
  },
};
console.log(untouched.test("xy xxy"), untouched.lastIndex, converted.test("xy xxy"), converted.lastIndex, calls.join());
const convertedWithoutFlags = /x+y/;
(convertedWithoutFlags as any).lastIndex = {
  valueOf() {
    calls.push("valueOf without flags");
    return 2;
  },
};
console.log(convertedWithoutFlags.test("xy xxy"), typeof convertedWithoutFlags.lastIndex, show(convertedWithoutFlags.exec("xy xxy")), calls.join());
const withText = /x+y/g;
(withText as any).lastIndex = "3";
console.log(withText.test("xy xxy"), withText.lastIndex);

const ordinary = /p+q/;
const withOwnExec = /p+q/;
(withOwnExec as any).exec = () => null;
console.log(ordinary.test("ppq"), withOwnExec.test("ppq"), "ppq".search(ordinary), "ppq".search(withOwnExec));
