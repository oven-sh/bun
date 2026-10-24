// Switches whose cases are texts of one to seven characters get strings in every internal representation, near misses of every case, texts of zero and of eight characters, and values that are no strings.
const opaque = new Function("value", "return value") as <T>(value: T) => T;

const flat = (text: string): string => opaque(text.split("").join(""));
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const substring = (text: string): string => flat("<" + text + ">").slice(1, -1);
const lastOfLongText = (text: string): string => flat("-".repeat(4096) + text).slice(4096);
const wide = (text: string): string => flat(text + "☃").replace("☃", "");
const wideSubstring = (text: string): string => flat("☃" + text).slice(1);
const wideRope = (text: string): string => (text.length < 2 ? wide(text) : wide(text.slice(0, 1)) + wide(text.slice(1)));
const mixedRope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + wide(text.slice(1)));
const makers = [flat, rope, substring, lastOfLongText, wide, wideSubstring, wideRope, mixedRope];

// Every code unit is the case's plus 0x100: a comparison that looks at the low bytes alone finds it equal.
const raised = (text: string): string => String.fromCharCode(...text.split("").map(unit => unit.charCodeAt(0) + 0x100));

function nearMisses(text: string): string[] {
  const middle = text.length >> 1;
  return [text.slice(0, -1), text + text.slice(-1), text + "\0", "\0" + text, "~" + text.slice(1), text.slice(0, -1) + "~", text.slice(0, middle) + "~" + text.slice(middle + 1), text.toLowerCase(), text + text];
}

const verbs = ["GET", "PUT", "POST", "HEAD", "PATCH", "TRACE", "DELETE", "OPTIONS"];
const marks = ["a", "b", "ab", "ba", "a\0", "\0a", "\0", "é", "éa", "aaaaaaa", "aaaaaab", "baaaaaa"];

function subjectsFor(texts: string[]): string[] {
  const subjects: string[] = [flat(""), flat("12345678"), wide("12345678")];
  for (const text of texts) {
    for (const make of makers) subjects.push(make(text));
    subjects.push(raised(text));
    for (const miss of nearMisses(text)) for (const make of makers) subjects.push(make(miss));
  }
  return subjects;
}

function verbOf(method: string): number {
  switch (method) {
    case "GET": return 1;
    case "PUT": return 2;
    case "POST": return 3;
    case "HEAD": return 4;
    case "PATCH": return 5;
    case "TRACE": return 6;
    case "DELETE": return 7;
    case "OPTIONS": return 8;
    default: return 0;
  }
}

function markOf(text: string): number {
  switch (text) {
    case "a": return 1;
    case "b": return 2;
    case "ab": return 3;
    case "ba": return 4;
    case "a\0": return 5;
    case "\0a": return 6;
    case "\0": return 7;
    case "é": return 8;
    case "éa": return 9;
    case "aaaaaaa": return 10;
    case "aaaaaab": return 11;
    case "baaaaaa": return 12;
    default: return 0;
  }
}

function verbOfOptional(method: string | undefined | null): number {
  switch (method) {
    case "GET": return 1;
    case "PUT": return 2;
    case "POST": return 3;
    case "DELETE": return 4;
  }
  return -1;
}

function verbOfValue(value: unknown): number {
  switch (value) {
    case "GET": return 1;
    case "PUT": return 2;
    case "POST": return 3;
    case "DELETE": return 4;
  }
  return -1;
}

function verbOnRarePath(method: string, isRare: boolean): number {
  if (isRare) {
    try {
      throw new Error(method);
    } catch (error) {
      switch ((error as Error).message) {
        case "GET": return 1;
        case "PUT": return 2;
        case "POST": return 3;
        case "DELETE": return 4;
      }
      return -1;
    }
  }
  return -2;
}

function checksum(values: number[]): string {
  let sum = 0;
  const counts = new Map<number, number>();
  for (let index = 0; index < values.length; ++index) {
    sum = (Math.imul(sum, 31) + values[index]) | 0;
    counts.set(values[index], (counts.get(values[index]) ?? 0) + 1);
  }
  return `${values.length} values, sum ${sum}, ${[...counts].sort((a, b) => a[0] - b[0]).map(([value, count]) => `${value}x${count}`).join(" ")}`;
}

const verbSubjects = subjectsFor(verbs);
const markSubjects = subjectsFor(marks);
const others: unknown[] = [undefined, null, 0, 7, NaN, true, 7n, Symbol.iterator, {}, ["GET"], { toString: () => "GET" }, new String("GET")];

console.log("verbs", checksum(verbSubjects.map(verbOf)));
console.log("marks", checksum(markSubjects.map(markOf)));
console.log("optional", checksum([...verbSubjects, undefined, null].map(verbOfOptional)));
console.log("values", checksum([...verbSubjects, ...others].map(verbOfValue)));
console.log("rare", checksum(verbSubjects.map((subject, index) => verbOnRarePath(subject, index % 3 === 0))));
for (const verb of verbs) console.log(verb, makers.map(make => verbOf(make(verb))).join(","));
for (const mark of marks) console.log(JSON.stringify(mark), makers.map(make => markOf(make(mark))).join(","));
