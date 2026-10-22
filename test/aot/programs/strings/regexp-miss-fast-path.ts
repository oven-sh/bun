// `test`, `exec`, `match` and `replace` that find nothing are answered without the generic operations, for every internal representation of the subject. Whatever the fast path cannot decide (a `lastIndex` that is not an index, a frozen RegExp, an own `exec`, a subclass) behaves as in plain Bun.
// Only the jsc shell with --aotCountsPath=<path> can count: there the third number after the 10,000 turns must be 0. Elsewhere the program checks the answers alone.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const genericOperations = ["operationAOTRegExpExec", "operationAOTRegExpTest", "operationAOTRegExpTestBoxed", "operationAOTRegExpFind", "operationAOTStringMatchRegExp", "operationAOTStringReplaceRegExpString"];
const genericCalls = () => genericOperations.reduce((sum, name) => sum + count(name), 0);

function tests(pattern: RegExp, text: string) {
  return pattern.test(text);
}
function execs(pattern: RegExp, text: string) {
  return pattern.exec(text);
}
function wholeMatch(pattern: RegExp, text: string) {
  const [whole] = pattern.exec(text) ?? [];
  return whole;
}
function matches(text: string, pattern: RegExp) {
  return text.match(pattern);
}
function replaces(text: string, pattern: RegExp) {
  return text.replace(pattern, "<$&>");
}
function show(match: RegExpMatchArray | RegExpExecArray | null) {
  return match ? `${JSON.stringify(match)}@${match.index}` : "null";
}
function shown(value: unknown) {
  return typeof value === "object" && value !== null ? "object" : Object.is(value, -0) ? "-0" : String(value);
}
function state(pattern: RegExp) {
  return `${shown(pattern.lastIndex)} ${JSON.stringify(RegExp.lastMatch)}`;
}

type Subject = [kind: string, make: () => string];
function subjectsOf(text: string): Subject[] {
  const padded = `<<${text}>>`;
  const middle = text.length >> 1;
  return [
    ["flat", () => text],
    ["substring", () => padded.slice(2, 2 + text.length)],
    ["rope", () => text.slice(0, middle) + text.slice(middle)],
  ];
}
const present = "-- 12x abc 50% a \xe9 --";
const absent = "-- 12 34 .. 56 78 --";
const widePresent = "─ -- 12x abc 50% a \xe9 --";
const wideAbsent = "─ -- 12 34 .. 56 78 --";
const subjects: Subject[] = [...subjectsOf(present), ...subjectsOf(absent), ...subjectsOf(widePresent), ...subjectsOf(wideAbsent), ["empty", () => ""]];

const code = /\d+x/, word = /abc/, sign = /%/, everyA = /a/g, stickyA = /a/y, letter = /\p{L}/u, everyCode = /\d+x/g, stickyCode = /\d+x/y;
for (const pattern of [code, word, sign, everyA, stickyA, letter, everyCode, stickyCode]) {
  for (const [kind, make] of subjects) {
    const columns: string[] = [];
    for (const start of [0, 3]) {
      pattern.lastIndex = start;
      columns.push(`test ${tests(pattern, make())} ${state(pattern)}`);
      pattern.lastIndex = start;
      columns.push(`exec ${show(execs(pattern, make()))} ${state(pattern)}`);
      pattern.lastIndex = start;
      columns.push(`whole ${wholeMatch(pattern, make())} ${state(pattern)}`);
      pattern.lastIndex = start;
      columns.push(`match ${show(matches(make(), pattern))} ${state(pattern)}`);
      pattern.lastIndex = start;
      columns.push(`replace ${JSON.stringify(replaces(make(), pattern))} ${state(pattern)}`);
    }
    console.log(String(pattern), kind, JSON.stringify(make()), columns.join(" | "));
  }
}

