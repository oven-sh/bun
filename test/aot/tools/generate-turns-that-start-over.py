#!/usr/bin/env python3
# generate-turns-that-start-over.py <folder>: all 588; ../parallel/turns-that-start-over/ holds 51 of them.
# A TURN STARTS OVER: in the typed copy of a loop the failing side of a test leaves for the other copy, which does the whole turn again from what the head held. ITS FAILURE IS AN EFFECT DONE TWICE OR NOT AT ALL,
# and no check at run time sees that: every printed line bears a count that a repeated or a lost effect changes.
# ONE SHAPE A PROGRAM, each built alone:
#   effect-<name>-before | -behind    one effect in the turn, in front of the failing test or behind it (the effects are those of make-start-over-programs.py, fitted to a loop)
#   ..-in-a-loop-over-a-view          the same in a loop that is built twice whatever its turns do
#   <loop>-<misfit>-in-turn-<n>       no effect: eight forms of loops x seven misfits x the first, a middle and the last turn: there the way out is built, which shows that the shape is alive
import os, sys
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

CLASSES = '''class Links { kind: number; constructor(kind: number) { this.kind = kind; } }
class Sym { flags: number; links: Links; constructor(flags: number, links: Links) { this.flags = flags; this.links = links; } }'''
SPOILED = '''function spoiled(kind: number) { const links = new Links(kind); (links as any).kind = "k" + kind; return links; }'''

