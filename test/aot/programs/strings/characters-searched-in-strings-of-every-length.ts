// One character is searched for in strings of 0 to 80 characters, where it stands at every index or nowhere, from start positions of every kind: indexOf, includes, test and search with a regular expression of one character, split. The strings are 8-bit and 16-bit, flat, ropes and slices, and hold characters that share a byte with the sought one; a character above 0xff is sought in 8-bit strings too. Each answer is checked against a loop over the code units, and every line prints what plain Bun prints.
const never = Date.now() < 0;
const hidden = (text: string): string => (never ? text + "!" : text);
const flat = (text: string): string => hidden(text.split("").join(""));
const wideFlat = (text: string): string => JSON.parse(JSON.stringify([text, "\u2603"]))[0];

function indexOfX(s: string): number { return s.indexOf("x"); }
function indexOfXFrom(s: string, from: number): number { return s.indexOf("x", from); }
function indexOfXFromInteger(s: string, from: number): number { return s.indexOf("x", from | 0); }
function includesX(s: string): boolean { return s.includes("x"); }
function includesXFrom(s: string, from: number): boolean { return s.includes("x", from); }
function testX(s: string): boolean { return /x/.test(s); }
function searchX(s: string): number { return s.search(/x/); }
function partsAtX(s: string): number { return s.split("x").length; }
function countX(s: string): number { let count = 0; for (let at = s.indexOf("x"); at !== -1; at = s.indexOf("x", at + 1)) count++; return count; }

function indexOfAcute(s: string): number { return s.indexOf("\u00e9"); }
function indexOfAcuteFrom(s: string, from: number): number { return s.indexOf("\u00e9", from); }
function indexOfAcuteFromInteger(s: string, from: number): number { return s.indexOf("\u00e9", from | 0); }
function includesAcute(s: string): boolean { return s.includes("\u00e9"); }
function includesAcuteFrom(s: string, from: number): boolean { return s.includes("\u00e9", from); }
function testAcute(s: string): boolean { return /\u00e9/.test(s); }
function searchAcute(s: string): number { return s.search(/\u00e9/); }
function partsAtAcute(s: string): number { return s.split("\u00e9").length; }
function countAcute(s: string): number { let count = 0; for (let at = s.indexOf("\u00e9"); at !== -1; at = s.indexOf("\u00e9", at + 1)) count++; return count; }

function indexOfWide(s: string): number { return s.indexOf("\u0178"); }
function indexOfWideFrom(s: string, from: number): number { return s.indexOf("\u0178", from); }
function indexOfWideFromInteger(s: string, from: number): number { return s.indexOf("\u0178", from | 0); }
function includesWide(s: string): boolean { return s.includes("\u0178"); }
function includesWideFrom(s: string, from: number): boolean { return s.includes("\u0178", from); }
function testWide(s: string): boolean { return /\u0178/.test(s); }
function searchWide(s: string): number { return s.search(/\u0178/); }
function partsAtWide(s: string): number { return s.split("\u0178").length; }
function countWide(s: string): number { let count = 0; for (let at = s.indexOf("\u0178"); at !== -1; at = s.indexOf("\u0178", at + 1)) count++; return count; }

function indexOfGiven(s: string, sought: string, from: number): number { return s.indexOf(sought, from); }
function allAtOnce(s: string, from: number): number {
  return s.indexOf("x", from) + 100 * s.indexOf("\u00e9", from) + 10000 * s.indexOf("\u0178", from) + (s.includes("x", from) ? 1000000 : 0) + (/x/.test(s) ? 2000000 : 0) + (s.search(/\u00e9/) >= 0 ? 4000000 : 0);
}

type Searchers = {
  unit: number;
  given: string;
  indexOf: (s: string) => number;
  indexOfFrom: (s: string, from: number) => number;
  indexOfFromInteger: (s: string, from: number) => number;
  includes: (s: string) => boolean;
  includesFrom: (s: string, from: number) => boolean;
  test: (s: string) => boolean;
  search: (s: string) => number;
  parts: (s: string) => number;
  count: (s: string) => number;
};
const searchers: Searchers[] = [
  { unit: 0x78, given: flat("x"), indexOf: indexOfX, indexOfFrom: indexOfXFrom, indexOfFromInteger: indexOfXFromInteger, includes: includesX, includesFrom: includesXFrom, test: testX, search: searchX, parts: partsAtX, count: countX },
  { unit: 0xe9, given: flat("\u00e9"), indexOf: indexOfAcute, indexOfFrom: indexOfAcuteFrom, indexOfFromInteger: indexOfAcuteFromInteger, includes: includesAcute, includesFrom: includesAcuteFrom, test: testAcute, search: searchAcute, parts: partsAtAcute, count: countAcute },
  { unit: 0x178, given: flat("\u0178"), indexOf: indexOfWide, indexOfFrom: indexOfWideFrom, indexOfFromInteger: indexOfWideFromInteger, includes: includesWide, includesFrom: includesWideFrom, test: testWide, search: searchWide, parts: partsAtWide, count: countWide },
];

function firstFrom(text: string, unit: number, from: number): number {
  for (let i = from > 0 ? Math.floor(from) : 0; i < text.length; i++) if (text.charCodeAt(i) === unit) return i;
  return -1;
}
function occurrences(text: string, unit: number): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === unit) count++;
  return count;
}
function unitsOf(text: string): string {
  if (text.length > 100) return text.length + " units";
  let out = "";
  for (let i = 0; i < text.length; i++) out += (i ? "." : "") + text.charCodeAt(i).toString(16);
  return "'" + out + "'";
}

