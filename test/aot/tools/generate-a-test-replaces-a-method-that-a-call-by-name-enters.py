#!/usr/bin/env python3
# generate-a-test-replaces-a-method-that-a-call-by-name-enters.py <folder>: all 11 projects; ../parallel-test-runs/a-test-replaces-a-method-that-a-call-by-name-enters/ holds 4 of them, each of which a fault laid into the compiler on purpose has turned red: each is run by `bun test` and by `bun test --aot` and must print the same.
# A call by name on a value whose class nobody has proven goes through a stub that looks at the receiver and enters the built-in's method. In a test run a test may replace that method:
# the stub asks the byte of the member as well, and finds what was laid: whichever way it was laid, under whichever of its names, on a receiver out of a field, out of a set, out of a parameter of any type,
# between the read of the method and the call, and in a run in which code that nobody compiled may be loaded, so that no member is locked.
import json, os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
count = 0
APP = '''export class Ledger {
  names: string[] = [];
  sums = new Map<string, number>();
  seen = new Set<string>();
  add(line: string): void {
    const parts = line.split(",");
    const name = parts[0].trim();
    this.names.push(name);
    this.seen.add(name);
    this.sums.set(name, (this.sums.get(name) ?? 0) + Number(parts[1]));
  }
  says(): string {
    return this.names.join("+") + " " + this.sums.has("b") + " " + this.seen.has("a") + " " + this.sums.get("a") + " " + this.names.includes("b") + " " + this.names.indexOf("b") + " " + this.seen.size;
  }
}
export function emptied(caches: Set<any>): number {
  let left = 0;
  for (const cache of caches) {
    cache.clear();
    left += cache.size;
  }
  return left;
}
export function asked(thing: any, key: any): unknown {
  return thing.has(key);
}
export function got(thing: any, key: () => any): unknown {
  return thing.get(key());
}
export function cut(text: any): string {
  return text.trimStart() + "|" + text.trimLeft() + "|" + text.slice(1) + "|" + text.startsWith(" a") + "|" + text.indexOf("b");
}
export function matched(pattern: any, text: string): unknown {
  return pattern.test(text) + " " + (pattern.exec(text) ?? ["none"])[0];
}
export function popped(list: any): string {
  list.push(7, 8);
  return list.pop() + " " + list.shift() + " " + list.slice(1).length + " " + list.length;
}
'''
HEAD = '''import { IMPORTS } from "bun:test";
import { Ledger, asked, cut, emptied, got, matched, popped } from "./app";
const named = (...parts: string[]): string => parts.join("");
function all(): string {
  const shown: unknown[] = [];
  const key = {};
  for (const ask of [
    () => { const ledger = new Ledger(); for (const line of [" a,1", "b ,2", "a,3"]) ledger.add(line); return ledger.says(); },
    () => emptied(new Set<any>([new Map([[1, 2]]), new Set([3]), new Map(), { size: 9, clear() { this.size = 4; } }])),
    () => asked(new Map([[key, 1]]), key) + " " + asked(new Set([1]), 2) + " " + asked(new WeakMap([[key, 1]]), key) + " " + asked(new WeakSet([key]), {}) + " " + asked({ has: () => "own" }, 0),
    () => got(new Map([[named("k"), 5]]), () => named("k")) + " " + got(new WeakMap([[key, 6]]), () => key),
    () => cut(named(" a", "b ")),
    () => matched(new RegExp(named("b", "+")), named("ab", "bc")),
    () => popped([1, 2, 3].map(value => value + named("").length)),
  ]) {
    try {
      shown.push(ask());
    } catch (error) {
      shown.push((error as Error).constructor.name);
    }
  }
  return shown.join(" ; ");
}
'''
NO_LOCK = '  if (process.env.NEVER) Bun.plugin({ name: "never", setup() {} });\n'
def project(name, says, test, imports='test', more=None, noLock=False):
    global count
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, 'package.json'), 'w').write(json.dumps({'name': name, 'type': 'module'}) + '\n')
    open(os.path.join(folder, 'app.ts'), 'w').write(APP)
    open(os.path.join(folder, 'a_test.ts'), 'w').write('// ' + says + '\n' + HEAD.replace('IMPORTS', imports) + 'test(' + json.dumps(says) + ', () => {\n' + (NO_LOCK if noLock else '') + '  console.log(all());\n' + test.strip('\n') + '\n  console.log(all());\n});\n')
    for path, text in (more or {}).items():
        open(os.path.join(folder, path), 'w').write(text)
    count += 1

