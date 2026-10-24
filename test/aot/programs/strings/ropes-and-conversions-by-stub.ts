// Ropes of two and three strings, int32 to string, letter case, decimal digits: what the string stubs answer themselves, and where they must call C++.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const shellCount: ((name: string) => number | null) | undefined = (globalThis as any).aotOperationCount;
const counts = shellCount !== undefined && shellCount("operationAOTConcat") !== null;
function count(name: string): number {
  return counts ? shellCount!(name)! : 0;
}
function reportCalls(what: string, calls: number, low: number, high: number): void {
  const isExpected = !counts || (calls >= low && calls <= high);
  console.log(what + ": " + (isExpected ? "as expected" : calls + " calls, expected " + low + " to " + high));
}

function concatenateTwo(a: string, b: string): string {
  return a + b;
}
function concatenateThree(a: string, b: string, c: string): string {
  return a + b + c;
}
function asSubstring(text: string): string {
  return ("-" + text + "-").slice(1, -1);
}
function toLower(text: string): string {
  return text.toLowerCase();
}
function toUpper(text: string): string {
  return text.toUpperCase();
}
function integerToString(value: number): string {
  return String(value | 0);
}
function numberToString(value: number): string {
  return String(value);
}
function asNumber(text: string): number {
  return Number(text);
}
function parsed(text: string): number {
  return parseInt(text);
}
function parsedInDecimal(text: string): number {
  return parseInt(text, 10);
}
function parsedInHexadecimal(text: string): number {
  return parseInt(text, 16);
}
function parsedInRadix(text: string, radix: number): number {
  return parseInt(text, radix);
}
function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function codePoints(text: string): string {
  return text.length + ":" + Array.from(text, character => character.codePointAt(0)!.toString(16)).join(".");
}

const [left, right, latinLeft, wideRight, one, two, three, plain, wide, digits, wideText]: string[] = JSON.parse(
  '["left-", "right", "léft-", "r中ght", "one,", "two,", "three", "plain", "wā中", "0123456789abcdef", "中文ābcdef"]',
);
const rounds: number = JSON.parse("10000");

function checkRopes(): void {
  const operands: { create: () => string; characters: string[] }[] = [
    { create: () => "", characters: [] },
    { create: () => plain, characters: Array.from("plain") },
    { create: () => wide, characters: Array.from("wā中") },
    { create: () => concatenateTwo(left, right), characters: Array.from("left-right") },
    { create: () => concatenateTwo(latinLeft, wideRight), characters: Array.from("léft-r中ght") },
    { create: () => concatenateThree(one, two, three), characters: Array.from("one,two,three") },
    { create: () => digits.slice(3, 12), characters: Array.from("3456789ab") },
    { create: () => wideText.slice(1, 6), characters: Array.from("文ābcd") },
  ];
  let checked = 0;
  let checksum = 0;
  let wrong = "";
  function check(what: string, text: string, expected: string[]): void {
    const length = text.length;
    const characters = Array.from(text);
    let isSame = length === expected.length && characters.length === expected.length;
    for (let i = 0; isSame && i < expected.length; i++) isSame = characters[i] === expected[i];
    if (!isSame) wrong += " " + what;
    for (const character of characters) checksum = (checksum * 31 + character.charCodeAt(0)) | 0;
    checked++;
  }
  for (let i = 0; i < operands.length; i++) {
    for (let j = 0; j < operands.length; j++) {
      const a = operands[i];
      const b = operands[j];
      check(i + "+" + j, concatenateTwo(a.create(), b.create()), [...a.characters, ...b.characters]);
      for (let k = 0; k < operands.length; k++) {
        const c = operands[k];
        const expected = [...a.characters, ...b.characters, ...c.characters];
        check(i + "+" + j + "+" + k, concatenateThree(a.create(), b.create(), c.create()), expected);
      }
    }
  }
  console.log("ropes: " + checked + " checked, checksum " + checksum + ", wrong:" + (wrong || " none"));

  const nonEmpty: string[] = [left, right, latinLeft, wideRight, one, two, three, plain];
  const latest: string[] = new Array<string>(64).fill("");
  const before = count("operationAOTConcat");
  for (let i = 0; i < rounds; i++) latest[i & 63] = concatenateTwo(nonEmpty[i & 7], nonEmpty[(i + 3) & 7]);
  reportCalls("ropes of non-empty strings are allocated without C++", count("operationAOTConcat") - before, 0, 100);
  console.log("latest ropes: " + codePoints(latest[0]) + " " + codePoints(latest[63]) + " " + latest.join("").length);
}

