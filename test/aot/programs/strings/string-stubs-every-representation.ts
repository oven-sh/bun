// `===`, `<`, `>`, `charCodeAt` and the three trims on every internal representation of a string: flat, substring, rope of two and rope of a rope, 8-bit and 16-bit, and empty.
// Arrays of code units supply the expected answers. Every operation gets fresh strings, because a slow path may flatten a rope in place.
type Units = number[];
type Kind = { name: string; create: (units: Units) => string };

const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
// Without counters the function is absent or returns null.
const canCount = typeof (globalThis as any).aotOperationCount === "function" && count("operationAOTStringsAreEqual") !== null;

export function equal(left: string, right: string): boolean {
  return left === right;
}
export function less(left: string, right: string): boolean {
  return left < right;
}
export function greater(left: string, right: string): boolean {
  return left > right;
}
export function codeUnitAt(text: string, index: number): number {
  return text.charCodeAt(index);
}
export function trimBoth(text: string): string {
  return text.trim();
}
export function trimStart(text: string): string {
  return text.trimStart();
}
export function trimEnd(text: string): string {
  return text.trimEnd();
}
export function slice(text: string, from: number, to: number): string {
  return text.slice(from, to);
}
export function concatenate(left: string, right: string): string {
  return left + right;
}

const unitsOf = (text: string): Units => Array.from(text, character => character.charCodeAt(0));
const changedAt = (units: Units, at: number, unit: number): Units => units.map((old, index) => (index === at ? unit : old));
const flat = (units: Units): string => String.fromCharCode(...units);
// The two padding characters differ, so an offset that is wrong by one changes the text.
const substringOf =
  (padding: Units) =>
  (units: Units): string =>
    slice(flat([...padding, ...units, ...padding]), padding.length, padding.length + units.length);
const narrowSubstring = substringOf(unitsOf("<>"));
const wideSubstring = substringOf(unitsOf("ā>"));

const kinds: Kind[] = [
  { name: "flat", create: flat },
  { name: "substring", create: narrowSubstring },
  { name: "substring of 16 bits", create: wideSubstring },
  {
    name: "rope of two",
    create: units => {
      const middle = units.length >> 1;
      return concatenate(flat(units.slice(0, middle)), flat(units.slice(middle)));
    },
  },
  {
    name: "rope of a rope",
    create: units => {
      const third = Math.ceil(units.length / 3);
      return concatenate(concatenate(flat(units.slice(0, third)), flat(units.slice(third, 2 * third))), flat(units.slice(2 * third)));
    },
  },
];

// 23 code units: two words of eight bytes, one of four and three single bytes.
const alphabet = unitsOf("abcdefghijklmnopqrstuvw");
const lastChanged = changedAt(alphabet, alphabet.length - 1, 0x78);
const shorter = alphabet.slice(0, -1);
const texts: Units[] = [
  [],
  ...[1, 2, 3, 4, 7, 8, 9, 16].map(length => alphabet.slice(0, length)),
  shorter,
  alphabet,
  lastChanged,
  ...[0, 3, 4, 7, 8, 15, 16, 19, 20].map(at => changedAt(alphabet, at, alphabet[at] + 1)),
  // The earlier difference decides, though it is the less significant byte of a word loaded on a little-endian CPU.
  changedAt(changedAt(alphabet, 1, 0x7a), 6, 0x41),
  changedAt(changedAt(alphabet, 16, 0x7a), 19, 0x41),
  [0x7f],
  [0x80],
  [0xff],
  changedAt(alphabet, 10, 0x7f),
  changedAt(alphabet, 10, 0xff),
  [0x101],
  [0x101, 0x62],
  changedAt(alphabet.slice(0, 8), 7, 0x101),
  changedAt(alphabet, 0, 0x101),
  changedAt(alphabet, 12, 0x101),
  changedAt(alphabet, 22, 0x101),
  changedAt(alphabet, 22, 0x102),
];

let failures = 0;
function check(isCorrect: boolean, ...context: unknown[]): void {
  if (isCorrect) return;
  failures++;
  if (failures <= 20) console.log("WRONG:", ...context);
}
function order(left: Units, right: Units): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return Math.sign(left.length - right.length);
}
function hasUnits(text: string, units: Units): boolean {
  if (text.length !== units.length) return false;
  for (let index = 0; index < units.length; index++) {
    if (text.charCodeAt(index) !== units[index]) return false;
  }
  return true;
}

for (const leftKind of kinds) {
  for (const rightKind of kinds) {
    let equalPairs = 0;
    let lessPairs = 0;
    let greaterPairs = 0;
    for (const left of texts) {
      for (const right of texts) {
        const expected = order(left, right);
        const isEqual = equal(leftKind.create(left), rightKind.create(right));
        const isLess = less(leftKind.create(left), rightKind.create(right));
        const isGreater = greater(leftKind.create(left), rightKind.create(right));
        check(isEqual === (expected === 0), "===", leftKind.name, left, rightKind.name, right);
        check(isLess === (expected < 0), "<", leftKind.name, left, rightKind.name, right);
        check(isGreater === (expected > 0), ">", leftKind.name, left, rightKind.name, right);
        if (isEqual) equalPairs++;
        if (isLess) lessPairs++;
        if (isGreater) greaterPairs++;
      }
    }
    console.log(`${leftKind.name} | ${rightKind.name}: ${equalPairs} equal, ${lessPairs} less, ${greaterPairs} greater`);
  }
}

