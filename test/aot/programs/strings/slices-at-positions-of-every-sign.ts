// slice, substring and substr with one and two positions out of -100, -1, -0, 0, 1, the length, the length + 1, NaN, 1.5 and Infinity, written as constants, passed as `number` variables and as integers, and counted by loops that prove their sign; also behind tests of the sign, at positions that a search found, on slices of slices, and where the slice is only measured, compared or appended. Every line prints what plain Bun prints.
// STATISTIC: StringPositionsWithKnownSign >= 1
const never = Date.now() < 0;
const hidden = (text: string): string => (never ? text + "!" : text);
const flat = (text: string): string => hidden(text.split("").join(""));

function shown(text: string): string {
  if (text.length <= 12) return "[" + text + "]";
  return "[" + text.length + ":" + text.charCodeAt(0) + ".." + text.charCodeAt(text.length - 1) + "]";
}
function showNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function report(label: string, results: string[], width: number): void {
  for (let start = 0; start < results.length; start += width) console.log(label + " " + start / width + ": " + results.slice(start, start + width).map(text => shown(text)).join(""));
}

function slicesAtConstants(s: string): string[] {
  return [
    s.slice(-100), s.slice(-1), s.slice(-0), s.slice(0), s.slice(1), s.slice(s.length), s.slice(s.length + 1), s.slice(NaN), s.slice(1.5), s.slice(Infinity),
    s.slice(-100, -100), s.slice(-100, -1), s.slice(-100, -0), s.slice(-100, 0), s.slice(-100, 1), s.slice(-100, s.length), s.slice(-100, s.length + 1), s.slice(-100, NaN), s.slice(-100, 1.5), s.slice(-100, Infinity),
    s.slice(-1, -100), s.slice(-1, -1), s.slice(-1, -0), s.slice(-1, 0), s.slice(-1, 1), s.slice(-1, s.length), s.slice(-1, s.length + 1), s.slice(-1, NaN), s.slice(-1, 1.5), s.slice(-1, Infinity),
    s.slice(-0, -100), s.slice(-0, -1), s.slice(-0, -0), s.slice(-0, 0), s.slice(-0, 1), s.slice(-0, s.length), s.slice(-0, s.length + 1), s.slice(-0, NaN), s.slice(-0, 1.5), s.slice(-0, Infinity),
    s.slice(0, -100), s.slice(0, -1), s.slice(0, -0), s.slice(0, 0), s.slice(0, 1), s.slice(0, s.length), s.slice(0, s.length + 1), s.slice(0, NaN), s.slice(0, 1.5), s.slice(0, Infinity),
    s.slice(1, -100), s.slice(1, -1), s.slice(1, -0), s.slice(1, 0), s.slice(1, 1), s.slice(1, s.length), s.slice(1, s.length + 1), s.slice(1, NaN), s.slice(1, 1.5), s.slice(1, Infinity),
    s.slice(s.length, -100), s.slice(s.length, -1), s.slice(s.length, -0), s.slice(s.length, 0), s.slice(s.length, 1), s.slice(s.length, s.length), s.slice(s.length, s.length + 1), s.slice(s.length, NaN), s.slice(s.length, 1.5), s.slice(s.length, Infinity),
    s.slice(s.length + 1, -100), s.slice(s.length + 1, -1), s.slice(s.length + 1, -0), s.slice(s.length + 1, 0), s.slice(s.length + 1, 1), s.slice(s.length + 1, s.length), s.slice(s.length + 1, s.length + 1), s.slice(s.length + 1, NaN), s.slice(s.length + 1, 1.5), s.slice(s.length + 1, Infinity),
    s.slice(NaN, -100), s.slice(NaN, -1), s.slice(NaN, -0), s.slice(NaN, 0), s.slice(NaN, 1), s.slice(NaN, s.length), s.slice(NaN, s.length + 1), s.slice(NaN, NaN), s.slice(NaN, 1.5), s.slice(NaN, Infinity),
    s.slice(1.5, -100), s.slice(1.5, -1), s.slice(1.5, -0), s.slice(1.5, 0), s.slice(1.5, 1), s.slice(1.5, s.length), s.slice(1.5, s.length + 1), s.slice(1.5, NaN), s.slice(1.5, 1.5), s.slice(1.5, Infinity),
    s.slice(Infinity, -100), s.slice(Infinity, -1), s.slice(Infinity, -0), s.slice(Infinity, 0), s.slice(Infinity, 1), s.slice(Infinity, s.length), s.slice(Infinity, s.length + 1), s.slice(Infinity, NaN), s.slice(Infinity, 1.5), s.slice(Infinity, Infinity),
  ];
}
function substringsAtConstants(s: string): string[] {
  return [
    s.substring(-100), s.substring(-1), s.substring(-0), s.substring(0), s.substring(1), s.substring(s.length), s.substring(s.length + 1), s.substring(NaN), s.substring(1.5), s.substring(Infinity),
    s.substring(-100, -100), s.substring(-100, -1), s.substring(-100, -0), s.substring(-100, 0), s.substring(-100, 1), s.substring(-100, s.length), s.substring(-100, s.length + 1), s.substring(-100, NaN), s.substring(-100, 1.5), s.substring(-100, Infinity),
    s.substring(-1, -100), s.substring(-1, -1), s.substring(-1, -0), s.substring(-1, 0), s.substring(-1, 1), s.substring(-1, s.length), s.substring(-1, s.length + 1), s.substring(-1, NaN), s.substring(-1, 1.5), s.substring(-1, Infinity),
    s.substring(-0, -100), s.substring(-0, -1), s.substring(-0, -0), s.substring(-0, 0), s.substring(-0, 1), s.substring(-0, s.length), s.substring(-0, s.length + 1), s.substring(-0, NaN), s.substring(-0, 1.5), s.substring(-0, Infinity),
    s.substring(0, -100), s.substring(0, -1), s.substring(0, -0), s.substring(0, 0), s.substring(0, 1), s.substring(0, s.length), s.substring(0, s.length + 1), s.substring(0, NaN), s.substring(0, 1.5), s.substring(0, Infinity),
    s.substring(1, -100), s.substring(1, -1), s.substring(1, -0), s.substring(1, 0), s.substring(1, 1), s.substring(1, s.length), s.substring(1, s.length + 1), s.substring(1, NaN), s.substring(1, 1.5), s.substring(1, Infinity),
    s.substring(s.length, -100), s.substring(s.length, -1), s.substring(s.length, -0), s.substring(s.length, 0), s.substring(s.length, 1), s.substring(s.length, s.length), s.substring(s.length, s.length + 1), s.substring(s.length, NaN), s.substring(s.length, 1.5), s.substring(s.length, Infinity),
    s.substring(s.length + 1, -100), s.substring(s.length + 1, -1), s.substring(s.length + 1, -0), s.substring(s.length + 1, 0), s.substring(s.length + 1, 1), s.substring(s.length + 1, s.length), s.substring(s.length + 1, s.length + 1), s.substring(s.length + 1, NaN), s.substring(s.length + 1, 1.5), s.substring(s.length + 1, Infinity),
    s.substring(NaN, -100), s.substring(NaN, -1), s.substring(NaN, -0), s.substring(NaN, 0), s.substring(NaN, 1), s.substring(NaN, s.length), s.substring(NaN, s.length + 1), s.substring(NaN, NaN), s.substring(NaN, 1.5), s.substring(NaN, Infinity),
    s.substring(1.5, -100), s.substring(1.5, -1), s.substring(1.5, -0), s.substring(1.5, 0), s.substring(1.5, 1), s.substring(1.5, s.length), s.substring(1.5, s.length + 1), s.substring(1.5, NaN), s.substring(1.5, 1.5), s.substring(1.5, Infinity),
    s.substring(Infinity, -100), s.substring(Infinity, -1), s.substring(Infinity, -0), s.substring(Infinity, 0), s.substring(Infinity, 1), s.substring(Infinity, s.length), s.substring(Infinity, s.length + 1), s.substring(Infinity, NaN), s.substring(Infinity, 1.5), s.substring(Infinity, Infinity),
  ];
}
function substrsAtConstants(s: string): string[] {
  return [
    s.substr(-100), s.substr(-1), s.substr(-0), s.substr(0), s.substr(1), s.substr(s.length), s.substr(s.length + 1), s.substr(NaN), s.substr(1.5), s.substr(Infinity),
    s.substr(-100, -100), s.substr(-100, -1), s.substr(-100, -0), s.substr(-100, 0), s.substr(-100, 1), s.substr(-100, s.length), s.substr(-100, s.length + 1), s.substr(-100, NaN), s.substr(-100, 1.5), s.substr(-100, Infinity),
    s.substr(-1, -100), s.substr(-1, -1), s.substr(-1, -0), s.substr(-1, 0), s.substr(-1, 1), s.substr(-1, s.length), s.substr(-1, s.length + 1), s.substr(-1, NaN), s.substr(-1, 1.5), s.substr(-1, Infinity),
    s.substr(-0, -100), s.substr(-0, -1), s.substr(-0, -0), s.substr(-0, 0), s.substr(-0, 1), s.substr(-0, s.length), s.substr(-0, s.length + 1), s.substr(-0, NaN), s.substr(-0, 1.5), s.substr(-0, Infinity),
    s.substr(0, -100), s.substr(0, -1), s.substr(0, -0), s.substr(0, 0), s.substr(0, 1), s.substr(0, s.length), s.substr(0, s.length + 1), s.substr(0, NaN), s.substr(0, 1.5), s.substr(0, Infinity),
    s.substr(1, -100), s.substr(1, -1), s.substr(1, -0), s.substr(1, 0), s.substr(1, 1), s.substr(1, s.length), s.substr(1, s.length + 1), s.substr(1, NaN), s.substr(1, 1.5), s.substr(1, Infinity),
    s.substr(s.length, -100), s.substr(s.length, -1), s.substr(s.length, -0), s.substr(s.length, 0), s.substr(s.length, 1), s.substr(s.length, s.length), s.substr(s.length, s.length + 1), s.substr(s.length, NaN), s.substr(s.length, 1.5), s.substr(s.length, Infinity),
    s.substr(s.length + 1, -100), s.substr(s.length + 1, -1), s.substr(s.length + 1, -0), s.substr(s.length + 1, 0), s.substr(s.length + 1, 1), s.substr(s.length + 1, s.length), s.substr(s.length + 1, s.length + 1), s.substr(s.length + 1, NaN), s.substr(s.length + 1, 1.5), s.substr(s.length + 1, Infinity),
    s.substr(NaN, -100), s.substr(NaN, -1), s.substr(NaN, -0), s.substr(NaN, 0), s.substr(NaN, 1), s.substr(NaN, s.length), s.substr(NaN, s.length + 1), s.substr(NaN, NaN), s.substr(NaN, 1.5), s.substr(NaN, Infinity),
    s.substr(1.5, -100), s.substr(1.5, -1), s.substr(1.5, -0), s.substr(1.5, 0), s.substr(1.5, 1), s.substr(1.5, s.length), s.substr(1.5, s.length + 1), s.substr(1.5, NaN), s.substr(1.5, 1.5), s.substr(1.5, Infinity),
    s.substr(Infinity, -100), s.substr(Infinity, -1), s.substr(Infinity, -0), s.substr(Infinity, 0), s.substr(Infinity, 1), s.substr(Infinity, s.length), s.substr(Infinity, s.length + 1), s.substr(Infinity, NaN), s.substr(Infinity, 1.5), s.substr(Infinity, Infinity),
  ];
}

