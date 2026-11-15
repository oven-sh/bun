#!/usr/bin/env python3
# generate-a-test-is-seen-to-replace-a-member-above-a-class.py <folder>: all 10 projects; ../parallel-test-runs/a-test-is-seen-to-replace-a-member-above-a-class/ holds 4 of them, each of which a fault laid into the compiler on purpose has turned red: each is run by `bun test` and by `bun test --aot` and must print the same.
# A test replaces a method above texts, numbers, lists, sets or maps, and the build sees it do so: the member is named where it is written. One such test among thousands must not cost the others their code in line:
# what is compiled reads in line as long as nothing was written above the class, and finds what was laid at its very next read.
# Only the first write above a class in a process meets code that still counts on nothing having been written: so each road has a project of its own.
import json, os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
count = 0
APP = '''export function codes(text: string): number {
  let sum = 0;
  for (let at = 0; at < text.length; at++) sum += text.charCodeAt(at);
  return sum;
}
export function cut(text: string): string {
  return text.slice(1);
}
export function total(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function totalOfSet(values: Set<number>): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function found(values: Map<string, number>, key: string): unknown {
  return values.get(key);
}
export function fixed(value: number): string {
  return value.toFixed(1);
}
export function owns(values: number[], name: string): unknown {
  return values.hasOwnProperty(name);
}
export function codesWithHook(text: string, hook: (at: number) => void): string {
  const seen: number[] = [];
  for (let at = 0; at < text.length; at++) {
    hook(at);
    seen.push(text.charCodeAt(at));
  }
  return seen.join();
}
'''
HEAD = '''import { IMPORTS } from "bun:test";
import { codes, codesWithHook, cut, fixed, found, owns, total, totalOfSet } from "./app";
const named = (...parts: string[]): string => parts.join("");
function all(): string {
  const text = named("ab", "cd"), list = [1, 2, 3].map(value => value + text.length - 4);
  const shown: unknown[] = [];
  for (const ask of [() => codes(text), () => cut(text), () => total(list), () => totalOfSet(new Set(list)), () => found(new Map([[text, 5]]), text), () => fixed(list.length / 2), () => owns(list, "0")]) {
    try {
      shown.push(ask());
    } catch (error) {
      shown.push((error as Error).constructor.name);
    }
  }
  return shown.join(" ");
}
'''
def project(name, says, test, imports='test', more=None):
    global count
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, 'package.json'), 'w').write(json.dumps({'name': name, 'type': 'module'}) + '\n')
    open(os.path.join(folder, 'app.ts'), 'w').write(APP)
    open(os.path.join(folder, 'a_test.ts'), 'w').write('// ' + says + '\n' + HEAD.replace('IMPORTS', imports) + 'test(' + json.dumps(says) + ', () => {\n  console.log(all());\n' + test.strip('\n') + '\n  console.log(all());\n});\n')
    for path, text in (more or {}).items():
        open(os.path.join(folder, path), 'w').write(text)
    count += 1

project('a-method-of-texts-is-stored-under-its-name', 'The store names the prototype and the method.', '''
  const original = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function () { return 1; };
  console.log(all());
  String.prototype.charCodeAt = original;
''')
project('a-spy-on-a-method-of-texts', 'spyOn names the prototype and the method.', '''
  const spy = spyOn(String.prototype, "slice").mockImplementation(function () { return "spied"; });
  console.log(all(), spy.mock.calls.length);
  spy.mockRestore();
''', 'spyOn, test')
project('a-method-of-maps-is-stored-under-its-name', 'The store names the prototype and the method.', '''
  const original = Map.prototype.get;
  Map.prototype.get = function () { return "stored"; };
  console.log(all());
  Map.prototype.get = original;
''')
project('a-method-of-numbers-is-defined-under-its-name', 'Object.defineProperty names the prototype and the method.', '''
  const original = Number.prototype.toFixed;
  Object.defineProperty(Number.prototype, "toFixed", { configurable: true, writable: true, value() { return "defined"; } });
  console.log(all());
  Object.defineProperty(Number.prototype, "toFixed", { configurable: true, writable: true, value: original });
''')
project('a-method-of-texts-is-deleted-under-its-name', 'The delete names the prototype and the method.', '''
  const original = String.prototype.charCodeAt;
  delete (String.prototype as any).charCodeAt;
  console.log(all());
  String.prototype.charCodeAt = original;
''')
project('the-way-sets-are-stepped-is-stored-under-its-symbol', 'The store names the prototype and the symbol.', '''
  const original = Set.prototype[Symbol.iterator];
  (Set.prototype as any)[Symbol.iterator] = function* () { yield 50; yield 5; };
  console.log(all());
  Set.prototype[Symbol.iterator] = original;
''')
project('a-member-above-all-objects-is-stored-under-its-name', 'The store names the prototype of all objects and the method.', '''
  const original = Object.prototype.hasOwnProperty;
  Object.prototype.hasOwnProperty = function () { return "above all" as any; };
  console.log(all());
  Object.prototype.hasOwnProperty = original;
''')
project('stored-in-the-third-turn-of-a-compiled-loop', 'The same turn reads what was laid.', '''
  const original = String.prototype.charCodeAt;
  console.log(codesWithHook(named("ab", "cdef"), at => {
    if (at === 2) String.prototype.charCodeAt = function () { return 4; };
  }));
  console.log(all());
  String.prototype.charCodeAt = original;
''')
project('what-one-file-of-the-run-stores-the-next-file-finds', 'The first file leaves its method in place; the second file of the run reads texts.', '''
  String.prototype.charCodeAt = function () { return 6; };
''', 'test', {'b_test.ts': 'import { test } from "bun:test";\nimport { codes, cut } from "./app";\ntest("the file behind it", () => {\n  console.log(codes(["ab", "cd"].join("")), cut(["ab", "cd"].join("")));\n});\n'})
project('a-file-of-the-run-that-replaces-nothing-stands-beside-one-that-does', 'The file that replaces runs last: the one in front of it reads in line.', '''
  const original = String.prototype.slice;
  String.prototype.slice = function () { return "late"; };
  console.log(all());
  String.prototype.slice = original;
''', 'test', {'0_test.ts': 'import { test } from "bun:test";\nimport { codes, cut } from "./app";\ntest("the file in front of it", () => {\n  console.log(codes(["ab", "cd"].join("")), cut(["ab", "cd"].join("")));\n});\n'})
print(count, 'projects')
