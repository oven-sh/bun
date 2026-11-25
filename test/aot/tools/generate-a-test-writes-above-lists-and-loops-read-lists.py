#!/usr/bin/env python3
# generate-a-test-writes-above-lists-and-loops-read-lists.py <folder>: all 12 projects; ../parallel-test-runs/a-test-writes-above-lists-and-loops-read-lists/ holds 4 of them, each of which a fault laid into the compiler on purpose has turned red: each is run by `bun test` and by `bun test --aot` and must print the same.
# A test writes above lists, by one road a project, and loops read lists by index and by for-of: lists of whole numbers, of fractions, of texts, with holes, read past their ends, stored into, grown and cut in the loop,
# and lists that are not as they were made: with an accessor under an index, with a way of their own to be stepped, of a class of the program's, frozen, sparse, behind a Proxy.
# A loop that reads a list's storage in line asks the list itself in front of the loop, and nothing of what stands above lists: what the list says of itself must be heard whatever was written above.
import json, os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
count = 0
APP = '''export function total(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function byIndex(values: number[]): number {
  let sum = 0;
  for (let at = 0; at < values.length; at++) sum += values[at];
  return sum;
}
export function pastTheEnd(values: number[]): string {
  let said = "";
  for (let at = 0; at < values.length + 2; at++) said += values[at] + ",";
  return said;
}
export function joined(values: string[]): string {
  let said = "";
  for (const value of values) said += value;
  return said;
}
export function doubled(values: number[]): string {
  for (let at = 0; at < values.length; at++) values[at] = values[at] * 2;
  return values.join();
}
export function pairs(first: number[], second: number[]): number {
  let sum = 0;
  for (let at = 0; at < first.length; at++) sum += first[at] * second[at];
  return sum;
}
export function withHook(values: number[], hook: (at: number) => void): string {
  let said = "";
  for (let at = 0; at < values.length; at++) {
    hook(at);
    said += values[at] + ",";
  }
  return said;
}
export function steppedWithHook(values: number[], hook: (value: number) => void): string {
  let said = "";
  for (const value of values) {
    hook(value);
    said += value + ",";
  }
  return said;
}
export function found(values: number[], wanted: number): number {
  let places = 0;
  for (let at = 0; at < values.length; at++) if (values.includes(wanted + at)) places += at + 1;
  return places;
}
'''
HEAD = '''import { IMPORTS } from "bun:test";
import { byIndex, doubled, found, joined, pairs, pastTheEnd, steppedWithHook, total, withHook } from "./app";
const named = (...parts: string[]): string => parts.join("");
class Row extends Array<number> {
  *[Symbol.iterator](): ArrayIterator<number> {
    for (let at = this.length - 1; at >= 0; at--) yield this[at] + 100;
  }
}
function lists(): Record<string, number[]> {
  const size = named("abc").length;
  const whole = [1, 2, 3].map(value => value + size - 3);
  const fractions = whole.map(value => value + 0.5);
  const holes = [1, , 3] as number[];
  const accessor = [1, 2, 3];
  Object.defineProperty(accessor, "1", { get() { return 40; }, configurable: true, enumerable: true });
  const stepped = [1, 2, 3];
  (stepped as any)[Symbol.iterator] = function* () { yield 7; yield 8; };
  const row = Row.from([1, 2, 3]) as Row;
  const frozen = Object.freeze([4, 5, 6]) as number[];
  const sparse: number[] = [];
  sparse[70000] = 5;
  sparse.length = 3;
  sparse[1] = 9;
  const behind = new Proxy([1, 2, 3], { get(target, key, receiver) { return key === "1" ? 60 : Reflect.get(target, key, receiver); } });
  const tagged = [1, 2, 3];
  (tagged as any).tag = size;
  return { whole, fractions, holes, accessor, stepped, row, frozen, sparse, behind, tagged };
}
function all(): string {
  const shown: unknown[] = [];
  for (const [name, list] of Object.entries(lists())) {
    for (const ask of [() => total(list), () => byIndex(list), () => pastTheEnd(list), () => pairs(list, list), () => found(list, 2), () => doubled(list)]) {
      try {
        shown.push(ask());
      } catch (error) {
        shown.push((error as Error).constructor.name);
      }
    }
    shown.push(name);
  }
  shown.push(joined([named("a", "b"), named("c")]));
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

project('nothing-is-written-above-lists', 'The lists alone say what they are.', '''
  console.log(named("no", "thing"));
