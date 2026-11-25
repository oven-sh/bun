#!/usr/bin/env python3
# generate-code-that-nobody-compiled-writes-above-built-ins.py <folder>: all 26 projects; ../parallel-test-runs/code-that-nobody-compiled-writes-above-built-ins/ holds 6 of them, each of which a fault laid into the compiler on purpose has turned red: each is run by `bun test` and by `bun test --aot` and must print the same.
# The test run may lay a plugin, so code that nobody compiled may run in it and no built-in can be locked. Compiled code still reads texts, lists, sets and maps in line, as long as nothing was written above them.
# In each project code that the build has never seen (a text put together at run time, a file found by a name made at run time) writes above a class by one road; what is compiled has to find it at its very next read.
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
HEAD = '''import { test } from "bun:test";
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
def project(name, says, test, files=None, imports=''):
    global count
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, 'package.json'), 'w').write(json.dumps({'name': name, 'type': 'module'}) + '\n')
    open(os.path.join(folder, 'app.ts'), 'w').write(APP)
    body = HEAD.replace('import { test } from "bun:test";\n', 'import { test } from "bun:test";\n' + imports)
    open(os.path.join(folder, 'a_test.ts'), 'w').write('// ' + says + '\n' + body + 'test(' + json.dumps(says) + ', ' + ('async ' if 'await ' in test else '') + '() => {\n  if (process.env.NEVER) Bun.plugin({ name: "never", setup() {} });\n  console.log(all());\n' + test.strip('\n') + '\n  console.log(all());\n});\n')
    for path, text in (files or {}).items():
        open(os.path.join(folder, path), 'w').write(text)
    count += 1

def pieces(text):
    cutAt = max(1, len(text) // 2)
    return 'named(' + json.dumps(text[:cutAt]) + ', ' + json.dumps(text[cutAt:]) + ')'
def evaluated(text):
    return '  (0, eval)(' + pieces(text) + ');'

ROADS = (
    ('a-plain-store', 'A plain store lays another method above texts.', 'String.prototype.charCodeAt = function () { return 1; };'),
    ('a-store-at-a-place-that-has-stored-on-other-objects-a-hundred-times', 'The place that stores has seen a hundred other objects first.', 'function lay(o, f) { o.charCodeAt = f; } for (let k = 0; k < 100; k++) lay({}, k); lay(String.prototype, function () { return 2; });'),
    ('a-store-under-a-key-worked-out', 'The name is worked out where the store stands.', 'const name = ["sl", "ice"].join(""); String.prototype[name] = function () { return "cut"; };'),
    ('define-property-with-a-value', 'Object.defineProperty lays a value.', 'Object.defineProperty(String.prototype, "slice", { configurable: true, writable: true, value() { return "defined"; } });'),
    ('define-property-with-an-accessor', 'Object.defineProperty lays an accessor in place of a method.', 'Object.defineProperty(Number.prototype, "toFixed", { configurable: true, get() { return () => "got"; } });'),
    ('define-properties', 'Object.defineProperties lays two at once, above two classes.', 'Object.defineProperties(Map.prototype, { get: { configurable: true, writable: true, value() { return "mapped"; } } }); Object.defineProperties(String.prototype, { slice: { configurable: true, writable: true, value() { return "both"; } } });'),
    ('object-assign', 'Object.assign copies a method onto the prototype.', 'Object.assign(String.prototype, { charCodeAt() { return 3; } });'),
    ('reflect-set', 'Reflect.set stores.', 'Reflect.set(Map.prototype, "get", function () { return "reflected"; });'),
    ('reflect-define-property', 'Reflect.defineProperty lays a value.', 'Reflect.defineProperty(Number.prototype, "toFixed", { configurable: true, writable: true, value() { return "reflected"; } });'),
    ('a-delete', 'The method is deleted: the call throws from then on.', 'delete String.prototype.charCodeAt;'),
    ('a-store-above-all-objects', 'What lies above all objects is replaced.', 'Object.prototype.hasOwnProperty = function () { return "above all"; };'),
    ('the-way-sets-are-stepped', 'Another way of stepping is laid above sets, under a symbol.', 'Set.prototype[Symbol.iterator] = function* () { yield 50; yield 5; };'),
    ('the-prototype-is-frozen', 'Freezing changes no value: everything answers as before.', 'Object.freeze(String.prototype); Object.freeze(Array.prototype);'),
    ('native-code-lays-a-name', 'Native code lays a name above lists: nothing that is asked here changes.', 'Error.captureStackTrace(Array.prototype);'),
)
for name, says, text in ROADS:
    project(name, says, evaluated(text))

WRITER = 'String.prototype.charCodeAt = function () { return 4; }; Map.prototype.get = function () { return "laid"; };'
project('run-by-the-function-constructor', 'The text is made into a function and called.', '  new Function(' + pieces(WRITER) + ')();')
project('run-by-a-direct-eval', 'The text is evaluated where the test stands.', '  eval(' + pieces(WRITER) + ');')
project('run-in-this-context', 'node:vm runs the text in this very realm.', '  vm.runInThisContext(' + pieces(WRITER) + ');', imports='import vm from "node:vm";\n')
project('run-as-a-script', 'node:vm compiles a script first and runs it later.', '  const script = new vm.Script(' + pieces(WRITER) + ');\n  console.log(all());\n  script.runInThisContext();', imports='import vm from "node:vm";\n')
project('run-in-another-context', 'Another context has built-ins of its own: nothing changes here.', '  vm.runInNewContext(' + pieces(WRITER) + ');', imports='import vm from "node:vm";\n')
FILES = 'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n'
def written(extension):
    return '  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "laid-")), named("lay", ' + json.dumps(extension) + '));\n  fs.writeFileSync(file, ' + pieces(WRITER) + ');\n'
REQUIRE = 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n'
project('a-file-written-by-the-test-is-required', 'The file does not exist while the run is built.', written('.cjs') + '  require(file);', None, FILES + REQUIRE)
project('a-file-written-by-the-test-is-imported', 'The module does not exist while the run is built.', written('.mjs') + '  await import(file);', None, FILES)
project('a-file-written-by-the-test-is-loaded-by-the-loader-itself', 'node:module loads a file that does not exist while the run is built.', written('.cjs') + '  (Module as any)._load(file, null, false);', None, FILES + 'import Module from "node:module";\n')
project('a-text-compiled-as-a-module', 'A module is made by hand and given its text.', '  const made = new (Module as any)(named("made", ".cjs"));\n  made._compile(' + pieces(WRITER) + ', path.join(import.meta.dir, named("made", ".cjs")));', None, 'import Module from "node:module";\nimport path from "node:path";\n')
project('a-kind-of-file-with-a-loader-of-its-own', 'A loader is stored for a kind of file, and a file of that kind, written by the test, is required.', written('.lay') + '  require.extensions[named(".l", "ay")] = (module: any, filename: string) => module._compile(fs.readFileSync(filename, "utf8"), filename);\n  require(file);', None, FILES + REQUIRE)
project('written-while-a-compiled-loop-is-under-way', 'The third turn of a compiled loop runs the text: the same turn reads what was laid.', '  console.log(codesWithHook(named("ab", "cdef"), at => {\n    if (at === 2) (0, eval)(' + pieces(WRITER) + ');\n  }));')
project('written-by-a-callback-that-comes-later', 'The text runs between two awaits of the test.', '  await new Promise<void>(done => setTimeout(() => {\n    (0, eval)(' + pieces(WRITER) + ');\n    done();\n  }, 1));')
print(count, 'projects')
