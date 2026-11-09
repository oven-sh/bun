#!/usr/bin/env python3
# generate-methods-of-primitives-that-a-test-replaces.py <folder>: all 15 projects; ../parallel-test-runs/methods-of-primitives-that-a-test-replaces/ holds 6 of them, each of which a fault laid into the compiler on purpose has turned red.
# A test reaches String.prototype, Number.prototype and their like by a road that no compiler follows, and writes on it under a name that is made at run time.
# A compiler may enter the methods of texts and numbers in line all the same, as long as it asks whether anything was written above them. Each project calls such methods, replaces one, and calls them again:
# between two calls, in the middle of a loop, between two runs of a loop, while an argument is worked out, while a function waits, and in another file of the run.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
ROADS = '''export const aboveTexts: any = Object.getPrototypeOf(Object("x"));
export const aboveNumbers: any = Object.getPrototypeOf(Object(1));
export const aboveBooleans: any = Object.getPrototypeOf(Object(true));
export const aboveSymbols: any = Object.getPrototypeOf(Object(Symbol.iterator));
export const aboveBigIntegers: any = Object.getPrototypeOf(Object(1n));
export const aboveAll: any = Object.getPrototypeOf(aboveTexts);
export const named = (...parts: string[]): string => parts.join("");
export function put(target: any, name: string, value: unknown): unknown {
  const before = target[name];
  target[name] = value;
  return before;
}
'''
count = 0
def project(name, files):
    global count
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, 'package.json'), 'w').write('{ "name": "p", "type": "module" }\n')
    open(os.path.join(folder, 'roads.ts'), 'w').write(ROADS)
    for file, text in files.items():
        if file.endswith('_test.ts'):
            for written in ('abcde', 'abcd', 'abc', 'ab', ' a b ', ' a ', ' b ', ' c '):
                text = text.replace('"' + written + '"', 'roads.named("' + written[:1] + '", "' + written[1:] + '")')
        open(os.path.join(folder, file), 'w').write(text.strip('\n') + '\n')
    count += 1

HEAD = 'import { test } from "bun:test";\nimport * as roads from "./roads";\n'

project('a-method-of-texts-is-replaced-between-two-calls', {
 'app.ts': '''
export function tail(text: string): string {
  return text.slice(1);
}
export function both(text: string, between: () => void): string {
  const first = text.slice(1);
  between();
  return first + "|" + text.slice(1);
}
''',
 'a_test.ts': HEAD + '''
import { both, tail } from "./app";
test("slice is replaced and put back", () => {
  const name = roads.named("sl", "ice");
  console.log("as built:", tail("abc"), both("abc", () => {}));
  let original: unknown;
  console.log("in the middle:", both("abc", () => { original = roads.put(roads.aboveTexts, name, function (this: string) { return "mine:" + this; }); }));
  console.log("replaced:", tail("abc"), both("abc", () => {}));
  console.log("put back in the middle:", both("abc", () => { roads.put(roads.aboveTexts, name, original); }));
  console.log("put back:", tail("abc"), both("abc", () => {}));
});
'''})

project('a-method-of-texts-is-replaced-in-the-middle-of-a-loop', {
 'app.ts': '''
export function codes(text: string, atTurn: number, then: () => void): string {
  let sum = "";
  for (let at = 0; at < text.length; at++) {
    if (at === atTurn) then();
    sum += text.charCodeAt(at) + ",";
  }
  return sum;
}
''',
 'a_test.ts': HEAD + '''
import { codes } from "./app";
test("charCodeAt is replaced while a loop runs", () => {
  const name = roads.named("char", "Code", "At");
  console.log("as built:", codes("abcd", -1, () => {}));
  let original: unknown;
  console.log("from the third turn on:", codes("abcd", 2, () => { original = roads.put(roads.aboveTexts, name, () => 7); }));
  console.log("replaced:", codes("abcd", -1, () => {}));
  console.log("put back at the second turn:", codes("abcd", 1, () => { roads.put(roads.aboveTexts, name, original); }));
  console.log("put back:", codes("abcd", -1, () => {}));
});
'''})