function checkLengthLimit(): void {
  const powers: string[] = ["x"];
  for (let k = 1; k <= 30; k++) powers.push(concatenateTwo(powers[k - 1], powers[k - 1]));
  const big = powers[30];
  const half = powers[29];
  let almostBig = "";
  for (let k = 0; k < 30; k++) almostBig = concatenateTwo(almostBig, powers[k]);
  const longest = concatenateTwo(big, almostBig);
  function attempt(what: string, run: () => string): void {
    let outcome: string;
    try {
      outcome = "length " + run().length;
    } catch (error) {
      outcome = error instanceof RangeError ? "RangeError" : "another error";
    }
    console.log(what + ": " + outcome);
  }
  attempt("2^30 + 2^30", () => concatenateTwo(big, big));
  attempt("2^30 + (2^30 - 1)", () => concatenateTwo(big, almostBig));
  attempt("longest + empty", () => concatenateTwo(longest, ""));
  attempt("empty + longest", () => concatenateTwo("", longest));
  attempt("longest + 1", () => concatenateTwo(longest, "y"));
  attempt("1 + longest", () => concatenateTwo("y", longest));
  attempt("2^29 + 2^29 + 2^30", () => concatenateThree(half, half, big));
  attempt("2^30 + 2^30 + empty", () => concatenateThree(big, big, ""));
  attempt("2^30 + (2^30 - 1) + empty", () => concatenateThree(big, almostBig, ""));
  attempt("2^30 + (2^30 - 1) + 1", () => concatenateThree(big, almostBig, "y"));
  attempt("empty + empty + empty", () => concatenateThree("", "", ""));
}

function checkIntegers(): void {
  const integers: number[] = [-1, 0, 9, 10, 255, 256, 1023, 1024, 65536, 2 ** 31 - 1, -(2 ** 31)];
  for (let round = 0; round < 2; round++)
    console.log("integers: " + integers.map(value => integerToString(value) + " " + numberToString(value)).join(", "));

  const repeated: number = JSON.parse("65536");
  let total = 0;
  const before = count("operationAOTIntToString");
  for (let i = 0; i < rounds; i++) total += integerToString(repeated).length;
  reportCalls("an integer converted before comes from the cache", count("operationAOTIntToString") - before, 0, 100);
  console.log("digits written: " + total);
}

function checkLetterCase(): void {
  const [lowerBase, mixedBase, upperBase]: string[] = JSON.parse('["--lowercase--", "--LowerCase--", "--UPPERCASE--"]');
  const texts: string[] = ["abc", "ABC", "aBc", "straße", "İ", "", "@[`{\u007f", "àÿµ", wideText.slice(3, 8)];
  for (const base of [lowerBase, mixedBase, upperBase]) texts.push(base.slice(2, 11), base.slice(2, 5));
  for (const text of texts) console.log(codePoints(text) + " | " + codePoints(toLower(text)) + " | " + codePoints(toUpper(text)));

  const toLowerPairs: string[][] = [["A", "a"], ["Z", "z"], ["@", "@"], ["[", "["], ["À", "à"]];
  const toUpperPairs: string[][] = [["a", "A"], ["z", "Z"], ["`", "`"], ["{", "{"], ["à", "À"]];
  let wrong = 0;
  for (let length = 1; length <= 17; length++) {
    for (let at = 0; at < length; at++) {
      for (const [from, to] of toLowerPairs) {
        const head = "a".repeat(at);
        const tail = "a".repeat(length - at - 1);
        if (toLower(asSubstring(head + from + tail)) !== head + to + tail) wrong++;
      }
      for (const [from, to] of toUpperPairs) {
        const head = "A".repeat(at);
        const tail = "A".repeat(length - at - 1);
        if (toUpper(asSubstring(head + from + tail)) !== head + to + tail) wrong++;
      }
    }
  }
  console.log("one other character at every position of 1 to 17: " + wrong + " wrong");

  const operation = "operationAOTStringToLowerCase";
  const flat: string = JSON.parse('"already lower case, 0123456789"');
  const substring = asSubstring(flat);
  let total = 0;
  let before = count(operation);
  for (let i = 0; i < rounds; i++) total += toLower(flat).length + toLower(substring).length;
  reportCalls("a lower-case string is its own lower case without C++", count(operation) - before, 0, 0);

  const mixed = "aBc".repeat(100);
  before = count(operation);
  for (let i = 0; i < 100; i++) total += toLower(mixed.slice(3 * i, 3 * i + 3)) === "abc" ? 1 : 0;
  reportCalls("each new mixed-case string is converted by C++", count(operation) - before, 100, 100);

  const repeatedText = mixed.slice(0, 3);
  before = count(operation);
  for (let i = 0; i < rounds; i++) total += toLower(repeatedText) === "abc" ? 1 : 0;
  reportCalls("a mixed-case string converted before comes from the cache", count(operation) - before, 1, 100);
  console.log("letter case total: " + total);
}

function checkDigits(): void {
  const numerals: string[] = ["0", "007", "9".repeat(15), "9".repeat(16), "1e3", " 1", "-1", "", "1/", "1:"];
  const radixes: number[] = [0, 10, 16];
  for (const numeral of numerals) {
    for (const text of [numeral, asSubstring(numeral)]) {
      const values = [asNumber(text), parsed(text), parsedInDecimal(text), parsedInHexadecimal(text)];
      for (const radix of radixes) values.push(parsedInRadix(text, radix));
      console.log(JSON.stringify(text) + ": " + values.map(show).join(" "));
    }
  }
}

checkRopes();
checkLengthLimit();
checkIntegers();
checkLetterCase();
checkDigits();