function sliceFrom(s: string, a: number): string { return s.slice(a); }
function sliceBetween(s: string, a: number, b: number): string { return s.slice(a, b); }
function substringFrom(s: string, a: number): string { return s.substring(a); }
function substringBetween(s: string, a: number, b: number): string { return s.substring(a, b); }
function substrFrom(s: string, a: number): string { return s.substr(a); }
function substrBetween(s: string, a: number, b: number): string { return s.substr(a, b); }
function slicesAtVariables(s: string, places: number[]): string[] {
  const results: string[] = [];
  for (const a of places) results.push(sliceFrom(s, a));
  for (const a of places) for (const b of places) results.push(sliceBetween(s, a, b));
  return results;
}
function substringsAtVariables(s: string, places: number[]): string[] {
  const results: string[] = [];
  for (const a of places) results.push(substringFrom(s, a));
  for (const a of places) for (const b of places) results.push(substringBetween(s, a, b));
  return results;
}
function substrsAtVariables(s: string, places: number[]): string[] {
  const results: string[] = [];
  for (const a of places) results.push(substrFrom(s, a));
  for (const a of places) for (const b of places) results.push(substrBetween(s, a, b));
  return results;
}

function sliceBetweenIntegers(s: string, a: number, b: number): string { return s.slice(a | 0, b | 0); }
function substringBetweenIntegers(s: string, a: number, b: number): string { return s.substring(a | 0, b | 0); }
function substrBetweenIntegers(s: string, a: number, b: number): string { return s.substr(a | 0, b | 0); }
function lengthOfSlice(s: string, a: number, b: number): number { return s.slice(a, b).length; }
function lengthOfSubstring(s: string, a: number, b: number): number { return s.substring(a, b).length; }
function lengthOfSubstr(s: string, a: number, b: number): number { return s.substr(a, b).length; }
function sliceIsBc(s: string, a: number, b: number): boolean { return s.slice(a, b) === "bc"; }
function substringIsBc(s: string, a: number, b: number): boolean { return s.substring(a, b) === "bc"; }
function substrIsBc(s: string, a: number, b: number): boolean { return s.substr(a, b) === "bc"; }
function firstUnitOfSlice(s: string, a: number, b: number): number { return s.slice(a, b).charCodeAt(0); }
function sliceOfSlice(s: string, a: number, b: number): string { return s.slice(1, -1).slice(a, b); }
function substringOfSlice(s: string, a: number, b: number): string { return s.slice(a, b).substring(1, 3); }
function substrOfSubstring(s: string, a: number, b: number): string { return s.substring(2, 8).substr(a, b); }
function sliceOfSubstr(s: string, a: number, b: number): string { return s.substr(a, 6).slice(b); }
function appended(s: string, a: number, b: number): string {
  let out = "";
  for (let turn = 0; turn < 2; turn++) {
    out += s.slice(a, b);
    out += "|";
    out += s.substring(a, b);
    out += "|";
  }
  return out;
}