project('a-method-of-texts-is-replaced-between-two-runs-of-a-loop-that-runs-nothing-else', {
 'app.ts': '''
export function breaks(text: string, from: number): number {
  let found = 0;
  for (let at = from; at < text.length; at++) if (text.charCodeAt(at) === 10) found++;
  return found;
}
function widthOfBreak(text: string, at: number): number {
  const code = text.charCodeAt(at);
  if (code === 10) return 1;
  if (code === 13) return at + 1 < text.length && text.charCodeAt(at + 1) === 10 ? 2 : 1;
  return 0;
}
export function lines(text: string): number {
  let at = 0, found = 0;
  while (at < text.length) {
    const width = widthOfBreak(text, at);
    if (!width) {
      at++;
      continue;
    }
    found++;
    at += width;
  }
  return found;
}
''',
 'a_test.ts': HEAD + '''
import { breaks, lines } from "./app";
test("charCodeAt is replaced between two scans", () => {
  const name = roads.named("charCode", "At"), text = roads.named("a\\nb\\r", "\\nc\\rd\\n");
  console.log("as built:", breaks(text, 0), breaks(text, 2), lines(text));
  const original = roads.put(roads.aboveTexts, name, () => 10);
  console.log("every place is a break:", breaks(text, 0), breaks(text, 2), lines(text));
  roads.put(roads.aboveTexts, name, original);
  console.log("put back:", breaks(text, 0), breaks(text, 2), lines(text));
});
'''})

project('a-method-is-replaced-while-its-argument-is-worked-out', {
 'app.ts': '''
export function cut(text: string, from: () => number): string {
  return text.slice(from()) + "|" + text.slice(1);
}
export function code(text: string, at: { valueOf(): number }): string {
  return text.charCodeAt(at as unknown as number) + "|" + text.charCodeAt(0);
}
''',
 'a_test.ts': HEAD + '''
import { code, cut } from "./app";
test("the method was read in front of its argument", () => {
  let original: unknown;
  console.log(cut("abcd", () => { original = roads.put(roads.aboveTexts, roads.named("sli", "ce"), () => "mine"); return 2; }));
  roads.put(roads.aboveTexts, roads.named("sli", "ce"), original);
  console.log(cut("abcd", () => 2));
  console.log(code("abcd", { valueOf() { original = roads.put(roads.aboveTexts, roads.named("charC", "odeAt"), () => -1); return 2; } }));
  roads.put(roads.aboveTexts, roads.named("charC", "odeAt"), original);
  console.log(code("abcd", { valueOf: () => 2 }));
});
'''})

project('a-method-is-replaced-while-a-function-waits', {
 'app.ts': '''
export async function twice(text: string, wait: Promise<void>): Promise<string> {
  const first = text.toUpperCase();
  await wait;
  return first + "|" + text.toUpperCase() + "|" + text.indexOf("b");
}
''',
 'a_test.ts': HEAD + '''
import { twice } from "./app";
test("toUpperCase is replaced during an await", async () => {
  console.log(await twice("abc", Promise.resolve()));
  let open!: () => void;
  const waiting = twice("abc", new Promise<void>(resolve => { open = resolve; }));
  const upper = roads.put(roads.aboveTexts, roads.named("toUpper", "Case"), () => "mine");
  const index = roads.put(roads.aboveTexts, roads.named("index", "Of"), () => 99);
  open();
  console.log(await waiting);
  roads.put(roads.aboveTexts, roads.named("toUpper", "Case"), upper);
  roads.put(roads.aboveTexts, roads.named("index", "Of"), index);
  console.log(await twice("abc", Promise.resolve()));
});
'''})

