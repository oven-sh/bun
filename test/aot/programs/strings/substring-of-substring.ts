// `trim`, `slice`, `===`, `<` and `charCodeAt` on every internal representation of a string: flat, substring, substring of a substring and rope, 8-bit and 16-bit. Arrays of code units supply the expected answers.
type Units = number[];
type Kind = { name: string; create: (units: Units) => string };
type Variant = { name: string; minLength: number; change: (units: Units) => Units };

export function trimmed(text: string): string {
  return text.trim();
}
export function sliced(text: string, from: number, to: number): string {
  return text.slice(from, to);
}
export function equal(left: string, right: string): boolean {
  return left === right;
}
export function less(left: string, right: string): boolean {
  return left < right;
}
export function codeUnit(text: string, index: number): number {
  return text.charCodeAt(index);
}
export function concatenated(left: string, right: string): string {
  return left + right;
}

const unitsOf = (text: string): Units => Array.from(text, character => character.charCodeAt(0));
const flat = (units: Units): string => String.fromCharCode(...units);

// Neighboring padding characters differ, so an offset that is wrong by one changes the text.
function substringKinds(width: string, padding: Units): Kind[] {
  const longPadding = Array.from({ length: 7 }, () => padding).flat();
  return [
    {
      name: `${width} substring`,
      create: units => sliced(flat([...padding, ...units, ...padding]), padding.length, padding.length + units.length),
    },
    {
      name: `${width} substring of a substring`,
      create: units => {
        const base = flat([...longPadding, ...units, ...longPadding]);
        const outer = sliced(base, longPadding.length - 3, longPadding.length + units.length + 3);
        return sliced(outer, 3, 3 + units.length);
      },
    },
    {
      name: `${width} substring of a rope`,
      create: units => {
        const middle = units.length >> 1;
        const first = flat([...longPadding, ...units.slice(0, middle)]);
        const second = flat([...units.slice(middle), ...longPadding]);
        return sliced(concatenated(first, second), longPadding.length, longPadding.length + units.length);
      },
    },
  ];
}

// Each half needs over 20 code units.
const ropeOf = (first: Kind, second: Kind): Kind => ({
  name: `rope: ${first.name} + ${second.name}`,
  create: units => {
    const middle = units.length >> 1;
    return concatenated(first.create(units.slice(0, middle)), second.create(units.slice(middle)));
  },
});

const flatKind: Kind = { name: "flat", create: flat };
const narrowKinds = substringKinds("8-bit", unitsOf("<[{"));
const wideKinds = substringKinds("16-bit", unitsOf("<ā{"));
const kinds = [flatKind, ...narrowKinds, ...wideKinds];
const ropeKinds = [
  ropeOf(flatKind, flatKind),
  ropeOf(narrowKinds[0], narrowKinds[0]),
  ropeOf(flatKind, wideKinds[0]),
  ropeOf(wideKinds[0], wideKinds[0]),
];
const longKinds = [...kinds, ...ropeKinds];

function isWhiteSpace(unit: number): boolean {
  return (
    unit === 0x20 ||
    unit === 0xa0 ||
    (unit >= 0x09 && unit <= 0x0d) ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000 ||
    unit === 0xfeff
  );
}
function trimmedUnits(units: Units): Units {
  let start = 0;
  let end = units.length;
  while (start < end && isWhiteSpace(units[start])) start++;
  while (end > start && isWhiteSpace(units[end - 1])) end--;
  return units.slice(start, end);
}
function order(left: Units, right: Units): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return Math.sign(left.length - right.length);
}

let checks = 0;
let failures = 0;
function check(isCorrect: boolean, ...context: unknown[]): void {
  checks++;
  if (isCorrect) return;
  failures++;
  if (failures <= 20) console.log("WRONG:", ...context);
}
function hasUnits(text: string, units: Units): boolean {
  if (text.length !== units.length) return false;
  for (let index = 0; index < units.length; index++) {
    if (codeUnit(text, index) !== units[index]) return false;
  }
  return Number.isNaN(codeUnit(text, -1)) && Number.isNaN(codeUnit(text, units.length));
}

const lengths = [0, 1, 2, 7, 8, 9, 16];
const narrowGap = unitsOf(" \t\n\u00a0\r\u000b\u000c  ");
const wideGap = unitsOf(" \u3000\u2003\ufeff\u1680\u2028\u2029\u202f\u205f");
const textWith = (gap: Units, letter: string): Units => [
  ...unitsOf(`  ${letter}b c`),
  ...gap,
  ...gap,
  ...unitsOf(`d${letter} efghijklmnop${letter}rstuvwxyz0123456789 `),
  ...gap,
];
const texts = [textWith(narrowGap, "a"), textWith(narrowGap, "ā"), textWith(wideGap, "ā")];

