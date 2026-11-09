#!/usr/bin/env python3
# generate-for-of-loops-built-twice.py <folder>: all 1,690; ../parallel/for-of-loops-built-twice/ holds 36 of them, those that faults put in on purpose have turned red and one for each value, beside two written by hand.
# `for (const x of what)`: the loop has a typed copy that steps a list by index alone and a closed copy beside it. One shape a program, held to `bun <file>`.
# WHAT IS ITERATED x WHAT A TURN DOES x HOW THE LOOP IS LEFT. Each function runs often (a site that runs once takes the general road) and is handed the plain list first, then what is not one.
import sys, os, itertools
folder = sys.argv[1]; os.makedirs(folder, exist_ok=True)
iterated = {
  'a-list-of-numbers': ('number[]', '[3, 1, 4, 1, 5, 9, 2, 6]'),
  'a-list-of-fractions': ('number[]', '[0.5, 1.25, -3.75, 8, 2.5]'),
  'a-list-of-records': ('Item[]', 'items()'),
  'a-list-of-records-with-a-stranger': ('Item[]', 'withStranger(2)'),
  'a-list-of-records-that-ends-in-a-stranger': ('Item[]', 'withStranger(3)'),
  'a-list-of-records-with-a-number-among-them': ('Item[]', 'withNumber()'),
  'a-list-with-a-hole': ('number[]', '[1, , 3, , 5] as number[]'),
  'a-list-with-a-hole-over-a-prototype-that-answers': ('number[]', 'overPrototype()'),
  'an-empty-list': ('number[]', '[]'),
  'a-list-with-a-text-among-the-numbers': ('number[]', '[1, 2, "three", 4] as any'),
  'a-list-with-an-accessor': ('number[]', 'withAccessor()'),
  'a-set': ('number[]', 'new Set([7, 8, 9]) as any'),
  'a-generator': ('number[]', 'counting() as any'),
  'an-iterator-with-return': ('number[]', 'closable() as any'),
  'a-list-whose-iterator-is-its-own': ('number[]', 'withOwnIterator()'),
  'arguments': ('number[]', 'asArguments(4, 5, 6) as any'),
  'a-text': ('number[]', '"a\\u{1F600}b" as any'),
}
turns = {
  'sums': 'total += weigh(x);',
  'sums-and-counts': 'total += weigh(x); count++;',
  'reads-a-field': 'total += (x as unknown as Item).weight; count++;',
  'reads-two-fields': 'total += (x as unknown as Item).weight; count += String((x as unknown as Item).name).length;',
  'appends-to-the-list-it-steps': 'total += weigh(x); if (count++ < 2 && Array.isArray(what)) what.push(10 + count);',
  'shortens-the-list-it-steps': 'total += weigh(x); if (count++ === 1 && Array.isArray(what)) what.length = Math.min(what.length, 3);',
  'stores-into-the-list-it-steps': 'total += weigh(x); if (Array.isArray(what) && count + 1 < what.length) (what as any)[count + 1] = 100 + count; count++;',
  'turns-the-list-into-fractions': 'total += weigh(x); if (count++ === 0 && Array.isArray(what) && what.length > 2) (what as any)[2] = 0.125;',
  'calls-what-nobody-knows': 'total += weigh(x); (globalThis as any).seen(x); count++;',
  'keeps-what-it-is-handed': 'total = x as number; count++;',
}
leaves = {
  'runs-to-the-end': '',
  'breaks': 'if (count > 2 || total > 50) break;',
  'returns': 'if (count > 2 || total > 50) return "early " + total + " " + count;',
  'throws': 'if (count > 2 || total > 50) throw new Error("thrown " + total + " " + count);',
  'continues': 'if (total % 2) continue; total += 1;',
}
head = '''interface Item { weight: number; name: string }
const log: string[] = [];
(globalThis as any).seen = (x: unknown) => { if (log.length < 6) log.push(String(typeof x === "object" && x ? (x as Item).weight : x)); };
function items(): Item[] { return [{ weight: 2, name: "a" }, { weight: 3.5, name: "b" }, { weight: 7, name: "c" }, { weight: 11, name: "d" }]; }
function withStranger(at: number): Item[] { const list = items(); list[at] = JSON.parse('{"name":"zz","extra":1,"weight":5}'); return list; }
function withNumber(): Item[] { const list: any[] = items(); list[1] = 6; return list; }
function overPrototype(): number[] { const list = [1, , 3] as number[]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { get() { log.push("asked above"); return 20; } } })); return list; }
function withAccessor(): number[] { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { log.push("accessor"); return 40; } }); return list; }
function* counting() { try { yield 1; yield 2; yield 3; yield 4; yield 5; } finally { log.push("generator closed"); } }
function closable() { let n = 0; return { [Symbol.iterator]() { return this; }, next() { return n < 6 ? { done: false, value: ++n } : { done: true, value: undefined }; }, return() { log.push("return called"); return {}; } }; }
function withOwnIterator(): number[] { const list = [1, 2, 3]; (list as any)[Symbol.iterator] = function* () { log.push("own iterator"); yield 5; yield 6; }; return list; }
function asArguments(..._: number[]) { return (function () { return arguments; }).apply(null, _ as any); }
function weigh(x: unknown): number { return typeof x === "number" ? x : typeof x === "object" && x ? (x as Item).weight : typeof x === "string" ? x.length : x === undefined ? 1000 : 0; }
'''
count = 0
for (whatName, (written, made)), (turnName, turn), (leaveName, leave) in itertools.product(iterated.items(), turns.items(), leaves.items()):
    text = f'// a loop over {whatName} {turnName} and {leaveName}\n'.replace('-', ' ') + head
    text += f'function run(what: {written}): string {{\n  let total = 0, count = 0;\n  for (const x of what) {{\n    {turn}\n    {leave}\n  }}\n  return total + " " + count;\n}}\n'
    text += '(globalThis as any).kept = run;\n'
    text += 'function once(what: any): string { try { return run(what); } catch (error) { return "caught " + (error as Error).message; } }\n'
    plain = 'items()' if written == 'Item[]' else '[1, 2, 3, 4, 5]'
    text += f'let warm = "";\nfor (let i = 0; i < 40; i++) warm = once({plain});\nlog.length = 0;\n'
    text += f'console.log(warm, "|", once({made}), "|", once({made}), "|", once({plain}), "|", log.join(","));\n'
    open(os.path.join(folder, f'{whatName}-{turnName}-{leaveName}.ts'), 'w').write(text); count += 1

