#!/usr/bin/env python3
"""generate-modules-that-wait-are-overtaken.py <folder>: writes the programs of parallel/modules-that-wait-are-overtaken, a folder each, entered at main.mjs. The same bytes every time.
A module that waits for one that suspends (a top-level await) is overtaken by whatever does not wait. d.mjs waits; reg.mjs, which d.mjs imports and which imports d.mjs, hands functions of d.mjs to hooks.mjs;
e.mjs, which waits for nothing, calls them in front of the body of d.mjs: a variable of d.mjs is in its dead zone, nothing is laid yet on the prototype object of its constructor function, nor on its function.
What differs: WHY d.mjs waits (it imports a member of a cycle whose root waits . a module that a site has named first . by a statement that hands names on . one level deeper), and what is read too early.
Each program twice: <name>: the build stays closed . <name>-with-eval: one eval puts the whole build into the open regime."""
import os, sys
out = sys.argv[1]

WORK = 'let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;'

# Each function of d.mjs has a hook, a setter and a caller of its own: where several functions meet, in one variable or one list, they are lost, and what is lost counts as entered from the first tick on.
NAMES = ['Late', 'Gauge', 'Mark']
HOOKS = ''.join('export let hook%(n)s = null;\nexport function set%(n)s(f) { %(w)s hook%(n)s = f; return work; }\n' % { 'n': name, 'w': WORK } for name in NAMES)
REG = 'import { setLate, setGauge, setMark } from "./hooks.mjs"; import { readLate, askGauge, askMark } from "./d.mjs"; setLate(readLate); setGauge(askGauge); setMark(askMark);\n'
E = 'import { hookLate, hookGauge, hookMark } from "./hooks.mjs";\n' + ''.join('function tell%(n)s() { %(w)s try { return String(hook%(n)s()); } catch (error) { return error.name; } }\n' % { 'n': name, 'w': WORK } for name in NAMES) + 'console.log(tellLate(), tellGauge(), tellMark());\n'
SLOW = 'await 0; export const ready = 1;\n'

def d(imports, late='5', use='late + work'):
    return imports + ''' import "./reg.mjs";
export function readLate() { %(w)s return %(use)s; }
export function askGauge() { %(w)s return new Gauge(work).read(); }
export function askMark() { %(w)s return typeof marked.mark + work; }
function Gauge(g) { %(w)s this.g = g + work; }
function marked() { %(w)s return work; }
Gauge.prototype.read = function () { %(w)s return this.g + work; };
marked.mark = function () { %(w)s return work; };
const late = %(late)s;
''' % { 'w': WORK, 'late': late, 'use': use }

def program(name, files):
    whole = { 'hooks.mjs': HOOKS, 'reg.mjs': REG, 'e.mjs': E, 'slow.mjs': SLOW, 'main.mjs': 'import "./a.mjs"; import "./d.mjs"; import "./e.mjs";\n' }
    whole.update(files)
    for isOpen in (False, True):
        folder = os.path.join(out, name + ('-with-eval' if isOpen else ''))
        os.makedirs(folder, exist_ok=True)
        for file, text in whole.items():
            if text is None:
                continue
            if isOpen and file == 'hooks.mjs':
                text = 'export const zero = (0, eval)("0");\n' + text
            with open(os.path.join(folder, file), 'w') as f:
                f.write(text)

A = 'import "./b.mjs"; import "./slow.mjs"; export const a = 1;\n'
B = 'import "./a.mjs"; export const b = 1;\n'
CYCLE = { 'a.mjs': A, 'b.mjs': B }

# d.mjs imports a member of a cycle.
program('member-of-a-cycle-whose-root-waits', { **CYCLE, 'd.mjs': d('import "./b.mjs";') })
program('root-of-the-cycle-itself', { **CYCLE, 'd.mjs': d('import "./a.mjs";') })
program('what-suspends-is-imported-first', { 'a.mjs': 'import "./slow.mjs"; import "./b.mjs"; export const a = 1;\n', 'b.mjs': B, 'd.mjs': d('import "./b.mjs";') })
program('cycle-of-three', { 'a.mjs': A, 'b.mjs': 'import "./c.mjs"; export const b = 1;\n', 'c.mjs': 'import "./a.mjs"; export const c = 1;\n', 'd.mjs': d('import "./c.mjs";') })
program('the-member-waits-and-the-root-is-imported', { 'a.mjs': 'import "./b.mjs"; export const a = 1;\n', 'b.mjs': 'import "./a.mjs"; import "./slow.mjs"; export const b = 1;\n', 'd.mjs': d('import "./a.mjs";') })
program('the-root-suspends-itself', { 'a.mjs': 'import "./b.mjs"; await 0; export const a = 1;\n', 'b.mjs': B, 'slow.mjs': None, 'd.mjs': d('import "./b.mjs";') })
program('the-other-member-is-entered-first', { **CYCLE, 'main.mjs': 'import "./b.mjs"; import "./d.mjs"; import "./e.mjs";\n', 'd.mjs': d('import "./a.mjs";') })
program('one-level-deeper', { **CYCLE, 'between.mjs': 'import "./b.mjs"; export const between = 1;\n', 'd.mjs': d('import "./between.mjs";') })
program('by-a-statement-that-hands-a-name-on', { **CYCLE, 'd.mjs': d('export { b } from "./b.mjs";') })
program('by-a-star', { **CYCLE, 'd.mjs': d('export * from "./b.mjs";') })
program('two-cycles-one-below-the-other', { 'a.mjs': 'import "./b.mjs"; import "./p.mjs"; export const a = 1;\n', 'b.mjs': B, 'p.mjs': 'import "./q.mjs"; import "./slow.mjs"; export const p = 1;\n', 'q.mjs': 'import "./p.mjs"; export const q = 1;\n', 'd.mjs': d('import "./b.mjs";') })