for (const kind of kinds) {
  let sum = 0;
  let outside = 0;
  for (const units of texts) {
    for (const index of [-1, 0, units.length - 1, units.length]) {
      const expected = index >= 0 && index < units.length ? units[index] : NaN;
      const text = kind.create(units);
      const first = codeUnitAt(text, index);
      check(Object.is(first, expected), "charCodeAt", kind.name, units, index, first);
      check(Object.is(codeUnitAt(text, index), expected), "second charCodeAt", kind.name, units, index);
      if (Number.isNaN(first)) outside++;
      else sum += first;
    }
    const same = kind.create(units);
    check(equal(same, same) && !less(same, same) && !greater(same, same), "a string against itself", kind.name, units);
    check(hasUnits(kind.create(units), units), "every code unit", kind.name, units);
  }
  console.log(`${kind.name}: code units add up to ${sum}, ${outside} reads outside`);
}

const whiteSpace = [
  ...[0x20, 0xa0, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1680],
  ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
  ...[0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff],
];
// U+180E and U+200B were or look like white space. The others are the neighbors of the white-space characters.
const notWhiteSpace = [
  ...[0x180e, 0x200b, 0x08, 0x0e, 0x1f, 0x21, 0x85, 0x9f, 0xa1, 0x167f, 0x1681, 0x1fff],
  ...[0x2027, 0x202a, 0x202e, 0x2030, 0x205e, 0x2060, 0x2fff, 0x3001, 0xfefe, 0xff00],
];
function trimmedUnits(units: Units, atStart: boolean, atEnd: boolean): Units {
  let start = 0;
  let end = units.length;
  if (atStart) while (start < end && whiteSpace.includes(units[start])) start++;
  if (atEnd) while (end > start && whiteSpace.includes(units[end - 1])) end--;
  return units.slice(start, end);
}
const cores: Units[] = [[], unitsOf("x"), unitsOf("ā"), unitsOf("a b"), alphabet, changedAt(alphabet, 12, 0x101)];
const edges: [Units, Units][] = [
  [[], []],
  [[0x20], []],
  [[], [0x20]],
  ...[...whiteSpace, ...notWhiteSpace].map((unit): [Units, Units] => [
    [0x20, unit],
    [unit, 0x0a],
  ]),
];
for (const kind of kinds) {
  let trimmedLength = 0;
  for (const [prefix, suffix] of edges) {
    for (const core of cores) {
      const units = [...prefix, ...core, ...suffix];
      const both = trimBoth(kind.create(units));
      const start = trimStart(kind.create(units));
      const end = trimEnd(kind.create(units));
      check(hasUnits(both, trimmedUnits(units, true, true)), "trim", kind.name, units, unitsOf(both));
      check(hasUnits(start, trimmedUnits(units, true, false)), "trimStart", kind.name, units, unitsOf(start));
      check(hasUnits(end, trimmedUnits(units, false, true)), "trimEnd", kind.name, units, unitsOf(end));
      trimmedLength += both.length + start.length + end.length;
    }
  }
  console.log(`${kind.name}: ${trimmedLength} code units left after trimming`);
}

for (const kind of kinds) {
  console.log(
    `${kind.name}: same text ${equal(kind.create(alphabet), flat(alphabet))}, last byte differs ${equal(kind.create(alphabet), flat(lastChanged))}, length differs ${equal(kind.create(alphabet), flat(shorter))}`,
  );
}

const rounds = 10_000;
const flatText = flat(alphabet);
const flatCopy = flat(alphabet);
const flatChanged = flat(lastChanged);
const narrowPart = narrowSubstring(alphabet);
const otherNarrowPart = narrowSubstring(alphabet);

let answers = 0;
let before = count("operationAOTStringsAreEqual");
for (let round = 0; round < rounds; round++) {
  if (equal(flatText, flatCopy)) answers++;
  if (equal(flatText, flatChanged)) answers++;
  if (equal(narrowPart, otherNarrowPart)) answers++;
  if (equal(narrowPart, flatCopy)) answers++;
}
let calls = count("operationAOTStringsAreEqual") - before;
console.log(answers, calls === 0 ? "=== on 8-bit flat strings and substrings calls no operation" : `=== CALLED THE OPERATION ${calls} TIMES`);

answers = 0;
before = count("operationAOTCompareStrings");
for (let round = 0; round < rounds; round++) {
  if (less(flatText, flatChanged)) answers++;
  if (less(flatChanged, flatText)) answers++;
  if (less(flatText, flatCopy)) answers++;
}
calls = count("operationAOTCompareStrings") - before;
console.log(answers, calls === 0 ? "< on 8-bit flat strings calls no operation" : `< CALLED THE OPERATION ${calls} TIMES`);

before = count("operationAOTStringsAreEqual");
const isSameText = equal(flatText, wideSubstring(alphabet));
calls = count("operationAOTStringsAreEqual") - before;
console.log(isSameText, !canCount || calls > 0 ? "8 bits against 16 bits calls the operation" : "8 BITS AGAINST 16 BITS DID NOT CALL THE OPERATION");

console.log(failures === 0 ? "every answer matches the code units" : `${failures} WRONG ANSWERS`);
