#!/usr/bin/env python3
# The sibling of slow-version-bodies.py: the bodies of slow versions that name a built-in: those are walked (walk/AOTCompileUnit.cpp: a SlowBody that holds a Builtin operation), not written
# straight: another road that nothing had entered either. The same probes, and in each body the next operation is a call of a built-in (texts, lists, Math, JSON, Object, Map | Set, views, RegExp, Number, Symbol).
# WHY: slow versions are written by the Straight emitter: no register allocator, no liveness, no checker behind it. One fault there: a value that waits in the result register for a reader that gets no code.
# No other test enters a slow version.
# THE SHAPE: function probe(tag: Tag, value, other), declared inside a function, with a loop over tag.n | tag.m at its head. It runs 300 times with an object of the class (the fast version), then with an object that is
# NOT of the class and comes out of unseen code (the parameter guard fails: the slow version), once for each of twelve values. THE BODY HOLDS NO BUILT-IN: a slow version that names one is walked, not written straight.
#   grid:   one operation whose answer is held in a local (a comparison, a type test, a read, a call ..) x what stands between (nothing, `held = null`, `held = undefined`, a closure nobody reads ..) x the next operation
#           (every kind: variables, type tests, reads and stores by name and by key, operators, texts, literals, closures, calls with whole numbers and fractions, branches, loops, switches, handlers, patterns).
#   rows:   rows of four to nine such statements over four locals, drawn by a fixed seed.
# Each program holds some 24 probes and is built alone; the reference is `bun <file>`.
# usage: slow-version-bodies-walked.py <bun> <folder to work in> [jobs] [more flags for the build ..]
import os, random, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
bun, work = sys.argv[1], sys.argv[2]
jobs = int(sys.argv[3]) if len(sys.argv) > 3 else 16
more = sys.argv[4:]

HELD = ['tag.n < work', 'tag.n === work', 'tag.m >= work', '"n" in tag', 'tag instanceof Tag', 'typeof value === "string"', 'typeof value === "number"', '!value', 'value == null', 'tag.n', 'tag.n + 0.5', 'value', 'shown',
        'tag.n + "x"', '[tag.n]', '{ a: tag.n }', 'pick(0.25, tag.n)', 'other.p', 'typeof value', 'unit.size']
BETWEEN = ['', 'held = null;', 'held = undefined;', 'const nobody = () => held;', 'if (work > 99) held = 1;']
NEXT = ['String(value === sym ? "sym" : value)', 'Number(value === sym || value === big ? 0 : value)', 'Boolean(value)', 'Object.is(value, -0)', 'Object.is(held, value)', 'Number.isInteger(value)', 'Number.isNaN(value)', 'isNaN(value === sym || value === big ? 0 : value)',
        'Math.max(work, 3)', 'Math.min(work, unit.size)', 'Math.floor(half.size + work)', 'Math.abs(-work)', 'Math.imul(work, 5)', 'Math.sign(work - 6)', 'Math.trunc(work / 4)', 'Math.round(half.size)', 'Math.sqrt(work + 3)', 'Math.pow(work, 2)', 'Math.hypot(3, 4)', 'Math.clz32(work)',
        'JSON.stringify(value === big ? 0 : value)', 'JSON.stringify([work, held === big ? 0 : held])', 'JSON.stringify({ a: work })', 'JSON.parse("[1,2]")', 'Array.isArray(value)', 'Array.isArray(held)', 'Array.of(work, value)', 'Array.from([work, value])', 'new Array(3).length', '[work, 2, 1].sort()', '[3, 1, work].indexOf(work)',
        '[work, value].includes(value)', '[1, 2, 3].map((e) => e + work)', '[1, 2, 3].filter((e) => e < work)', '[1, 2, 3].reduce((p, e) => p + e, work)', '[1, 2, 3].join("-")', '[1, 2, 3].slice(1)', '[work].concat([value])', '[[work], [value]].flat()', '[1, 2, 3].at(-1)', '[1, 2].push(work)', '[work, 2].pop()',
        '[1, 2, 3].reverse()', '[1, 2, 3].some((e) => e === work)', '[1, 2, 3].every((e) => e < work)', '[1, 2, 3].find((e) => e > 1)', '[...[work, value]]', 'Object.keys(other)', 'Object.values({ a: work, b: 2 })', 'Object.entries({ a: work })', 'Object.assign({}, { a: work })', '({ ...other }).p', 'Object.freeze({ a: work }).a',
        'Object.getPrototypeOf(tag) === Tag.prototype', 'Object.create(null) === null', 'Object.hasOwn(other, "p")', 'other.hasOwnProperty("q")', 'Reflect.get(other, "p")', 'Reflect.has(other, "q")', 'Reflect.ownKeys({ a: 1, b: 2 })', 'new Map([[work, value]]).get(work)', 'new Map([[1, 2]]).size', 'new Set([work, work]).size', 'new Set([value]).has(value)',
        'text.length', 'text.charCodeAt(2)', 'text.slice(2, 6)', 'text.indexOf("some")', 'text.includes("text")', 'text.toUpperCase()', 'text.split(" ")', 'text.replace("text", "word")', 'text.replace(/e/g, "E")', 'text.startsWith("a")', 'text.padEnd(24, ".")', 'text.repeat(2).length', 'text.trim()', 'text.at(-1)', 'text.substring(1, 3)',
        'text.match(/s(o)me/)?.[1]', '/len/.test(text)', 'text.search(/of/)', 'text.localeCompare("b")', 'text.concat("!", "?")', '"x".codePointAt(0)', 'String.fromCharCode(65 + work)', 'new Uint8Array([work, 2]).length', 'new Uint8Array([work, 300])[1]', 'new Float64Array([half.size])[0]', 'new Int32Array(2).fill(work)[1]',
        'Symbol.for("k") === Symbol.for("k")', 'sym.description', 'typeof Symbol()', 'BigInt(work) + big', 'big * 2n', 'parseInt("12px")', 'parseFloat("1.5x")', '(1.005).toFixed(2)', '(255).toString(16)', 'work.toString()', 'new Date(86400000).getUTCDate()', 'Date.UTC(2020, 0, 1)', 'new Error("m").message', 'new RangeError("r").name',
        'Promise.resolve(work) instanceof Promise', 'structuredClone({ a: work }).a', 'encodeURIComponent("a b")', 'globalThis === undefined', 'Number.MAX_SAFE_INTEGER', 'Math.PI > 3', 'new Tag().n', 'new Whole().size + new Half().size', 'held', 'typeof held']
