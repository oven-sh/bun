#!/usr/bin/env python3
"""generate-accessors-run-behind-looks-in-loops.py <folder>: writes the programs of parallel/accessors-run-behind-looks-in-loops. The same bytes every time.
`o.f`, `o.f = v` in a loop that may get a typed copy, where `f` is an accessor above an object that is out of sight: behind a look at the cell and the guard of the name the half is run, as a copy or by a call.
One shape a program, each printing primitives. What differs: what the half does (it only reads, writes a variable, a field, the list that the loop reads, throws, calls unseen code, lays something in its own place), where the accessor stands, what the loop does around the access.
Each program twice: <name>: a value is hidden by a read out of a list under a key that nobody reads, and the build stays closed . <name>-with-eval: it is hidden by a function out of eval, which puts the whole build into the open regime."""
import os, re, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

HEAD = '''let calls = 0;
let other = 0;
%(front)s
class Pair { a: number; constructor(a: number) { this.a = a; } }
%(unseen)s
const pairs = [new Pair(1), new Pair(2)];
function run(o: any, n: number, list: Pair[], depth: number): number {
  if (depth > 0) return run(o, n, list, depth - 1);
  let last = 0;
  let sum = 0;
%(loop)s
  return last + sum;
}
const first = %(made)s;
%(kept)s
let total = 0;
for (let r = 0; r < 300; r++) %(call)s
console.log(total, calls, other, pairs.length, pairs[0].a, pairs[1].a);
'''

GAUGE = '''class Gauge {
  c: number;
  constructor(c: number) { this.c = c; }
%s
}'''

LOOP = '  for (let i = 0; i < n; i++) { %s const b = list[i & 1]; sum = sum + b.a; %s }'
CALL = 'total = (total + run(unseen(first), 7, pairs, r %% 3)) | 0;'.replace('%%', '%')
KEPT = '(globalThis as any).keptGauge = first;'

def program(name, members=None, front=None, access='last = o.f;', behind='calls = calls + 1;', loop=None, made='new Gauge(3)', kept=KEPT, call=CALL, extension='ts'):
  for isOpen in (False, True):
    text = HEAD % {
        'front': front if front is not None else GAUGE % members,
        'loop': loop if loop is not None else LOOP % (access, behind),
        'made': made, 'kept': kept, 'call': call,
        'unseen': 'const unseen: (x: any) => any = (0, eval)("(x) => x");' if isOpen else 'const unseen = (x: any) => [x][JSON.parse("0")];',
    }
    if extension == 'js':
        text = text.replace('c: number;\n', '').replace('(c: number)', '(c)').replace('class Pair { a: number; constructor(a: number)', 'class Pair { constructor(a)')
        text = text.replace('const unseen: (x: any) => any', 'const unseen').replace('(x: any)', '(x)').replace('(o: any, n: number, list: Pair[], depth: number): number', '(o, n, list, depth)').replace('(globalThis as any)', 'globalThis')
        text = re.sub(r'\(\): number', '()', text).replace('(v: number)', '(v)')
    with open(os.path.join(out, name + ('-with-eval' if isOpen else '') + '.' + extension), 'w') as f:
        f.write(text)

G_WRITES = '  get f(): number { calls = calls + 1; return this.c; }'
G_READS = '  get f(): number { return this.c; }'