project('what-one-file-of-the-run-replaces-the-next-file-finds', {
 'app.ts': '''
export function words(line: string): string {
  return line.trim().split(" ").join("+") + ":" + line.indexOf("b") + ":" + line.charCodeAt(1);
}
export function fixed(value: number): string {
  return value.toFixed(1) + ":" + value.toString(2);
}
''',
 'a_test.ts': HEAD + '''
import { fixed, words } from "./app";
test("the first file replaces and leaves it so", () => {
  console.log("first, as built:", words(" a b "), fixed(2.25));
  roads.put(roads.aboveTexts, roads.named("index", "Of"), () => 41);
  roads.put(roads.aboveNumbers, roads.named("to", "Fixed"), () => "fixed by the first file");
  console.log("first, replaced:", words(" a b "), fixed(2.25));
});
''',
 'b_test.ts': HEAD + '''
import { fixed, words } from "./app";
test("the second file calls the same functions", () => {
  console.log("second:", words(" a b "), fixed(2.25));
  console.log("second, its own calls:", " a b ".indexOf("b"), (2.25).toFixed(1));
});
'''})

project('a-name-laid-above-texts-hides-a-member-above-all-objects', {
 'app.ts': '''
export function owns(text: string, name: string): string {
  return String(text.hasOwnProperty(name)) + ":" + text.toLocaleString() + ":" + String(text.propertyIsEnumerable("0"));
}
''',
 'a_test.ts': HEAD + '''
import { owns } from "./app";
test("a new name on the nearer object, and a write on the farther one", () => {
  console.log("as built:", owns("ab", "length"), owns("ab", "size"));
  (String.prototype as any).hasOwnProperty = () => "hidden";
  console.log("hidden:", owns("ab", "length"));
  delete (String.prototype as any).hasOwnProperty;
  console.log("taken away again:", owns("ab", "length"));
  const original = roads.put(roads.aboveAll, roads.named("propertyIs", "Enumerable"), () => "from above all");
  console.log("written above all:", owns("ab", "length"));
  roads.put(roads.aboveAll, roads.named("propertyIs", "Enumerable"), original);
  console.log("put back:", owns("ab", "length"));
});
'''})

project('methods-of-numbers-booleans-symbols-and-big-integers-are-replaced', {
 'app.ts': '''
export function number(value: number): string {
  return value.toFixed(2) + "|" + value.toString(16) + "|" + value.toPrecision(3) + "|" + value.valueOf();
}
export function boolean(value: boolean): string {
  return value.toString() + "|" + value.valueOf();
}
export function symbol(value: symbol): string {
  return value.toString() + "|" + value.description;
}
export function bigInteger(value: bigint): string {
  return value.toString(2) + "|" + value.valueOf();
}
''',
 'a_test.ts': HEAD + '''
import { bigInteger, boolean, number, symbol } from "./app";
const all = () => [number(255.5), boolean(true), symbol(Symbol("s")), bigInteger(5n)].join(" ; ");
test("each kind of primitive has its own object above it", () => {
  console.log("as built:", all());
  for (const [above, name] of [[roads.aboveNumbers, roads.named("to", "Fixed")], [roads.aboveNumbers, roads.named("to", "String")], [roads.aboveBooleans, roads.named("to", "String")], [roads.aboveSymbols, roads.named("to", "String")], [roads.aboveBigIntegers, roads.named("to", "String")], [roads.aboveNumbers, roads.named("value", "Of")]] as const) {
    const original = roads.put(above, name, () => "mine");
    console.log(name + ":", all());
    roads.put(above, name, original);
    console.log("put back:", all());
  }
});
'''})