''')
project('a-spy-on-push', 'The spy is laid and taken away again; no loop calls push.', '''
  const spy = spyOn(Array.prototype, "push");
  const grown: number[] = [];
  grown.push(1);
  console.log(all(), spy.mock.calls.length);
  spy.mockRestore();
''', 'spyOn, test')
project('a-spy-on-includes-which-a-loop-calls', 'The loop that calls includes finds the spy; the loops beside it read on.', '''
  const spy = spyOn(Array.prototype, "includes").mockImplementation(function () { return true; });
  console.log(all(), spy.mock.calls.length > 0);
  spy.mockRestore();
''', 'spyOn, test')
project('join-is-stored-under-its-name', 'What a loop has stored into a list is shown through the stored method.', '''
  const original = Array.prototype.join;
  Array.prototype.join = function () { return "joined by the test"; };
  console.log(all());
  Array.prototype.join = original;
''')
project('values-is-stored-under-its-name', 'A loop over a list does not go by the name `values`.', '''
  const original = Array.prototype.values;
  Array.prototype.values = function* () { yield 50; } as any;
  console.log(all(), [...[1, 2].values()].join());
  Array.prototype.values = original;
''')
project('a-method-is-deleted', 'The delete names the prototype and the method.', '''
  const original = Array.prototype.flat;
  delete (Array.prototype as any).flat;
  console.log(all(), typeof [].flat);
  Array.prototype.flat = original;
''')
project('a-method-becomes-an-accessor', 'Object.defineProperty lays a getter under the name of a method.', '''
  const original = Array.prototype.includes;
  Object.defineProperty(Array.prototype, "includes", { configurable: true, get() { return () => false; } });
  console.log(all());
  Object.defineProperty(Array.prototype, "includes", { configurable: true, writable: true, value: original });
''')
project('a-member-above-all-objects-is-stored', 'What stands above all objects stands above lists too.', '''
  const original = Object.prototype.toString;
  Object.prototype.toString = function () { return "above all"; };
  console.log(all(), String({}));
  Object.prototype.toString = original;
''')
project('written-under-a-name-nobody-sees', 'The holder and the name come out of texts put together at run time.', '''
  const holder: any = (globalThis as any)[named("Ar", "ray")][named("proto", "type")];
  const name = named("index", "Of"), original = holder[name];
  holder[name] = function () { return 77; };
  console.log(all(), [1].indexOf(1));
  holder[name] = original;
''')
project('written-in-the-second-turn-of-a-loop-by-index', 'The loop is under way when the spy is laid; the list is cut in the same turn.', '''
  const list = [1, 2, 3, 4, 5].map(value => value + named("").length);
  let spy: ReturnType<typeof spyOn> | undefined;
  console.log(withHook(list, at => {
    if (at !== 1) return;
    spy = spyOn(Array.prototype, "push");
    list.length = 3;
  }));
  console.log(all());
  spy!.mockRestore();
''', 'spyOn, test')
project('the-list-changes-its-kind-in-a-turn-behind-a-write-above', 'A fraction, then a text, then an accessor are laid into the list that the loop reads.', '''
  const spy = spyOn(Array.prototype, "pop");
  const list = [1, 2, 3, 4, 5, 6].map(value => value + named("").length) as any[];
  console.log(withHook(list, at => {
    if (at === 0) list[1] = 2.5;
    if (at === 2) list[3] = named("te", "xt");
    if (at === 4) Object.defineProperty(list, "5", { get() { return "got"; } });
  }));
  const stepped = [1, 2, 3, 4].map(value => value + named("").length) as any[];
  console.log(steppedWithHook(stepped, value => {
    if (value === 1) stepped[1] = 2.5;
    if (value === 2.5) stepped.push(named("la", "st"));
    if (value === 3) delete stepped[3];
  }));
  console.log(all());
  spy.mockRestore();
''', 'spyOn, test')
project('what-one-file-of-the-run-lays-the-next-file-finds', 'The first file leaves its spy in place; the second file of the run reads lists.', '''
  spyOn(Array.prototype, "includes").mockImplementation(function () { return true; });
''', 'spyOn, test', {'b_test.ts': 'import { test } from "bun:test";\nimport { byIndex, found, pastTheEnd, total } from "./app";\ntest("the file behind it", () => {\n  const list = [1, , 3.5] as number[];\n  console.log(total([1, 2, 3]), byIndex([1.5, 2]), pastTheEnd(list), found([1, 2, 3], 9));\n});\n'})
print(count, 'projects')
