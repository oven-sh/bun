// charCodeAt at positions that a comparison with the length of the same string puts inside the string, and at the close neighbors that reach one position outside it, where the answer is NaN.
const opaque = new Function("value", "return value") as <T>(value: T) => T;

const flat = (text: string): string => opaque(text.split("").join(""));
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const substring = (text: string): string => flat("<" + text + ">").slice(1, -1);
const wide = (text: string): string => flat(text + "☃").replace("☃", "");
const wideRope = (text: string): string => (text.length < 2 ? wide(text) : wide(text.slice(0, 1)) + flat(text.slice(1)));
const makers = [flat, rope, substring, wide, wideRope];

class Tally {
  sum = 0;
  missing = 0;
  add(unit: number): void {
    if (unit !== unit) this.missing++;
    else this.sum = (Math.imul(this.sum, 31) + unit) | 0;
  }
  toString(): string {
    return `${this.sum}/${this.missing}`;
  }
}

function everyPosition(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length; ++j) tally.add(s.charCodeAt(j));
  return tally;
}

function plainSum(s: string): number {
  let r = 0;
  for (let j = 0; j < s.length; ++j) r = (r + s.charCodeAt(j)) | 0;
  return r;
}

function lengthReadOnce(s: string): Tally {
  const tally = new Tally();
  const n = s.length;
  for (let j = 0; j < n; ++j) tally.add(s.charCodeAt(j));
  return tally;
}

function lengthOfAnotherString(s: string, t: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < t.length; ++j) tally.add(s.charCodeAt(j));
  return tally;
}

function onePastTheEnd(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j <= s.length; ++j) tally.add(s.charCodeAt(j));
  return tally;
}

function backwards(s: string): Tally {
  const tally = new Tally();
  for (let j = s.length - 1; j >= 0; --j) tally.add(s.charCodeAt(j));
  return tally;
}

function backwardsFromTheLength(s: string): Tally {
  const tally = new Tally();
  for (let j = s.length; j >= -1; --j) tally.add(s.charCodeAt(j));
  return tally;
}

function fromBelowZero(s: string): Tally {
  const tally = new Tally();
  for (let j = -2; j < s.length; ++j) tally.add(s.charCodeAt(j));
  return tally;
}

function nextPosition(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length; ++j) tally.add(s.charCodeAt(j + 1));
  return tally;
}

function nextPositionTested(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length; ++j) {
    if (j + 1 < s.length) tally.add(s.charCodeAt(j + 1));
    tally.add(s.charCodeAt(j));
  }
  return tally;
}

function pairsBelowLastPosition(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length - 1; ++j) {
    tally.add(s.charCodeAt(j));
    tally.add(s.charCodeAt(j + 1));
    tally.add(s.charCodeAt(j + 2));
  }
  return tally;
}

function everySecondPosition(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length; j += 2) {
    tally.add(s.charCodeAt(j));
    tally.add(s.charCodeAt(j + 1));
  }
  return tally;
}

function positionMovedInTheBody(s: string): Tally {
  const tally = new Tally();
  for (let j = 0; j < s.length; ++j) {
    if (s.charCodeAt(j) === 98) j += 3;
    tally.add(s.charCodeAt(j));
  }
  return tally;
}

function stringReplacedBehindTheTest(s: string, shorter: string): Tally {
  const tally = new Tally();
  let t = s;
  for (let j = 0; j < t.length; ++j) {
    if (j === 2) t = shorter;
    tally.add(t.charCodeAt(j));
  }
  return tally;
}

function stringReplacedBehindTheRead(s: string): Tally {
  const tally = new Tally();
  let t = s;
  for (let j = 0; j < t.length; ++j) {
    const unit = t.charCodeAt(j);
    tally.add(unit);
    if (unit === 99) t = t.slice(0, j + 2);
  }
  return tally;
}

function skipLeading(s: string, unit: number): number {
  let j = 0;
  const n = s.length;
  while (j < n && s.charCodeAt(j) === unit) j++;
  return j;
}

function firstAndLast(s: string): Tally {
  const tally = new Tally();
  if (s.length > 0) {
    tally.add(s.charCodeAt(0));
    tally.add(s.charCodeAt(s.length - 1));
  }
  tally.add(s.charCodeAt(0));
  tally.add(s.charCodeAt(s.length - 1));
  tally.add(s.charCodeAt(s.length));
  return tally;
}

function classOfUnits(s: string): string {
  let digits = 0, letters = 0, slashes = 0, others = 0;
  for (let j = 0; j < s.length; ++j) {
    const unit = s.charCodeAt(j);
    if (unit >= 48 && unit <= 57) digits++;
    else if ((unit | 32) >= 97 && (unit | 32) <= 122) letters++;
    else {
      switch (unit) {
        case 47: case 92: slashes++; break;
        default: others++;
      }
    }
  }
  return `${digits},${letters},${slashes},${others}`;
}

const texts = ["", "a", "ab", "abc", "abcabc", "aaab/b\\c0189 Z", "bbbbbbbb", "cccc", "é~ÿ\0x", "x".repeat(70) + "bc"];
for (const text of texts) {
  for (const make of makers) {
    const s = make(text);
    const line = [
      everyPosition(make(text)), plainSum(make(text)), lengthReadOnce(make(text)), lengthOfAnotherString(make(text), make(text + "zz")), lengthOfAnotherString(make(text), make(text.slice(1))),
      onePastTheEnd(make(text)), backwards(make(text)), backwardsFromTheLength(make(text)), fromBelowZero(make(text)), nextPosition(make(text)), nextPositionTested(make(text)),
      pairsBelowLastPosition(make(text)), everySecondPosition(make(text)), positionMovedInTheBody(make(text)), stringReplacedBehindTheTest(make(text), make(text.slice(0, 2))),
      stringReplacedBehindTheTest(make(text), make("")), stringReplacedBehindTheRead(make(text)), skipLeading(make(text), 97), skipLeading(make(text), 98), firstAndLast(s), classOfUnits(s),
    ];
    console.log(JSON.stringify(text.slice(0, 16)), make.name, line.join(" "));
  }
}