project('an-accessor-is-laid-in-place-of-a-method', {
 'app.ts': '''
export function starts(text: string): string {
  let sum = "";
  for (let turn = 0; turn < 3; turn++) sum += text.startsWith("a") ? "y" : "n";
  return sum + text.at(-1);
}
export function described(value: symbol): string {
  return String(value.description);
}
''',
 'a_test.ts': HEAD + '''
import { described, starts } from "./app";
test("a getter counts the reads of the method", () => {
  console.log("as built:", starts("ab"), described(Symbol("d")));
  const name = roads.named("starts", "With"), original = roads.aboveTexts[name];
  let reads = 0;
  Object.defineProperty(roads.aboveTexts, name, { configurable: true, get() { reads++; return reads === 2 ? () => false : original; } });
  console.log("behind a getter:", starts("ab"), reads);
  Object.defineProperty(roads.aboveTexts, name, { configurable: true, writable: true, value: original });
  console.log("put back:", starts("ab"), reads);
  const accessor = Object.getOwnPropertyDescriptor(roads.aboveSymbols, roads.named("descrip", "tion"))!;
  Object.defineProperty(roads.aboveSymbols, roads.named("descrip", "tion"), { configurable: true, get: () => "mine" });
  console.log("another getter:", described(Symbol("d")));
  Object.defineProperty(roads.aboveSymbols, roads.named("descrip", "tion"), accessor);
  console.log("put back:", described(Symbol("d")));
});
'''})

project('a-method-is-deleted', {
 'app.ts': '''
export function last(text: string): string {
  try {
    return String(text.at(-1)) + text.padStart(3, "-");
  } catch (error) {
    return error instanceof TypeError ? "a type error" : "another error";
  }
}
''',
 'a_test.ts': HEAD + '''
import { last } from "./app";
test("a method that is gone cannot be called", () => {
  console.log("as built:", last("ab"));
  const name = roads.named("a", "t"), original = roads.aboveTexts[name];
  delete roads.aboveTexts[name];
  console.log("gone:", last("ab"));
  roads.put(roads.aboveTexts, name, original);
  console.log("put back:", last("ab"));
});
'''})

project('a-spy-is-laid-by-a-road-that-nobody-follows', {
 'app.ts': '''
export function shout(line: string): string {
  return line.trim().toUpperCase() + line.repeat(2);
}
export function shoutAll(lines: string[]): string {
  let all = "";
  for (const line of lines) all += line.trim() + ";";
  return all;
}
''',
 'a_test.ts': 'import { spyOn, test } from "bun:test";\nimport * as roads from "./roads";\n' + '''
import { shout, shoutAll } from "./app";
test("a spy counts the calls out of compiled code", () => {
  console.log("as built:", shout(" a "), shoutAll([" b ", " c "]));
  const spy = spyOn(roads.aboveTexts, roads.named("tr", "im"));
  console.log("watched:", shout(" a "), shoutAll([" b ", " c "]), spy.mock.calls.length);
  spy.mockImplementation(function (this: string) { return "<" + this + ">"; });
  console.log("answered:", shout(" a "), shoutAll([" b ", " c "]), spy.mock.calls.length);
  spy.mockRestore();
  console.log("put back:", shout(" a "), shoutAll([" b ", " c "]));
});
'''})

project('other-ways-of-writing-above-texts', {
 'app.ts': '''
export function parts(text: string): string {
  return text.substring(1) + "|" + text.concat("!") + "|" + text.includes("b") + "|" + text.lastIndexOf("b") + "|" + text.codePointAt(0);
}
''',
 'a_test.ts': HEAD + '''
import { parts } from "./app";
test("Reflect.set, Object.assign, defineProperties and a store through the constructor", () => {
  console.log("as built:", parts("abc"));
  const kept: Record<string, unknown> = {};
  for (const name of ["substring", "concat", "includes", "lastIndexOf", "codePointAt"]) kept[name] = roads.aboveTexts[roads.named(name)];
  Reflect.set(roads.aboveTexts, roads.named("sub", "string"), () => "by Reflect.set");
  console.log(parts("abc"));
  Object.assign(roads.aboveTexts, { [roads.named("con", "cat")]: () => "by Object.assign" });
  console.log(parts("abc"));
  Object.defineProperties(roads.aboveTexts, { [roads.named("inc", "ludes")]: { configurable: true, writable: true, value: () => "by defineProperties" } });
  console.log(parts("abc"));
  ("" as any).constructor.prototype[roads.named("lastIndex", "Of")] = () => "through the constructor";
  console.log(parts("abc"));
  ("" as any).__proto__[roads.named("codePoint", "At")] = () => "through __proto__";
  console.log(parts("abc"));
  Object.assign(roads.aboveTexts, kept);
  console.log("put back:", parts("abc"));
});
'''})

