#!/usr/bin/env python3
# The bodies of slow versions. It stands beside slow-version-calls.py.
# WHY: slow versions are written by the Straight emitter: no register allocator, no liveness, no checker behind it. One fault there: a value that waits in the result register for a reader that gets no code.
# No other test enters a slow version.
# THE SHAPE: function probe(tag: Tag, value, other), declared inside a function, with a loop over tag.n | tag.m at its head. It runs 300 times with an object of the class (the fast version), then with an object that is
# NOT of the class and comes out of unseen code (the parameter guard fails: the slow version), once for each of twelve values. THE BODY HOLDS NO BUILT-IN: a slow version that names one is walked, not written straight.
#   grid:   one operation whose answer is held in a local (a comparison, a type test, a read, a call ..) x what stands between (nothing, `held = null`, `held = undefined`, a closure nobody reads ..) x the next operation
#           (every kind: variables, type tests, reads and stores by name and by key, operators, texts, literals, closures, calls with whole numbers and fractions, branches, loops, switches, handlers, patterns).
#   rows:   rows of four to nine such statements over four locals, drawn by a fixed seed.
# Each program holds some 24 probes and is built alone; the reference is `bun <file>`.
# usage: slow-version-bodies.py <bun> <folder to work in> [jobs] [more flags for the build ..]
import os, random, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
bun, work = sys.argv[1], sys.argv[2]
jobs = int(sys.argv[3]) if len(sys.argv) > 3 else 16
more = sys.argv[4:]

HELD = ['tag.n < work', 'tag.n === work', 'tag.m >= work', '"n" in tag', 'tag instanceof Tag', 'typeof value === "string"', 'typeof value === "number"', '!value', 'value == null', 'tag.n', 'tag.n + 0.5', 'value', 'shown',
        'tag.n + "x"', '[tag.n]', '{ a: tag.n }', 'pick(0.25, tag.n)', 'other.p', 'typeof value', 'unit.size']
BETWEEN = ['', 'held = null;', 'held = undefined;', 'const nobody = () => held;', 'if (work > 99) held = 1;']
NEXT = ['shown', 'text', 'counter', '(counter = work)', 'counter++', 'typeof value === "number"', 'typeof value === "string"', 'typeof value === "boolean"', 'typeof value === "undefined"', 'typeof value === "object"',
        'typeof value === "function"', 'typeof value === "symbol"', 'typeof value === "bigint"', 'typeof value', 'value === null', 'value == null', 'value === undefined', '!value', '!!value', 'value ? 1 : 2', 'value ?? 7',
        'value || 7', 'value && 7', 'tag.n', 'tag.m', '(tag as any).missing', 'other.p', 'other.q', 'other[0]', 'other["p"]', 'other[key]', '(other.p = work)', '(other[0] = work)', '(other[key] = work)', 'delete other.gone',
        '"p" in other', 'key in other', 'other instanceof Tag', 'tag instanceof Tag', 'work + 1', 'work + 0.5', 'work * value', 'value + 1', 'value + "s"', '`<${value === sym ? "sym" : value}>`', '`${work}|${tag.n}`',
        'value < 3', 'value <= work', 'value === work', 'value == work', 'value === sym || value === big ? 0 : value | 0', 'value === sym || value === big ? 0 : value >>> 0', 'value === sym ? 0 : -value',
        'value === sym || value === big ? 0 : +value', 'value === sym ? 0 : ~value', 'value === sym || value === big ? 0 : value % 3', 'value === sym || value === big ? 0 : value / 2', '[work, value]', '{ a: work, b: value }',
        '(() => value)()', '(function () { return work; })()', 'pick(work, 0.25)', 'pick(0.25, work)', 'pick(0.25, unit.size)', 'mixed(0.5, unit.size, value)', 'mixed(half.size, work, held)', 'callee(value)', 'other.method(work)',
        'other.method?.(work)', 'other?.p', 'other?.[0]', 'value?.length', 'void value', '(work, value)', 'unit.size', 'half.size', 'unit.size + half.size', 'held', 'held === null', 'typeof held', 'held ?? value']
STATEMENTS = ['for (let i = 0; i < 3; i++) next += i;', 'for (let i = 0; i < 3; i++) { const was = next; next = work + i; work = was | 0; }', 'switch (value) { case 1: next = "one"; break; case "text": next = "t"; break; default: next = "d"; }',
              'switch (work & 3) { case 0: next = shown; break; case 1: next = text; break; case 2: next = value; break; default: next = held; }', 'try { if (value === 7) throw value; next = 1; } catch (e) { next = [e]; }',
              'try { next = other.p; } finally { counter = work; }', 'try { next = value.deep.deeper; } catch (e) { next = "caught"; }', 'if (value) next = shown; else next = text;', 'if (typeof value === "number") next = value + 1; else if (typeof value === "string") next = value + "!";',
              'const { p, q } = other; next = [p, q];', 'let a: any = work, b: any = value; for (let i = 0; i < 3; i++) { const t = a; a = b; b = t; } next = [a, b];', 'let a: any = shown, b: any = text; a = null; next = b; b = undefined;',
              'while (next < 3) { next++; if (value === next) break; }', 'do { next += 2; } while (next < work);', 'next = value; next = null; next = counter;', 'const first = tag.n < work, second = tag.m < work; next = shown; next = [first, second, next];',
              'label: for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { if (j === work) continue label; next += i * 2 + j; }']
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
programs = [('bodies-%04d' % (at // PER), bodies[at:at + PER]) for at in range(0, len(bodies), PER)]

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
print('slow-version-bodies: %d probes in %d programs, each built alone%s: %s' % (len(bodies), len(programs), ' with ' + ' '.join(more) if more else '', ' . '.join('%s %d' % (k, v) for k, v in sorted(count.items()))))