# name: (what happens, prelude, the effect, what the answer bears of it, what is printed behind each call, lines at the end)
EFFECTS = {
    'a-static-field-is-counted-up': ('a static field of a class is counted up', 'class Tally { static n = 0; }', 'Tally.n++;', '', 'Tally.n', ''),
    'a-field-of-an-object-of-the-module-is-counted-up': ('a field of an object that a variable of the module holds is counted up by a typed store', 'const tally = new Sym(0, new Links(0));', 'tally.flags = tally.flags + 1;', '', 'tally.flags', ''),
    'a-field-of-the-element-itself-is-counted-up': ('a field of the very element that the turn reads is counted up', '', 's.flags = s.flags + 1;', '', '0', ''),
    'an-element-of-a-list-is-counted-up': ('an element of a list of the module is counted up', 'const cells = [0, 0];', 'cells[1] = cells[1] + 1;', '', 'cells[1]', ''),
    'an-element-of-a-typed-array-is-counted-up': ('an element of an Int32Array of the module is counted up', 'const words = new Int32Array(2);', 'words[1]++;', '', 'words[1]', ''),
    'a-variable-of-the-module-is-counted-up': ('a variable of the module that a function reads is counted up', 'let count = 0;\nfunction counted() { return count; }', 'count++;', '', 'counted()', ''),
    'a-variable-that-a-closure-holds-is-counted-up': ('a variable of the function that a closure holds is counted up', 'let peek: () => number = () => -1;', 'inner++;', '', 'peek()', '', 'let inner = 0; peek = () => inner;'),
    'a-push': ('a number is pushed onto a list of the module', 'const pushed: number[] = [];', 'pushed.push(s.flags);', '', 'pushed.length', ''),
    'a-pop': ('a number is taken off a list of the module', 'const stock: number[] = [];\nfor (let i = 0; i < 400; i++) stock.push(i);', 'const taken = stock.pop();', ' + "," + taken', 'stock.length', ''),
    'the-length-of-a-list-is-set': ('the length of a list of the module grows by one', 'const grown: number[] = [];', 'grown.length = grown.length + 1;', '', 'grown.length', ''),
    'a-map-set': ('a Map of the module is given an entry under its size', 'const seen = new Map<number, number>();', 'seen.set(seen.size, s.flags);', '', 'seen.size', ''),
    'a-set-add': ('a Set of the module is given its size', 'const all = new Set<number>();', 'all.add(all.size);', '', 'all.size', ''),
    'a-console-log': ('a line is printed', '', 'console.log("in", s.flags);', '', '0', ''),
    'a-getter-of-a-class-that-counts': ('a getter of a class that the compiler knows counts', 'class Meter { n = 0; get next() { return ++this.n; } }\nconst meter = new Meter();', 'const t = meter.next;', ' + "," + t', 'meter.n', ''),
    'a-setter-of-a-class-that-counts': ('a setter of a class that the compiler knows counts', 'class Meter { n = 0; set put(by: number) { this.n += by; } }\nconst meter = new Meter();', 'meter.put = 1;', '', 'meter.n', ''),
    'a-private-name-is-counted-up': ('a field under a private name of an object of the module is counted up', 'class Box { #n = 0; bump() { this.#n++; } get n() { return this.#n; } }\nconst box = new Box();', 'box.bump();', '', 'box.n', ''),
    'a-constructor-that-counts': ('an object is made whose constructor counts', 'let made = 0;\nclass Made { id: number; constructor() { this.id = ++made; } }', 'const m = new Made();', ' + "," + m.id', 'made', ''),
    'a-constructor-that-registers-this': ('an object is made whose constructor pushes it onto a list of the module', 'const registered: Reg[] = [];\nclass Reg { a = 1; constructor() { registered.push(this); } }', 'const r = new Reg();', ' + "," + (registered[registered.length - 1] === r)', 'registered.length', ''),
    'an-iterator-of-a-list-is-advanced': ('an iterator over a list, which a variable of the module holds, is advanced', 'const numbers: number[] = [];\nfor (let i = 0; i < 400; i++) numbers.push(i);\nconst steps = numbers.values();', 'const step = steps.next().value;', ' + "," + step', '0', ''),
    'a-generator-is-resumed': ('a generator that a variable of the module holds is resumed', 'function* upwards() { for (let n = 0; ; n++) yield n; }\nconst running = upwards();', 'const step = running.next().value;', ' + "," + step', '0', ''),
    'a-regular-expression-moves-its-last-index': ('a global regular expression of the module is tested, which moves its lastIndex', 'const every = /a/g;\nconst text = "a".repeat(600);', 'every.test(text);', '', 'every.lastIndex', ''),
    'a-copied-callee-that-counts': ('a short callee, which is copied, counts', 'let count = 0;\nfunction bump() { count++; }', 'bump();', '', 'count', ''),
    'a-called-callee-that-counts': ('a callee that calls itself, and so is called and not copied, counts', 'let count = 0;\nfunction bump(depth: number): number { if (depth > 0) return bump(depth - 1) + 1; count++; return 0; }', 'bump(2);', '', 'count', ''),
    'a-method-of-which-nothing-is-known': ('a method of an object of which nothing is known counts', 'let count = 0;\nconst loosely: any = JSON.parse("{}");\nloosely.bump = function () { count++; };', 'loosely.bump();', '', 'count', ''),
    'a-to-string-in-an-operator': ('an operator runs a toString() that counts', 'let count = 0;\nconst texty: any = { toString() { count++; return "t"; } };', 'const t = "" + texty;', ' + "," + t', 'count', ''),
    'a-value-of-in-an-operator': ('an operator runs a valueOf() that counts', 'let count = 0;\nconst numbery: any = { valueOf() { count++; return 5; } };', 'const t = numbery * 2;', ' + "," + t', 'count', ''),
    'a-property-of-the-global-object': ('a property of the global object is counted up', '(globalThis as any).tally = 0;', '(globalThis as any).tally++;', '', '(globalThis as any).tally', ''),
    'a-store-under-a-computed-key': ('a property under a key that is computed is counted up', 'const key = "n" + (Date.now() > 0 ? "" : "x");\nconst record: Record<string, number> = { n: 0 };', 'record[key] = record[key] + 1;', '', 'record.n', ''),
    'a-define-property': ('Object.defineProperty() counts a property up', 'const record = { n: 0 };', 'Object.defineProperty(record, "n", { value: record.n + 1, writable: true, configurable: true, enumerable: true });', '', 'record.n', ''),
    'a-reflect-set': ('Reflect.set() counts a property up', 'const record = { n: 0 };', 'Reflect.set(record, "n", record.n + 1);', '', 'record.n', ''),
    'an-atomics-add': ('Atomics.add() counts a word of shared memory up', 'const shared = new Int32Array(new SharedArrayBuffer(8));', 'Atomics.add(shared, 0, 1);', '', 'shared[0]', ''),
    'a-data-view-store': ('a DataView of the module counts a word up', 'const view = new DataView(new ArrayBuffer(8));', 'view.setInt32(0, view.getInt32(0) + 1);', '', 'view.getInt32(0)', ''),
    'a-text-of-the-module-grows': ('a text that a variable of the module holds grows by one letter', 'let log = "";\nfunction logged() { return log.length; }', 'log += "x";', '', 'logged()', ''),
    'a-text-of-the-function-grows': ('a text of the function grows by one letter', '', 'letters += "x";', ' + "," + letters.length', '0', '', 'let letters = "";'),
    'a-microtask-is-queued': ('a job is queued that counts when it runs', 'let ran = 0;', 'queueMicrotask(() => { ran++; });', '', '0', 'setTimeout(() => console.log("ran", ran), 0);'),
    'a-reaction-to-a-promise': ('a reaction that counts is hung on a promise', 'let ran = 0;\nconst settled = Promise.resolve(1);', 'settled.then(() => { ran++; });', '', '0', 'setTimeout(() => console.log("ran", ran), 0);'),
    'a-timer-is-set': ('a timer is set whose function counts', 'let ran = 0;', 'setTimeout(() => { ran++; }, 0);', '', '0', 'setTimeout(() => console.log("ran", ran), 30);'),
    'a-closure-of-the-turn-is-kept': ('a closure over a variable of the turn is pushed onto a list of the module', 'const kept: (() => number)[] = [];', 'const own = s.flags; kept.push(() => own);', '', 'kept.length + ":" + (kept.length ? kept[kept.length - 1]() : -1)', ''),
    'a-second-sum-is-added-to': ('a second sum of the function is added to', '', 'second += 1;', ' + "," + second', '0', '', 'let second = 0;'),
}