let hash = 0;
let answers = 0;
let wrong = 0;
function note(what: string, unit: number, form: number, text: string, from: number, got: number, want: number): void {
  hash = (Math.imul(hash, 31) + got) | 0;
  answers++;
  if (got !== want && wrong++ < 20) console.log("WRONG: " + what + " of " + unit.toString(16) + " in form " + form + " of " + unitsOf(text) + " from " + from + " is " + got + ", not " + want);
}

function exercise(text: string, forms: number): void {
  const length = text.length;
  const half = length >> 1;
  const whole = flat(text);
  const left = flat(text.slice(0, half));
  const right = flat(text.slice(half));
  const padded = flat("\u00e9x" + text + "x\u00e9");
  const wide = forms > 3 ? wideFlat(text) : whole;
  const widePadded = flat("\u0178x" + text + "x\u0178");
  const subject = (form: number): string => {
    switch (form) {
      case 0:
        return whole;
      case 1:
        return left + right;
      case 2:
        return padded.slice(2, -2);
      case 3:
        return wide;
      default:
        return widePadded.slice(2, -2);
    }
  };
  const starts = [-1, 0, 1.5, half, length - 1, length, length + 1, NaN, Infinity, -Infinity, 2 ** 32];
  for (const sought of searchers) {
    const unit = sought.unit;
    const first = firstFrom(whole, unit, 0);
    const count = occurrences(whole, unit);
    for (let form = 0; form < forms; form++) {
      note("indexOf", unit, form, text, 0, sought.indexOf(subject(form)), first);
      note("includes", unit, form, text, 0, Number(sought.includes(subject(form))), Number(first !== -1));
      note("test", unit, form, text, 0, Number(sought.test(subject(form))), Number(first !== -1));
      note("search", unit, form, text, 0, sought.search(subject(form)), first);
      note("split", unit, form, text, 0, sought.parts(subject(form)), count + 1);
      note("indexOf again and again", unit, form, text, 0, sought.count(subject(form)), count);
    }
    for (const from of starts) {
      const want = firstFrom(whole, unit, from);
      const wantFromInteger = firstFrom(whole, unit, from | 0);
      for (let form = 0; form < forms; form++) {
        note("indexOf", unit, form, text, from, sought.indexOfFrom(subject(form), from), want);
        note("indexOf at an integer", unit, form, text, from, sought.indexOfFromInteger(subject(form), from), wantFromInteger);
        note("includes", unit, form, text, from, Number(sought.includesFrom(subject(form), from)), Number(want !== -1));
        note("indexOf of a given character", unit, form, text, from, indexOfGiven(subject(form), sought.given, from), want);
      }
    }
  }
  for (const from of starts) {
    const x = firstFrom(whole, 0x78, from);
    const want = x + 100 * firstFrom(whole, 0xe9, from) + 10000 * firstFrom(whole, 0x178, from) + (x !== -1 ? 1000000 : 0) + (firstFrom(whole, 0x78, 0) !== -1 ? 2000000 : 0) + (firstFrom(whole, 0xe9, 0) !== -1 ? 4000000 : 0);
    for (let form = 0; form < forms; form++) note("all at once", 0, form, text, from, allAtOnce(subject(form), from), want);
  }
}

function textWith(marker: string, at: number, length: number, filler: string): string {
  let text = "";
  for (let i = 0; i < length; i++) text += i === at ? marker : filler[i % filler.length];
  return text;
}
const without = (filler: string, marker: string): string => filler.split(marker).join("");
const narrowFiller = "abXi\u00f8cdy\u00e9efgwx\u00c9h";
const wideFiller = "ab\u0278c\u7800\u01e9d\u00e9exf\u0178g\u7801\u78e9";

for (let length = 0; length <= 80; length++) {
  hash = 0;
  for (let at = -1; at < length; at++) exercise(textWith("x", at, length, without(narrowFiller, "x")), 5);
  for (const at of [-1, 0, length >> 1, length - 1]) {
    exercise(textWith("x", at, length, without(wideFiller, "x")), 3);
    exercise(textWith("\u00e9", at, length, without(narrowFiller, "\u00e9")), 5);
    exercise(textWith("\u00e9", at, length, without(wideFiller, "\u00e9")), 3);
    exercise(textWith("\u0178", at, length, without(wideFiller, "\u0178")), 3);
  }
  console.log(length + " characters: " + hash);
}

function inManyPieces(text: string): string {
  let rope = "";
  for (let i = 0; i < text.length; i += 7) rope += flat(text.slice(i, i + 7));
  return rope;
}
for (const length of [100, 1000, 5000]) {
  hash = 0;
  for (const at of [-1, 0, 31, 32, 33, length >> 1, length - 1]) {
    for (const filler of [narrowFiller, wideFiller]) {
      const text = textWith("x", at, length, without(without(filler, "x"), "\u00e9"));
      exercise(text, filler === narrowFiller ? 5 : 3);
      for (const sought of searchers) {
        const first = firstFrom(text, sought.unit, 0);
        note("indexOf in many pieces", sought.unit, 5, "", 0, sought.indexOf(inManyPieces(text)), first);
        note("indexOf in many pieces", sought.unit, 5, "", length - 40, sought.indexOfFrom(inManyPieces(text), length - 40), firstFrom(text, sought.unit, length - 40));
        note("includes in many pieces", sought.unit, 5, "", 0, Number(sought.includes(inManyPieces(text))), Number(first !== -1));
        note("test in many pieces", sought.unit, 5, "", 0, Number(sought.test(inManyPieces(text))), Number(first !== -1));
        note("search in many pieces", sought.unit, 5, "", 0, sought.search(inManyPieces(text)), first);
      }
    }
  }
  console.log(length + " characters: " + hash);
}
console.log(answers + " answers, " + wrong + " wrong");