project('the-loop-leaves-its-fast-build-and-goes-on-where-it-stood', {
 'app.ts': '''
export const log: string[] = [];
export function walk(text: string, hook: (at: number) => void): number {
  let sum = 0;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    log.push(at + "=" + code);
    hook(at);
    sum += code;
  }
  return sum;
}
export function count(text: string, rounds: number, hook: (round: number) => void): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    hook(round);
    for (let at = 0; at < text.length; at++) sum += text.charCodeAt(at) & 1;
  }
  return sum;
}
''',
 'a_test.ts': HEAD + '''
import { count, log, walk } from "./app";
test("no turn runs twice and none is left out", () => {
  const name = roads.named("charCodeA", "t");
  let original: unknown;
  console.log(walk("abcde", at => { if (at === 1) original = roads.put(roads.aboveTexts, name, () => 1000); if (at === 3) roads.put(roads.aboveTexts, name, original); }), log.join(" "));
  console.log(count("abc", 4, round => { if (round === 1) original = roads.put(roads.aboveTexts, name, () => 1); if (round === 3) roads.put(roads.aboveTexts, name, original); }));
});
'''})

project('the-receiver-is-written-in-the-text', {
 'app.ts': '''
export function marks(): string {
  return "abc".toUpperCase() + "|" + "x".repeat(3) + "|" + "a,b".indexOf(",") + "|" + (5).toFixed(1) + "|" + true.toString() + "|" + (7n).toString();
}
export function sum(turns: number): number {
  let all = 0;
  for (let at = 0; at < turns; at++) all += "abcdef".charCodeAt(at);
  return all;
}
''',
 'a_test.ts': HEAD + '''
import { marks, sum } from "./app";
test("a written text finds what the test has laid", () => {
  console.log("as built:", marks(), sum(3));
  for (const [above, name] of [[roads.aboveTexts, roads.named("toUpper", "Case")], [roads.aboveTexts, roads.named("rep", "eat")], [roads.aboveTexts, roads.named("index", "Of")], [roads.aboveNumbers, roads.named("to", "Fixed")], [roads.aboveBooleans, roads.named("to", "String")], [roads.aboveBigIntegers, roads.named("to", "String")], [roads.aboveTexts, roads.named("charCode", "At")]] as const) {
    const original = roads.put(above, name, () => 1);
    console.log(name + ":", marks(), sum(3));
    roads.put(above, name, original);
  }
  console.log("put back:", marks(), sum(3));
});
'''})

project('one-call-stands-alone-in-its-function', {
 'app.ts': '''
export const trimmed = (text: string): string => text.trim();
export const lower = (text: string): string => text.toLowerCase();
export const code = (text: string): number => text.charCodeAt(0);
export const fixed = (value: number): string => value.toFixed(1);
''',
 'a_test.ts': HEAD + '''
import { code, fixed, lower, trimmed } from "./app";
const all = () => [trimmed(roads.named(" ", "a ")), lower(roads.named("A", "B")), code(roads.named("a", "b")), fixed(roads.named("1", "2").length + 0.25)].join("|");
test("each of them is replaced in its turn", () => {
  console.log("as built:", all());
  for (const [above, name] of [[roads.aboveTexts, roads.named("tr", "im")], [roads.aboveTexts, roads.named("toLower", "Case")], [roads.aboveTexts, roads.named("charCode", "At")], [roads.aboveNumbers, roads.named("to", "Fixed")]] as const) {
    const original = roads.put(above, name, () => "mine");
    console.log(name + ":", all());
    roads.put(above, name, original);
  }
  console.log("put back:", all());
});
'''})
print(count, 'projects')