def write(name, lines):
    open(os.path.join(OUT, name + '.ts'), 'w').write('\n'.join(lines) + '\n')


def drive(seen, end, size=7):
    lines = [
        f'function clean() {{ const list: Sym[] = []; for (let i = 0; i < {size}; i++) list.push(new Sym(i, new Links(i * 2))); return list; }}',
        f'function look(list: Sym[]) {{ let answer: unknown; try {{ answer = run(list); }} catch (error) {{ answer = (error as Error).name; }} console.log(String(answer), {seen}); }}',
        'const plain = clean();',
        'for (let i = 0; i < 3; i++) look(plain);',
        f'for (const at of [0, {size // 2}, {size - 1}]) {{ const list = clean(); list[at] = new Sym(at, spoiled(at)); look(list); look(list); }}',
        # What the compiler has not seen made: the test of its shape fails, and the answer is that of the class's own object.
        f'for (const at of [0, {size // 2}, {size - 1}]) {{ const list = clean(); list[at] = JSON.parse(`{{"flags":${{at}},"links":{{"kind":${{at * 2}}}}}}`); look(list); look(list); }}',
        'look(plain);',
    ]
    if end:
        lines.append(end)
    return lines


for name, row in EFFECTS.items():
    what, prelude, effect, tail, seen, end = row[:6]
    inFront = row[6] if len(row) > 6 else ''
    for place in ('before', 'behind'):
        turn = f'{effect} total += s.links.kind;' if place == 'before' else f'total += s.links.kind; {effect}'
        # What an effect defines in the turn is read at the end of the turn, so the last turn's is what the answer bears.
        bears = ''
        if tail and not inFront:
            turn += f' last = ""{tail};'
            bears = ' + last'
        elif tail:
            bears = tail
        lines = [f'// {"in front of" if place == "before" else "behind"} the test that fails in a turn {what}: once a turn, whichever copy of the loop does the turn', CLASSES]
        if prelude:
            lines.append(prelude)
        lines += [SPOILED,
                  f'function run(list: Sym[]) {{ let total = 0; let last = ""; {inFront} for (let i = 0; i < list.length; i++) {{ const s = list[i]; {turn} }} return total{bears}; }}']
        write(f'effect-{name}-{place}', lines + drive(seen, end))
        # The loop is built twice whatever its turns do: the length of a view is asked at the head of the typed copy. So the way out is at hand behind the effect too, and only the walk's own mark keeps the turn from starting over.
        lines[-1] = f'const seven = new Uint8Array(7);\nfunction run(list: Sym[], bytes: Uint8Array = seven) {{ let total = 0; let last = ""; {inFront} for (let i = 0; i < bytes.length; i++) {{ const s = list[i]; {turn} }} return total{bears}; }}'
        write(f'effect-{name}-{place}-in-a-loop-over-a-view', lines + drive(seen, end))