# The getter does what is seen.
program('getter-writes-a-variable-that-the-loop-writes-too', G_WRITES)
program('getter-writes-a-variable-that-the-loop-writes-too-untyped', G_WRITES, extension='js')
program('getter-writes-a-variable-that-the-loop-only-reads', '  get f(): number { other = other + 1; return this.c; }', behind='sum = sum + other;')
program('getter-writes-a-variable-that-the-loop-never-names', '  get f(): number { other = other + 1; return this.c; }', behind='')
program('getter-writes-a-variable-read-in-front-of-it-and-behind-it', '  get f(): number { other = other + 3; return this.c; }', access='const before = other; last = o.f; sum = sum + (other - before);', behind='')
program('getter-writes-a-field-that-the-loop-reads', '  get f(): number { this.c = this.c + 1; return this.c; }', behind='sum = sum + o.c;')
program('getter-lays-another-pair-into-the-list', '  get f(): number { calls = calls + 1; pairs[calls & 1] = new Pair(calls & 7); return this.c; }', behind='')
program('getter-stores-into-the-pair-that-is-read-next', '  get f(): number { calls = calls + 1; pairs[0].a = calls & 15; pairs[1].a = calls & 3; return this.c; }', behind='')
program('getter-takes-the-field-of-a-pair-away-and-lays-it-again', '  get f(): number { calls = calls + 1; const p: any = pairs[calls & 1]; const held = p.a; delete p.a; p.a = held + 1; return this.c; }', behind='')
program('getter-lays-a-getter-over-the-field-of-a-pair', '  get f(): number { calls = calls + 1; if (calls === 900) Object.defineProperty(pairs[1], "a", { get() { other = other + 1; return 5; }, configurable: true }); return this.c; }', behind='')
program('getter-calls-unseen-code', '  get f(): number { return unseen(this.c) + unseen(calls); }')
program('getter-lays-another-getter-in-its-place', '  get f(): number { calls = calls + 1; if (calls === 700) Object.defineProperty(Gauge.prototype, "f", { get() { other = other + 1; return 11; }, configurable: true }); return this.c; }', behind='')
program('getter-lays-a-field-of-its-name-on-the-object', '  get f(): number { calls = calls + 1; if (calls === 700) Object.defineProperty(this, "f", { value: 13, writable: true, configurable: true }); return this.c; }', behind='')
program('getter-gives-the-object-another-prototype', '  get f(): number { calls = calls + 1; if (calls === 700) Object.setPrototypeOf(this, { get f() { other = other + 1; return 17; } }); return this.c; }', behind='')
program('getter-throws-in-one-turn', '  get f(): number { calls = calls + 1; if (calls % 97 === 0) throw new RangeError("turn " + calls); return this.c; }',
        call='{ try { total = (total + run(unseen(first), 7, pairs, r % 3)) | 0; } catch (error) { other = other + (error as Error).message.length; } }')
program('getter-throws-under-a-handler-in-the-loop', '  get f(): number { calls = calls + 1; if (calls % 97 === 0) throw new RangeError("turn " + calls); return this.c; }',
        loop='  for (let i = 0; i < n; i++) { try { last = o.f; } catch (error) { other = other + 1; } const b = list[i & 1]; sum = sum + b.a; }')
program('getter-has-a-loop-of-its-own', '  get f(): number { let s = 0; for (let k = 0; k < this.c; k++) { s = s + k; calls = calls + 1; } return s; }', behind='')
program('getter-reads-another-getter-that-writes', '  get g(): number { other = other + 1; return this.c; }\n  get f(): number { return this.g + 1; }', behind='sum = sum + other;')

# The getter only reads.
program('getter-only-reads-its-field', G_READS)
program('getter-only-reads-its-field-and-the-loop-writes-nothing', G_READS, behind='')
program('getter-only-reads-its-field-untyped', G_READS, extension='js')
program('getter-only-reads-a-variable-that-the-loop-writes', '  get f(): number { return calls; }')
program('getter-gives-a-constant', '  get f(): number { return 4; }', behind='')
program('getter-only-reads-and-the-object-stays-in-sight', G_READS, kept='')
program('getter-writes-and-the-object-stays-in-sight', G_WRITES, kept='')

# Setters.
S_WRITES = '  set f(v: number) { calls = calls + 1; this.c = v; }'
program('setter-writes-a-variable-that-the-loop-writes-too', S_WRITES, access='o.f = i; last = i;')
program('setter-writes-a-variable-that-the-loop-only-reads', '  set f(v: number) { other = other + 1; this.c = v; }', access='o.f = i; last = i;', behind='sum = sum + other;')
program('setter-only-stores-its-field', '  set f(v: number) { this.c = v; }', access='o.f = i; last = i;', behind='')
program('setter-only-stores-its-field-which-the-loop-reads', '  set f(v: number) { this.c = v + 1; }', access='o.f = i; last = o.c;', behind='')
program('setter-lays-another-pair-into-the-list', '  set f(v: number) { calls = calls + 1; pairs[v & 1] = new Pair(calls & 7); }', access='o.f = i; last = i;', behind='')
program('both-halves-in-one-turn', '  get f(): number { calls = calls + 1; return this.c; }\n  set f(v: number) { other = other + 1; this.c = v & 7; }', access='o.f = o.f + 1; last = o.f;', behind='sum = sum + other;')
program('setter-alone-and-the-name-is-read', '  set f(v: number) { calls = calls + 1; this.c = v; }', access='o.f = i; last = o.f === undefined ? 1 : 2;', behind='')
program('getter-alone-and-the-name-is-stored', G_WRITES, access='try { o.f = i; } catch (error) { other = other + 1; } last = o.f;', behind='')