const flats = [absent, "0123456789", "-- .. --", "1 2 3 4 5 6 7 8 9"];
const wides = [wideAbsent, "─━│ 123 ┃"];
function countMisses(turn: number) {
  const flat = flats[turn % flats.length];
  const wide = wides[turn % wides.length];
  const from = turn % 8;
  let misses = 0;
  for (const pattern of [code, word, sign]) {
    if (!tests(pattern, flat)) misses++;
    if (!tests(pattern, absent.slice(from, from + 10))) misses++;
    if (execs(pattern, flat) === null) misses++;
    if (execs(pattern, absent.slice(from, from + 10)) === null) misses++;
    if (wholeMatch(pattern, flat) === undefined) misses++;
    if (wholeMatch(pattern, absent.slice(from, from + 10)) === undefined) misses++;
    if (matches(flat, pattern) === null) misses++;
    if (matches(absent.slice(from, from + 10), pattern) === null) misses++;
    if (replaces(flat, pattern) === flat) misses++;
    if (replaces(absent.slice(from, from + 10), pattern).length === 10) misses++;
  }
  for (const pattern of [stickyA, everyCode, stickyCode]) {
    pattern.lastIndex = from;
    if (!tests(pattern, flat) && pattern.lastIndex === 0) misses++;
    pattern.lastIndex = from;
    if (!tests(pattern, absent.slice(from, from + 10)) && pattern.lastIndex === 0) misses++;
    pattern.lastIndex = from;
    if (execs(pattern, flat) === null && pattern.lastIndex === 0) misses++;
  }
  for (const pattern of [everyA, everyCode]) {
    pattern.lastIndex = from;
    if (replaces(flat, pattern) === flat && pattern.lastIndex === 0) misses++;
    pattern.lastIndex = from;
    if (replaces(absent.slice(from, from + 10), pattern).length === 10 && pattern.lastIndex === 0) misses++;
  }
  if (!tests(code, wide)) misses++;
  if (!tests(code, wideAbsent.slice(from, from + 10))) misses++;
  if (execs(code, wide) === null) misses++;
  if (execs(code, wideAbsent.slice(from, from + 10)) === null) misses++;
  if (matches(wide, code) === null) misses++;
  if (replaces(wide, code) === wide) misses++;
  if (replaces(wideAbsent.slice(from, from + 10), code).length === 10) misses++;
  return misses;
}
let warmUp = 0;
for (let turn = 0; turn < 8; turn++) warmUp += countMisses(turn);
const before = genericCalls();
let misses = 0;
for (let turn = 0; turn < 10000; turn++) misses += countMisses(turn);
console.log(warmUp, misses, genericCalls() - before, JSON.stringify(RegExp.lastMatch));

function attempt(run: () => unknown) {
  try {
    const value = run();
    return value === undefined ? "undefined" : JSON.stringify(value);
  } catch (error) {
    return (error as Error).name;
  }
}
const operations: [name: string, run: (pattern: RegExp, text: string) => unknown][] = [
  ["test", tests],
  ["exec", execs],
  ["whole", wholeMatch],
  ["match", (pattern, text) => matches(text, pattern)],
  ["replace", (pattern, text) => replaces(text, pattern)],
];
function report(label: string, create: () => RegExp) {
  for (const text of [present, absent, present.slice(3, 14), absent.slice(3, 14)]) {
    const columns = operations.map(([name, run]) => {
      const pattern = create();
      return `${name} ${attempt(() => run(pattern, text))} ${state(pattern)}`;
    });
    console.log(label, String(create()), JSON.stringify(text), columns.join(" | "));
  }
}

let conversions = 0;
const converted = {
  valueOf() {
    conversions++;
    return 1;
  },
};
function withLastIndex(pattern: RegExp, lastIndex: unknown) {
  (pattern as any).lastIndex = lastIndex;
  return pattern;
}
let ownExecCalls = 0;
function withOwnExec(pattern: RegExp) {
  (pattern as any).exec = function () {
    ownExecCalls++;
    return null;
  };
  return pattern;
}
for (const create of [() => /\d+x/, () => /abc/, () => /%/, () => /a/g, () => /a/y, () => /\d+x/g, () => /\p{L}/u]) {
  report("lastIndex is an object", () => withLastIndex(create(), converted));
  console.log("conversions", conversions);
  report("lastIndex is -1", () => withLastIndex(create(), -1));
  report("lastIndex is 1e9", () => withLastIndex(create(), 1e9));
  report("lastIndex is 1.5", () => withLastIndex(create(), 1.5));
  report("frozen", () => Object.freeze(create()));
  report("read-only lastIndex", () => Object.defineProperty(create(), "lastIndex", { writable: false }));
  report("own exec", () => withOwnExec(create()));
  console.log("own exec calls", ownExecCalls);
}

class Pattern extends RegExp {}
class Counting extends RegExp {
  calls = 0;
  exec(text: string): RegExpExecArray | null {
    this.calls++;
    return super.exec(text);
  }
}
report("subclass", () => new Pattern("\\d+x"));
report("subclass", () => new Pattern("abc"));
report("subclass", () => new Pattern("a", "g"));
report("subclass", () => new Pattern("a", "y"));
const counting = new Counting("\\d+x");
report("subclass with its own exec", () => counting);
console.log("calls", counting.calls);