# NESTS: WHERE THE LIST COMES FROM x WHETHER ITS NUMBERS ARE IN SIGHT x WHAT THE INNER LOOP STEPS x WHAT A TURN DOES x HOW THE INNER LOOP IS LEFT.
# A list that nobody else has, a list that stays as made and a list of which nothing is known go different ways, and so does a list whose elements come out of code that the build does not see.
sources = {
  'a-parameter': ('values: number[]', '', '{0}'),
  'a-rest-parameter': ('...values: number[]', '', '...{0}'),
  'a-constant-of-the-module': ('', 'const values = constant;', ''),
  'a-list-out-of-a-call': ('', 'const values = made();', ''),
  'a-field': ('holder: { values: number[] }', 'const values = holder.values;', '{{ values: {0} }}'),
}
numbers = {
  'numbers-in-sight': '',
  'numbers-out-of-sight': 'give',
}
inside = {
  'the-same-list': 'values',
  'another-list': 'others',
  'no-loop': '',
}
turnsOfNests = {
  'counts': 'pairs++;',
  'keeps-what-the-inner-loop-is-handed': 'last = b; pairs++;',
  'keeps-what-the-outer-loop-is-handed': 'last = a; pairs++;',
  'sums-products': 'last += a * b; pairs++;',
}
leavesOfNests = {
  'runs-to-the-end': '',
  'breaks': 'if (a + b > limit) break;',
  'continues-the-outer-loop': 'if (a + b > limit) continue outer;',
  'breaks-the-outer-loop': 'if (a + b > limit) break outer;',
  'returns': 'if (a === b && a > limit - 3) return "early " + pairs + " " + last;',
  'throws': 'if (a + b > limit + 2) throw new RangeError("over " + (a + b));',
  'continues-the-outer-loop-or-returns': 'if (a + b > limit) continue outer; if (a === b && a > 2) return "early " + -pairs;',
}
headOfNests = '''const zero = Number(process.env.NOBODY_SETS_THIS ?? 0);
(globalThis as any).give = (x: number) => x;
const give: (x: number) => number = (globalThis as any).give;
const constant: number[] = [N(1), N(2), N(3), N(4.5)];
const others: number[] = [N(2), N(0.5), N(3)];
function made(): number[] { return [N(1 + zero), N(2), N(3), N(4.5)]; }
'''
for (sourceName, (parameter, local, argument)), (numbersName, wrap), (insideName, stepped), (turnName, turn), (leaveName, leave) in itertools.product(sources.items(), numbers.items(), inside.items(), turnsOfNests.items(), leavesOfNests.items()):
    text = f'// a loop over {sourceName} of {numbersName} around {insideName} {turnName} and {leaveName}\n'.replace('-', ' ') + headOfNests
    turnsInside = f'for (const b of {stepped}) {{\n      {leave}\n      {turn}\n    }}' if stepped else f'const b = a;\n    {leave}\n    {turn}'
    text += f'function run(limit: number{", " if parameter else ""}{parameter}): string {{\n  let pairs = 0, last = -1;\n  {local}\n  outer: for (const a of values) {{\n    {turnsInside}\n  }}\n  return pairs + " " + last;\n}}\n'
    text += '(globalThis as any).kept = run;\n'
    handed = lambda list: (", " if argument else "") + argument.format(list)
    text += f'function once(limit: number, list: any): string {{ try {{ return run(limit{handed("list")}); }} catch (error) {{ return "caught " + (error as Error).message; }} }}\n'
    text += 'const said: string[] = [];\nfor (let round = 0; round < 12; round++) for (const limit of [0, 1, 2, 5, 9]) { const now = once(limit + zero, [N(1), N(2), N(3), N(4.5)]); if (round === 11) said.push(now); }\n'
    text += 'for (const odd of [[], [3], [1, , 3], [1, "2", 3], [0.5, 2n], new Set([2, 3]), "ab"]) said.push(once(5, odd));\nconstant[1] = 0.25; others.push(7);\nsaid.push(once(5, [4, 4]));\nconsole.log(said.join(" | "));\n'
    open(os.path.join(folder, f'nest-over-{sourceName}-of-{numbersName}-around-{insideName}-{turnName}-{leaveName}.ts'), 'w').write(text.replace('N(', wrap + '(')); count += 1
print(count)