function countersUp(s: string): string {
  let out = "";
  for (let i = 0; i <= s.length + 1; i++) {
    out += shown(s.slice(i)) + shown(s.substring(i)) + shown(s.substr(i)) + shown(s.slice(0, i)) + shown(s.substring(0, i)) + shown(s.substr(0, i)) + shown(s.slice(i, i + 2)) + shown(s.substring(i, i + 2)) + shown(s.substr(i, 2)) + " ";
  }
  return out;
}
function countersUpInPairs(s: string): string {
  let out = "";
  for (let i = 0; i <= s.length + 1; i++) {
    for (let j = 0; j <= s.length + 1; j++) out += shown(s.slice(i, j)) + shown(s.substring(i, j)) + shown(s.substr(i, j));
    out += " ";
  }
  return out;
}
function countersDown(s: string): string {
  let out = "";
  for (let i = -1; i >= -(s.length + 1); i--) {
    out += shown(s.slice(i)) + shown(s.substring(i)) + shown(s.substr(i)) + shown(s.slice(i, -1)) + shown(s.slice(0, i)) + shown(s.substring(0, i)) + shown(s.substr(i, 2)) + shown(s.substr(0, i)) + " ";
  }
  return out;
}
function countersNegated(s: string): string {
  let out = "";
  for (let i = 0; i <= s.length + 1; i++) out += shown(s.slice(-i)) + shown(s.substring(-i)) + shown(s.substr(-i)) + shown(s.slice(0, -i)) + shown(s.slice(-i, s.length - 1)) + shown(s.substr(-i, i)) + " ";
  return out;
}
function countersAcrossZero(s: string): string {
  let out = "";
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) out += shown(s.slice(i, j)) + shown(s.substring(i, j)) + shown(s.substr(i, j));
    out += " ";
  }
  return out;
}
function behindTestsOfTheSign(s: string, place: number): string {
  const i = place | 0;
  if (i >= 0) return "+" + shown(s.slice(i)) + shown(s.substring(i)) + shown(s.substr(i)) + shown(s.slice(0, i)) + shown(s.substr(0, i));
  return "-" + shown(s.slice(i)) + shown(s.substring(i)) + shown(s.substr(i)) + shown(s.slice(0, i)) + shown(s.substr(0, i));
}
function aroundWhatWasFound(s: string): string {
  return (
    shown(s.slice(s.indexOf("c") + 1)) + shown(s.slice(0, s.indexOf("c"))) + shown(s.slice(s.indexOf("zz"))) + shown(s.slice(0, s.indexOf("zz"))) + shown(s.substring(s.lastIndexOf("h") + 1)) +
    shown(s.substring(s.indexOf("zz"), s.indexOf("c"))) + shown(s.substr(s.indexOf("zz"), 2)) + shown(s.slice(Math.max(0, s.length - 3))) + shown(s.slice(-Math.min(3, s.length))) + shown(s.slice(1, undefined)) + shown(s.substring(1, undefined)) + shown(s.substr(1, undefined))
  );
}