# Where the accessor stands.
program('getter-of-the-class-above', front='class Meter {\n  c: number;\n  constructor(c: number) { this.c = c; }\n  get f(): number { calls = calls + 1; return this.c; }\n}\nclass Gauge extends Meter { d: number; constructor(c: number) { super(c); this.d = c + 1; } }')
program('getter-of-the-class-above-hidden-by-one-below', front='class Meter {\n  c: number;\n  constructor(c: number) { this.c = c; }\n  get f(): number { calls = calls + 1; return this.c; }\n}\nclass Gauge extends Meter { get f(): number { other = other + 1; return this.c + 1; } }', behind='sum = sum + other;')
program('getter-laid-by-a-descriptor-above-a-constructor-function', front='function Gauge(this: any, c: number) { this.c = c; }\nObject.defineProperty(Gauge.prototype, "f", { get: function () { calls = calls + 1; return this.c; }, set: function (v) { other = other + 1; this.c = v; }, enumerable: true, configurable: true });', made='new (Gauge as any)(3)', behind='sum = sum + calls;')
program('two-classes-arrive-with-getters-of-their-own', front='class Gauge {\n  c: number;\n  constructor(c: number) { this.c = c; }\n  get f(): number { calls = calls + 1; return this.c; }\n}\nclass Dial {\n  c: number;\n  constructor(c: number) { this.c = c; }\n  get f(): number { other = other + 1; return this.c + 2; }\n}\nconst second = new Dial(5);\n(globalThis as any).keptDial = second;',
        call='total = (total + run(unseen(r & 1 ? first : second), 7, pairs, r % 3)) | 0;', behind='sum = sum + other;')
program('something-else-arrives-in-some-calls', G_WRITES, call='total = (total + run(unseen(r % 5 === 4 ? { f: r } : first), 7, pairs, r % 3)) | 0;')
program('a-static-getter-of-the-class', front='class Gauge {\n  static c = 3;\n  static get f(): number { calls = calls + 1; return Gauge.c; }\n}', made='Gauge')

# The loops.
program('two-loops-one-behind-the-other', G_WRITES, loop='  for (let i = 0; i < n; i++) { last = o.f; const b = list[i & 1]; sum = sum + b.a; }\n  for (let j = 0; j < n; j++) { const b = list[j & 1]; sum = sum + b.a; last = last + o.f; other = other + 1; }')
program('two-loops-one-inside-the-other-getter-inside', G_WRITES, loop='  for (let i = 0; i < n; i++) { const b = list[i & 1]; for (let j = 0; j < 2; j++) { last = o.f; sum = sum + b.a; } other = other + 1; }')
program('two-loops-one-inside-the-other-getter-outside', G_WRITES, loop='  for (let i = 0; i < n; i++) { last = o.f; for (let j = 0; j < 2; j++) { const b = list[j & 1]; sum = sum + b.a; } other = other + 1; }')
program('getter-behind-the-read-out-of-the-list', G_WRITES, loop='  for (let i = 0; i < n; i++) { const b = list[i & 1]; sum = sum + b.a; last = o.f; }')
program('getter-in-the-condition-of-the-loop', '  get f(): number { calls = calls + 1; return this.c + 4; }', loop='  for (let i = 0; i < o.f; i++) { const b = list[i & 1]; sum = sum + b.a; last = i; }')
program('getter-on-one-way-through-the-turn', G_WRITES, loop='  for (let i = 0; i < n; i++) { const b = list[i & 1]; if (b.a === 2) last = o.f; sum = sum + b.a + calls; }')
program('getter-off-the-element-of-the-list', front='class Gauge {\n  c: number;\n  constructor(c: number) { this.c = c; }\n  get f(): number { calls = calls + 1; return this.c; }\n}\nconst gauges: any[] = [new Gauge(1), new Gauge(2)];\n(globalThis as any).keptGauges = gauges;',
        loop='  for (let i = 0; i < n; i++) { const g = o[i & 1]; last = g.f; const b = list[i & 1]; sum = sum + b.a + calls; }', made='gauges', kept='')
program('while-loop-left-by-what-the-getter-writes', '  get f(): number { other = other + 1; return this.c; }', loop='  const start = other;\n  while (other - start < n) { last = o.f; const b = list[other & 1]; sum = sum + b.a; }')