for (const kind of kinds) {
  const checksBefore = checks;
  let trimmedLength = 0;
  for (const text of texts) {
    for (const length of lengths) {
      for (let from = 0; from + length <= text.length; from++) {
        const units = text.slice(from, from + length);
        const inner = units.slice(1, length - 1);
        check(hasUnits(kind.create(units), units), "charCodeAt", kind.name, from, length);
        check(hasUnits(trimmed(kind.create(units)), trimmedUnits(units)), "trim", kind.name, from, length);
        check(hasUnits(sliced(kind.create(units), 1, length - 1), inner), "slice", kind.name, from, length);
        check(
          hasUnits(trimmed(sliced(kind.create(units), 1, length - 1)), trimmedUnits(inner)),
          "trim of a slice",
          kind.name,
          from,
          length,
        );
        trimmedLength += trimmed(kind.create(units)).length;
      }
    }
  }
  console.log(`${kind.name}: ${checks - checksBefore} checks, ${trimmedLength} code units after trim`);
}

const withIncrementedUnit = (units: Units, at: number): Units =>
  units.map((unit, index) => (index === at ? unit + 1 : unit));
const variants: Variant[] = [
  { name: "same text", minLength: 0, change: units => units },
  {
    name: "differ only in the last code unit",
    minLength: 1,
    change: units => withIncrementedUnit(units, units.length - 1),
  },
  { name: "differ only in the first code unit", minLength: 1, change: units => withIncrementedUnit(units, 0) },
  { name: "differ only in length", minLength: 0, change: units => [...units, 0x21] },
];
function comparePairs(title: string, comparedKinds: Kind[], contents: Units[]): void {
  for (const variant of variants) {
    let pairs = 0;
    let equalPairs = 0;
    let ascendingPairs = 0;
    for (const units of contents) {
      if (units.length < variant.minLength) continue;
      const changed = variant.change(units);
      const expected = order(units, changed);
      for (const left of comparedKinds) {
        for (const right of comparedKinds) {
          const isEqual = equal(left.create(units), right.create(changed));
          const isAscending = less(left.create(units), right.create(changed));
          const isDescending = less(right.create(changed), left.create(units));
          check(
            isEqual === (expected === 0) && isAscending === (expected < 0) && isDescending === (expected > 0),
            variant.name,
            left.name,
            right.name,
            units.length,
          );
          pairs++;
          if (isEqual) equalPairs++;
          if (isAscending) ascendingPairs++;
        }
      }
    }
    console.log(`${title}, ${variant.name}: ${equalPairs} of ${pairs} pairs are equal, ${ascendingPairs} ascend`);
  }
}
const windows: Units[] = [];
for (const text of texts) {
  for (const length of lengths) {
    for (const from of [0, 6, 25, 41]) windows.push(text.slice(from, from + length));
  }
}
comparePairs("0 to 16 code units", kinds, windows);
comparePairs("69 code units", longKinds, texts);

// A new rope for every read: the first read flattens it.
for (const kind of ropeKinds) {
  const checksBefore = checks;
  for (const text of texts) {
    for (let index = -1; index <= text.length; index++) {
      const expected = index >= 0 && index < text.length ? text[index] : NaN;
      check(Object.is(codeUnit(kind.create(text), index), expected), "charCodeAt", kind.name, index);
    }
    check(hasUnits(trimmed(kind.create(text)), trimmedUnits(text)), "trim", kind.name);
    for (const length of lengths) {
      const units = text.slice(30, 30 + length);
      check(hasUnits(sliced(kind.create(text), 30, 30 + length), units), "slice", kind.name, length);
    }
  }
  console.log(`${kind.name}: ${checks - checksBefore} checks`);
}

const hex = (text: string): string =>
  Array.from({ length: text.length }, (_, index) => codeUnit(text, index).toString(16)).join(".");
for (const kind of wideKinds) {
  console.log(
    `${kind.name}, one code unit:`,
    hex(kind.create([0x62])),
    hex(kind.create([0x101])),
    equal(kind.create([0x62]), "b"),
    equal(kind.create([0x101]), "ā"),
    equal(kind.create([0x62]), kind.create([0x101])),
  );
}

for (const kind of kinds) {
  const results = lengths.map(length => trimmed(kind.create(texts[1].slice(27, 27 + length))));
  console.log(`${kind.name}, nothing to trim:`, results.join("|"));
}
for (const kind of longKinds) {
  for (const text of texts) {
    const units = trimmedUnits(text);
    const untrimmed = kind.create(units);
    check(equal(trimmed(untrimmed), untrimmed), "nothing to trim, same text", kind.name);
    check(hasUnits(trimmed(kind.create(units)), units), "nothing to trim, same code units", kind.name);
  }
}

console.log(`${checks} checks, ${failures} wrong`);