LOOPS = {
    'a-sum': 'let total = 0; for (let i = 0; i < list.length; i++) total += list[i].links.kind; return total;',
    'a-product-and-a-sum': 'let total = 0; for (let i = 0; i < list.length; i++) total += list[i].flags * list[i].links.kind; return total;',
    'a-while': 'let total = 0; let i = 0; while (i < list.length) { total += list[i].links.kind; i++; } return total;',
    'downward': 'let total = 0; for (let i = list.length - 1; i >= 0; i--) total = total * 3 + list[i].links.kind; return total;',
    'two-sums': 'let even = 0; let odd = 0; for (let i = 0; i < list.length; i++) { if (i & 1) odd += list[i].links.kind; else even += list[i].links.kind; } return even + ":" + odd;',
    'left-early': 'let total = 0; for (let i = 0; i < list.length; i++) { const kind = list[i].links.kind; if (kind > 9) break; total += kind; } return total;',
    'turns-passed-over': 'let total = 0; for (let i = 0; i < list.length; i++) { if (list[i].flags === 2) continue; total += list[i].links.kind; } return total;',
    'a-loop-in-a-loop': 'let total = 0; for (let round = 0; round < 3; round++) for (let i = 0; i < list.length; i++) total += list[i].links.kind + round; return total;',
    'under-a-handler': 'let total = 0; for (let i = 0; i < list.length; i++) { try { total += list[i].links.kind; } catch (error) { total -= 100; } } return total;',
    'a-for-of': 'let total = 0; for (const s of list) total += s.links.kind; return total;',
    'a-greatest': 'let greatest = -1; for (let i = 0; i < list.length; i++) { const kind = list[i].links.kind; if (kind > greatest) greatest = kind; } return greatest;',
    'a-chain': 'let total = 0; for (let i = 0; i + 1 < list.length; i++) total += list[i].links.kind - list[i + 1].links.kind * 2; return total;',
}
MISFITS = {
    'a-text-in-a-field-of-numbers': ('a field that is written as a number holds a text', 'list[at] = new Sym(at, spoiled(at));'),
    'a-big-integer-in-a-field-of-numbers': ('a field that is written as a number holds a big integer', 'const links = new Links(at); (links as any).kind = 5n; list[at] = new Sym(at, links);'),
    'an-object-with-a-value-of': ('a field that is written as a number holds an object whose valueOf() counts', 'const links = new Links(at); (links as any).kind = { valueOf() { calls++; return 4; } }; list[at] = new Sym(at, links);'),
    'a-literal-with-the-same-members': ('an element is a literal with the members of the class', 'list[at] = { flags: at, links: { kind: at + 50 } } as Sym;'),
    'a-field-that-was-deleted': ('a field of an element was deleted', 'const links = new Links(at); delete (links as any).kind; list[at] = new Sym(at, links);'),
    'an-accessor-in-the-place-of-a-field': ('an accessor that counts stands in the place of a field', 'const links = new Links(at); Object.defineProperty(links, "kind", { get() { calls++; return at + 70; }, configurable: true }); list[at] = new Sym(at, links);'),
    'nothing-in-the-place-of-an-element': ('an element is undefined', '(list as any)[at] = undefined;'),
    'a-hole': ('an element was deleted', 'delete (list as any)[at];'),
    'an-object-out-of-json': ('an element was parsed out of a text', 'list[at] = JSON.parse(`{"flags":${at},"links":{"kind":${at + 20}}}`);'),
    'links-out-of-json': ('what a field of an element holds was parsed out of a text', 'list[at] = new Sym(at, JSON.parse(`{"kind":${at + 20}}`));'),
    'a-text-out-of-json-in-a-field-of-numbers': ('a field that is written as a number holds a text that was parsed', 'list[at] = new Sym(at, JSON.parse(`{"kind":"k${at}"}`));'),
    'a-proxy': ('an element is a Proxy that counts its reads', 'list[at] = new Proxy(new Sym(at, new Links(at + 30)), { get(target, key, receiver) { calls++; return Reflect.get(target, key, receiver); } });'),
}
for loop, body in LOOPS.items():
    for misfit, (what, spoil) in MISFITS.items():
        for at in (0, 3, 6):
            lines = [f'// {loop.replace("-", " ")}: {what}, in turn {at}', CLASSES, SPOILED, 'let calls = 0;',
                     f'function run(list: Sym[]) {{ {body} }}',
                     'function clean() { const list: Sym[] = []; for (let i = 0; i < 7; i++) list.push(new Sym(i, new Links(i * 2))); return list; }',
                     'function look(list: Sym[]) { let answer: unknown; try { answer = run(list); } catch (error) { answer = (error as Error).name; } console.log(String(answer), calls); }',
                     'const plain = clean();',
                     'for (let i = 0; i < 3; i++) look(plain);',
                     f'{{ const at = {at}; const list = clean(); {spoil} look(list); look(list); }}',
                     'look(plain);']
            write(f'{loop}-{misfit}-in-turn-{at}', lines)
print(len(os.listdir(OUT)), 'programs')