# The half is entered by a call: it is too long for a copy.
LONG = ' '.join('if (this.c === %d) { other = other + %d; calls = calls + 1; }' % (k + 100, k) for k in range(40))
program('getter-too-long-for-a-copy-that-writes', '  get f(): number { ' + LONG + ' calls = calls + 1; return this.c; }')
program('getter-too-long-for-a-copy-that-only-reads', '  get f(): number { let s = this.c; ' + ' '.join('if (s === %d) s = s + %d;' % (k + 100, k) for k in range(40)) + ' return s; }')
program('setter-too-long-for-a-copy-that-writes', '  set f(v: number) { ' + LONG + ' calls = calls + 1; this.c = v; }', access='o.f = i; last = i;')

# What the half is handed.
program('setter-laid-by-a-descriptor-names-a-second-parameter', front='function Gauge(this: any, c: number) { this.c = c; }\nObject.defineProperty(Gauge.prototype, "f", { get: function () { return this.c; }, set: function (v: number, w: any) { this.c = w === undefined ? v : -1; calls = calls + 1; }, enumerable: true, configurable: true });', made='new (Gauge as any)(3)', access='o.f = i; last = o.f;')
program('setter-with-a-default-is-handed-undefined', '  get f(): number { return this.c; }\n  set f(v: number = 9) { this.c = v; calls = calls + 1; }', access='o.f = i & 1 ? i : undefined; last = o.f;')
program('setter-takes-its-value-apart', '  get f(): number { return this.c; }\n  set f({ a }: Pair) { this.c = a; calls = calls + 1; }', access='o.f = list[i & 1]; last = o.f;')
program('getter-gives-texts-and-numbers', '  get f(): any { calls = calls + 1; return calls & 1 ? this.c : "t"; }', access='last = o.f === "t" ? 1 : 2;')
program('getter-never-returns', '  get f(): number { calls = calls + 1; throw new RangeError("never"); }', loop='  for (let i = 0; i < n; i++) { const b = list[i & 1]; sum = sum + b.a; try { last = o.f; } catch (error) { other = other + 1; } }')
program('getter-never-returns-and-nothing-catches-in-the-loop', '  get f(): number { throw new RangeError("never"); }',
        call='{ try { total = (total + run(unseen(first), 7, pairs, r % 3)) | 0; } catch (error) { other = other + (error as Error).message.length; } }')

# The access stands in a function that the turn copies.
program('getter-read-in-a-helper-that-the-turn-copies', G_WRITES, front=GAUGE % G_WRITES + '\nfunction level(g: any): number { return g.f + 1; }', access='last = level(o);')
program('getter-that-only-reads-read-in-a-helper-that-the-turn-copies', front=GAUGE % G_READS + '\nfunction level(g: any): number { return g.f + 1; }', access='last = level(o);')
program('setter-stored-in-a-helper-that-the-turn-copies', front=GAUGE % S_WRITES + '\nfunction lay(g: any, v: number): void { g.f = v; }', access='lay(o, i); last = i;')

# The write stands behind the read of the field, so the looks of the half all stand in front of what it does.
program('getter-writes-behind-the-read-of-its-field', '  get f(): number { const held = this.c; calls = calls + 1; return held; }')
program('getter-writes-behind-the-read-of-its-field-and-the-loop-reads-no-list', '  get f(): number { const held = this.c; calls = calls + 1; return held; }', loop='  for (let i = 0; i < n; i++) { last = o.f; sum = sum + i; }')
program('setter-stores-its-field-and-then-writes', '  set f(v: number) { this.c = v; calls = calls + 1; }', access='o.f = i; last = i;')

# Two accesses in one turn: what the first half does stands between the looks and the second.
program('getter-that-writes-is-read-twice-in-one-turn', G_WRITES, access='last = o.f + o.f;')
program('getter-that-calls-unseen-code-is-read-twice-in-one-turn', '  get f(): number { return unseen(this.c) + unseen(calls); }', access='last = o.f + o.f;')
program('getter-that-takes-its-field-away-is-read-and-then-the-field', '  get f(): number { calls = calls + 1; const held = this.c; if (calls % 5 === 0) { delete (this as any).c; other = other + 1; } else this.c = held === undefined ? 3 : held; return calls; }', access='last = o.f; sum = sum + (o.c === undefined ? 100 : o.c);')