STATEMENTS = ['for (const e of [1, 2, work]) next += e;', 'for (const [k, v] of new Map([[1, work]])) next += k + v;', 'for (const k in other) next = next + k;', 'const [one, two = 5, ...others] = [work, undefined, 3, 4]; next = [one, two, others];', 'const { p, ...rest } = other; next = [p, Object.keys(rest)];',
              'try { null.x; } catch (e: any) { next = e.name; }', 'try { throw new TypeError("t"); } catch (e: any) { next = e.message; } finally { counter = work; }', 'try { JSON.parse("{"); } catch (e: any) { next = e.name; }', 'next = [1, 2, 3].map((e) => (held === null ? e : e + 1));',
              'const list: any[] = []; for (let i = 0; i < 3; i++) list.push(i + work); next = list;', 'const bag: any = {}; for (let i = 0; i < 3; i++) bag["k" + i] = work + i; next = bag;', 'let s = ""; for (let i = 0; i < 3; i++) s += String(i) + text.slice(0, 2); next = s;',
              'switch (typeof value) { case "number": next = Math.floor(value); break; case "string": next = value.length; break; default: next = String(typeof value); }', 'next = Math.max(...[1, work, 3]);', 'next = ((...all: any[]) => all.length)(work, value, held);', 'next = `${String(work)}:${[1, 2].join()}`;']
VALUES = '"text", 7, 0, -0, 1.5, null, undefined, true, false, "", sym, big'
HEAD = '''class Whole { size = 3; }
class Half { size = 0.5; }
type Piece = Whole | Half;
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const unit = new Whole(), half = new Half();
function sizeOf(piece: Piece): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return piece.size * 2 + work; }
const shown: any = unseen(5), text: any = unseen("a text of some length"), key: any = unseen("p"), sym: any = Symbol.iterator, big: any = unseen(10n);
let counter: any = 0;
function show(x: any, depth = 0): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "symbol") return "sym";
  if (typeof x === "function") return "fn";
  if (typeof x === "string") return JSON.stringify(x);
  if (x === null || typeof x !== "object") return String(x);
  if (depth > 2) return "..";
  return Array.isArray(x) ? "[" + x.map((e) => show(e, depth + 1)).join() + "]" : "{" + Object.keys(x).map((k) => k + ":" + show(x[k], depth + 1)).join() + "}";
}
const makeOther = (): any => unseen({ p: 11, q: "q", 0: "zero", gone: 1, method(v: number) { return v + 1; } });
'''
INNER = '''  function pick(ratio: number, steps: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return ratio * 100 + steps + work; }
  function mixed(ratio: number, steps: number, any: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [ratio, steps, any, work]; }
  function callee(any: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [any, work]; }
'''
LOOP = 'let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;'


def program(bodies):
    probes = ''.join('  function probe%d(tag: Tag, value: any, other: any): any { %s %s }\n' % (n, LOOP, body) for n, body in enumerate(bodies))
    calls = ''.join('''  { for (let turn = 0; turn < 300; turn++) { try { probe%(n)d(real, values[turn %% values.length], makeOther()); } catch {} }
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe%(n)d(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe%(n)d(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("%(n)d", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
''' % {'n': n} for n in range(len(bodies)))
    return HEAD + 'function main() {\n' + INNER + probes + '  const real = new Tag(), liar = unseen({ n: 1, m: 2 }), values: any[] = [' + VALUES + '].map(unseen);\n' + calls + '}\nconsole.log(sizeOf(unit), sizeOf(half));\nmain();\nexport {};\n'