let hash = 0;
let wrong = 0;
function mix(text: string): void {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  hash = (Math.imul(hash, 31) + text.length) | 0;
}
function expectSame(what: string, a: number, b: number, got: string, want: string): void {
  mix(got);
  if (got !== want && wrong++ < 20) console.log("WRONG: " + what + " at " + showNumber(a) + ", " + showNumber(b) + " is " + shown(got) + ", not " + shown(want));
}

const tenPlaces = (length: number): number[] => [-100, -1, -0, 0, 1, length, length + 1, NaN, 1.5, Infinity];
const morePlaces = (length: number): number[] => [...tenPlaces(length), -Infinity, -1.5, -0.5, 0.5, 2, -2, length - 1, -length, -length - 1, 2 ** 31, -(2 ** 31), 2 ** 32 + 1, -(2 ** 32) - 1, 1e300];
const long = Array.from({ length: 120 }, (_, i) => String.fromCharCode(i < 94 ? 33 + i : 67 + i)).join("");
const subjects: [string, () => string][] = [
  ["empty", () => flat("")],
  ["one character", () => flat("q")],
  ["8-bit", () => flat("abcdefghij")],
  ["16-bit", () => flat("\u65e5\u672c\u8a9e\u30c6\u30ad\u30b9\u30c8")],
  ["rope", () => flat("abcde") + flat("fghij")],
  ["slice", () => flat("<<abcdefghij>>").slice(2, -2)],
  ["slice of 16-bit text", () => flat("\u2603abcdefghij\u2603").slice(1, -1)],
  ["120 characters", () => flat(long)],
];