for noLock in (False, True):
    tail = '-where-no-lock-is-laid' if noLock else ''
    project('nothing-is-replaced' + tail, 'The receivers alone say what they are.', '''
  console.log(named("no", "thing"));
''', noLock=noLock)
    project('clear-of-maps-is-stored' + tail, 'The sets beside the maps are emptied by their own method.', '''
  const original = Map.prototype.clear;
  Map.prototype.clear = function () {};
  console.log(all());
  Map.prototype.clear = original;
''', noLock=noLock)
    project('spies-on-methods-of-maps-sets-and-lists' + tail, 'Each spy answers for its method; the calls are counted.', '''
  const spies = [spyOn(Map.prototype, "get").mockImplementation(function () { return 70; }), spyOn(Set.prototype, "has").mockImplementation(function () { return "spied" as any; }),
    spyOn(Array.prototype, "push").mockImplementation(function () { return 0; }), spyOn(Array.prototype, "includes")];
  console.log(all(), spies.map(spy => spy.mock.calls.length > 0).join());
  for (const spy of spies) spy.mockRestore();
''', 'spyOn, test', noLock=noLock)
    project('written-under-names-nobody-sees' + tail, 'The holders and the names come out of texts put together at run time.', '''
  const kept: Array<[any, string, unknown]> = [];
  for (const [holderName, name] of [["Map", "has"], ["WeakMap", "get"], ["String", "slice"], ["RegExp", "test"], ["Array", "shift"]]) {
    const holder: any = (globalThis as any)[named(holderName)][named("proto", "type")];
    kept.push([holder, name, holder[name]]);
    holder[named(name)] = function () { return "laid over " + name; };
  }
  console.log(all());
  for (const [holder, name, original] of kept) holder[name] = original;
''', noLock=noLock)
project('one-of-two-names-of-a-method-is-stored', 'trimLeft and trimStart hold one function; only one of the names is written.', '''
  const original = String.prototype.trimLeft;
  String.prototype.trimLeft = function () { return "left"; };
  console.log(all());
  String.prototype.trimLeft = original;
''')
project('a-method-becomes-an-accessor-and-is-deleted', 'A getter under `set`, nothing under `add`.', '''
  const set = Map.prototype.set, add = Set.prototype.add;
  Object.defineProperty(Map.prototype, "set", { configurable: true, get() { return function (this: Map<unknown, unknown>, key: unknown) { return set.call(this, key, 90); }; } });
  delete (Set.prototype as any).add;
  console.log(all());
  Object.defineProperty(Map.prototype, "set", { configurable: true, writable: true, value: set });
  Set.prototype.add = add;
''')
project('replaced-between-the-read-of-the-method-and-the-call', 'The method is read in front of its operands: the call enters what was read.', '''
  const original = Map.prototype.get;
  console.log(got(new Map([[named("k"), 5]]), () => {
    Map.prototype.get = function () { return "late"; };
    return named("k");
  }));
  console.log(all());
  Map.prototype.get = original;
''')
project('what-one-file-of-the-run-lays-the-next-file-finds', 'The first file leaves its method in place; the second file of the run empties caches.', '''
  Map.prototype.clear = function () {};
''', 'test', {'b_test.ts': 'import { test } from "bun:test";\nimport { emptied } from "./app";\ntest("the file behind it", () => {\n  console.log(emptied(new Set<any>([new Map([[1, 2]]), new Set([3])])));\n});\n'})
print(count, 'projects')