bodies = []
for hi, held in enumerate(HELD):
    for bi, between in enumerate(BETWEEN):
        for ni, nxt in enumerate(NEXT):
            # The whole grid of the answers that wait as 0 | 1; of the others every third place.
            if hi >= 9 and (hi + bi + ni) % 3:
                continue
            bodies.append(('grid %d.%d.%d' % (hi, bi, ni), 'let held: any = %s; %s const next = %s; return [next, held];' % (held, between, nxt)))
        for si, statement in enumerate(STATEMENTS):
            bodies.append(('grid %d.%d.s%d' % (hi, bi, si), 'let held: any = %s; %s let next: any = 0; %s return [next, held, work];' % (held, between, statement)))
draw = random.Random(20261104)
for row in range(1200):
    lines, names = [], ['a', 'b', 'c', 'd']
    for step in range(draw.randint(4, 9)):
        target = draw.choice(names)
        kind = draw.random()
        if kind < 0.25:
            lines.append('%s = %s;' % (target, draw.choice(('null', 'undefined'))))
        elif kind < 0.5:
            lines.append('%s = %s;' % (target, draw.choice(HELD)))
        elif kind < 0.9:
            lines.append('%s = %s;' % (target, draw.choice(NEXT).replace('held', draw.choice(names))))
        else:
            lines.append('{ let next: any = 0; %s %s = next; }' % (draw.choice(STATEMENTS).replace('held', draw.choice(names)), target))
    bodies.append(('row %d' % row, 'let a: any = 0, b: any = 0, c: any = 0, d: any = 0; %s return [a, b, c, d, work];' % ' '.join(lines)))
PER = 24
programs = [('walked-%04d' % (at // PER), bodies[at:at + PER]) for at in range(0, len(bodies), PER)]

os.makedirs(work, exist_ok=True)
environment = dict(os.environ, NO_COLOR='1', BUN_ENABLE_CRASH_REPORTING='0', DO_NOT_TRACK='1', BUN_RUNTIME_TRANSPILER_CACHE_PATH='0')


def run(arguments, limit):
    try:
        done = subprocess.run(arguments, capture_output=True, timeout=limit, env=environment, cwd=work)
        return done.returncode, done.stdout.decode('utf-8', 'replace'), done.stderr.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        return 'out of time', '', ''


def judge(it):
    name, held = it
    path = os.path.join(work, name + '.ts')
    open(path, 'w').write(program([body for _, body in held]))
    plain = run([bun, path], 60)
    built = run([bun, 'build', '--compile', '--aot'] + more + [path, '--outfile', os.path.join(work, name + '.exe')], 300)
    if built[0] != 0:
        lines = [l for l in (built[1] + built[2]).split('\n') if 'AOT' in l or 'error' in l or 'panic' in l]
        return [(name, 'the whole file', 'HANGS' if built[0] == 'out of time' else 'STOPS' if plain[0] == 0 else 'neither', 'THE BUILD: exit %s | %s' % (built[0], ' / '.join(lines[:2])[:230]))]
    ours = run([os.path.join(work, name + '.exe')], 60)
    try:
        os.remove(os.path.join(work, name + '.exe'))
    except OSError:
        pass
    if plain[0] != 0:
        return [(name, 'the whole file', 'neither', 'plain ends with exit %s: the probes behind were not judged' % plain[0])]
    a, b = plain[1].split('\n'), ours[1].split('\n')
    found = []
    for n, (label, body) in enumerate(held):
        x = next((l for l in a if l.startswith('%d ' % n)), None)
        y = next((l for l in b if l.startswith('%d ' % n)), None)
        if x != y:
            found.append((name, label, 'WRONG' if y is not None else 'DIES', '%s | plain: %s | ours: %s' % (body[:150], (x or '')[:90], (y or 'nothing: exit %s' % ours[0])[:90])))
            if y is None:
                break
    if not found and (ours[0] != plain[0] or ours[1] != plain[1]):
        found.append((name, 'the whole file', 'DIES', 'exit %s | plain %s' % (ours[0], plain[0])))
    return found or [(name, '', 'same', '')]


with ThreadPoolExecutor(jobs) as pool:
    results = [line for lines in pool.map(judge, programs) for line in lines]
count = {}
for name, label, verdict, note in results:
    count[verdict] = count.get(verdict, 0) + 1
    if verdict != 'same':
        print('%s %s %s | %s' % (verdict, name, label, note))
print('slow-version-bodies-walked: %d probes in %d programs, each built alone%s: %s' % (len(bodies), len(programs), ' with ' + ' '.join(more) if more else '', ' . '.join('%s %d' % (k, v) for k, v in sorted(count.items()))))