# What is read too early.
program('late-is-a-double', { **CYCLE, 'd.mjs': d('import "./b.mjs";', late='5.5') })
program('late-is-a-text', { **CYCLE, 'd.mjs': d('import "./b.mjs";', late='"five"', use='late.length + work') })
program('late-is-a-map', { **CYCLE, 'd.mjs': d('import "./b.mjs";', late='new Map([[1, 2]])', use='late.size + work') })
program('late-is-an-object', { **CYCLE, 'd.mjs': d('import "./b.mjs";', late='{ n: 5 }', use='late.n + work') })

# A site names what suspends in front of the statement that imports it.
ZERO = { 'a.mjs': None, 'main.mjs': 'import "./zero.mjs"; import "./d.mjs"; import "./e.mjs";\n' }
program('a-site-names-what-suspends-first', { **ZERO, 'zero.mjs': 'import("./slow.mjs");\n', 'd.mjs': d('import "./slow.mjs";') })
program('the-site-stands-in-a-function-that-never-runs', { **ZERO, 'zero.mjs': 'export function never() { %s return import("./slow.mjs"); }\n' % WORK, 'd.mjs': d('import "./slow.mjs";') })
program('the-site-stands-in-a-function-that-runs', { **ZERO, 'zero.mjs': 'function load() { %s return import("./slow.mjs"); }\nload();\n' % WORK, 'd.mjs': d('import "./slow.mjs";') })
program('the-site-names-an-importer-of-what-suspends', { **ZERO, 'zero.mjs': 'import("./between.mjs");\n', 'between.mjs': 'import "./slow.mjs"; export const between = 1;\n', 'd.mjs': d('import "./between.mjs";') })
program('the-site-stands-in-what-hands-the-hooks-over', { **ZERO, 'zero.mjs': 'export const zero = 0;\n', 'reg.mjs': 'import("./slow.mjs");\n' + REG, 'd.mjs': d('import "./slow.mjs";') })
program('a-site-names-what-suspends-and-late-is-a-text', { **ZERO, 'zero.mjs': 'import("./slow.mjs");\n', 'd.mjs': d('import "./slow.mjs";', late='"five"', use='late.length + work') })

# What suspends stands below a module that is deferred: it is evaluated at once all the same, and the importer waits for it.
DEFER = { 'a.mjs': None, 'main.mjs': 'import "./d.mjs"; import "./e.mjs";\n' }
program('what-suspends-is-deferred', { **DEFER, 'd.mjs': d('import defer * as space from "./slow.mjs";') })
program('what-suspends-stands-below-what-is-deferred', { **DEFER, 'between.mjs': 'import "./slow.mjs"; export const between = 1;\n', 'd.mjs': d('import defer * as space from "./between.mjs";') })
program('what-is-deferred-suspends-nowhere', { **DEFER, 'slow.mjs': 'export const ready = 1;\n', 'd.mjs': d('import defer * as space from "./slow.mjs";') })

# Nothing is overtaken: what is proven of d.mjs may stay proven.
program('nothing-suspends', { **CYCLE, 'slow.mjs': 'export const ready = 1;\n', 'd.mjs': d('import "./b.mjs";') })
program('a-leaf-below-a-module-that-waits-is-imported-again', { 'a.mjs': 'import "./leaf.mjs"; import "./slow.mjs"; export const a = 1;\n', 'leaf.mjs': 'export const leaf = 1;\n', 'd.mjs': d('import "./leaf.mjs";') })
program('what-waits-comes-last', { **CYCLE, 'main.mjs': 'import "./d.mjs"; import "./e.mjs"; import "./a.mjs";\n', 'd.mjs': d('import "./hooks.mjs";') })