for (const [name, make] of subjects) {
  const length = make().length;
  const ten = tenPlaces(length);
  const constants = [slicesAtConstants(make()), substringsAtConstants(make()), substrsAtConstants(make())];
  const variables = [slicesAtVariables(make(), ten), substringsAtVariables(make(), ten), substrsAtVariables(make(), ten)];
  const methods = ["slice", "substring", "substr"];
  for (let method = 0; method < 3; method++) {
    report(name + ", " + methods[method] + " at constants", constants[method], 10);
    let differences = 0;
    for (let i = 0; i < constants[method].length; i++) if (constants[method][i] !== variables[method][i]) differences++;
    console.log(name + ", " + methods[method] + " at variables: " + differences + " of " + variables[method].length + " differ from the constants");
  }

  const places = morePlaces(length);
  console.log(name + ", places: " + places.map(place => showNumber(place)).join(" "));
  report(name + ", slice at variables", slicesAtVariables(make(), places), places.length);
  report(name + ", substring at variables", substringsAtVariables(make(), places), places.length);
  report(name + ", substr at variables", substrsAtVariables(make(), places), places.length);

  hash = 0;
  for (const a of places) {
    for (const b of places) {
      const slice = sliceBetween(make(), a, b);
      const substring = substringBetween(make(), a, b);
      const substr = substrBetween(make(), a, b);
      expectSame("slice at integers", a, b, sliceBetweenIntegers(make(), a, b), sliceBetween(make(), a | 0, b | 0));
      expectSame("substring at integers", a, b, substringBetweenIntegers(make(), a, b), substringBetween(make(), a | 0, b | 0));
      expectSame("substr at integers", a, b, substrBetweenIntegers(make(), a, b), substrBetween(make(), a | 0, b | 0));
      expectSame("the length of a slice", a, b, String(lengthOfSlice(make(), a, b)), String(slice.length));
      expectSame("the length of a substring", a, b, String(lengthOfSubstring(make(), a, b)), String(substring.length));
      expectSame("the length of a substr", a, b, String(lengthOfSubstr(make(), a, b)), String(substr.length));
      expectSame("a slice compared", a, b, String(sliceIsBc(make(), a, b)), String(slice === flat("bc")));
      expectSame("a substring compared", a, b, String(substringIsBc(make(), a, b)), String(substring === flat("bc")));
      expectSame("a substr compared", a, b, String(substrIsBc(make(), a, b)), String(substr === flat("bc")));
      expectSame("the first unit of a slice", a, b, String(firstUnitOfSlice(make(), a, b)), String(slice.charCodeAt(0)));
      expectSame("a slice of a slice", a, b, sliceOfSlice(make(), a, b), sliceBetween(sliceBetween(make(), 1, -1), a, b));
      expectSame("a substring of a slice", a, b, substringOfSlice(make(), a, b), substringBetween(slice, 1, 3));
      expectSame("a substr of a substring", a, b, substrOfSubstring(make(), a, b), substrBetween(substringBetween(make(), 2, 8), a, b));
      expectSame("a slice of a substr", a, b, sliceOfSubstr(make(), a, b), sliceFrom(substrBetween(make(), a, 6), b));
      expectSame("appended", a, b, appended(make(), a, b), slice + "|" + substring + "|" + slice + "|" + substring + "|");
    }
  }
  console.log(name + ", other forms: hash " + hash);

  console.log(name + ", behind tests of the sign: " + places.map(place => behindTestsOfTheSign(make(), place)).join(" "));
  console.log(name + ", around what was found: " + aroundWhatWasFound(make()));
  if (length > 12) continue;
  console.log(name + ", counters up: " + countersUp(make()));
  console.log(name + ", counters up in pairs: " + countersUpInPairs(make()));
  console.log(name + ", counters down: " + countersDown(make()));
  console.log(name + ", counters negated: " + countersNegated(make()));
  console.log(name + ", counters across zero: " + countersAcrossZero(make()));
}

const steady = flat("the quick brown fox");
let total = 0;
for (let turn = 0; turn < 20000; turn++) {
  total += sliceBetween(steady, (turn % 13) - 3, (turn % 7) + 2).length + substringBetween(steady, (turn % 5) - 1, turn % 23).length + substrBetween(steady, (turn % 11) - 5, turn % 4).length;
  total += sliceFrom(steady, -(turn % 6)).length + lengthOfSlice(steady, turn % 19, -(turn % 3));
}
console.log("units in 20000 turns: " + total + ", " + wrong + " wrong");
