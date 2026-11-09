#!/usr/bin/env python3
"""generate-dead-zones-asked-in-front-of-loops.py <folder>: writes the programs of parallel/dead-zones-asked-in-front-of-loops. The same bytes every time.
A loop whose turns check the dead zone of a variable of a module is built twice: the variable is asked once, in front; where it is empty the other copy runs, which checks in its turns.
This holds whatever the turns run: a variable never goes back into its dead zone. A variable whose object is made by its first read (a list, an object of data, a regular expression) gets it made in front of the loop.
Beside parallel/dead-zones-checked-in-loops, whose shapes are run against this too: loops that run other code, variables that the turns write, objects that are put off, and what shows if one is made too early or twice.
Each program enters the loop while the variable is in its dead zone (with no turn, with turns) and again behind it.
Each program twice: <name>: the build stays closed wherever the shape lets it . <name>-with-eval: one eval puts the whole build into the open regime."""
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

ATTEMPT = 'function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }\n'
def asks(more=''):
    return 'console.log(attempt(0), attempt(3)%s);\n' % more

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(text)

def program(name, text, extension='mjs'):
    for isOpen in (False, True):
        head = 'const zero = (0, eval)("0");\n' if isOpen else 'const zero = 0;\n'
        write(os.path.join(out, name + ('-with-eval' if isOpen else '') + '.' + extension), head + text)

def shape(name, run, declaration, more='', front='', behind='', extension='mjs'):
    program(name, front + run + ATTEMPT + asks(more) + declaration + asks(more) + behind, extension)

LOOP = 'function run(n) { let sum = 0; for (let i = 0; i < n; i++) %s return sum; }\n'
# Bun moves the declaration of a class that extends nothing in front of the statements of its module, with or without --aot: no program sees the dead zone of such a class.
POINT = 'class Origin { constructor() { this.o = 0; } }\nclass Point extends Origin { constructor(x, y) { super(); this.x = x; this.y = y; } sum() { return this.x + this.y + this.o; } }\n'
UNSEEN = 'const unseen = [(x) => { calls++; return x; }][JSON.parse("0")];\nlet calls = 0;\n'

# The turns run other code.
shape('other-code-runs-in-front-of-the-check', LOOP % '{ unseen(i); sum += new Point(i, 2).sum(); }', POINT, more=', calls', front=UNSEEN)
shape('other-code-runs-behind-the-check', LOOP % '{ sum += new Point(i, 2).sum(); unseen(i); }', POINT, more=', calls', front=UNSEEN)
shape('what-is-added-may-be-a-text', 'function run(n) { let sum = unseen(0); for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); return sum; }\n', POINT, front=UNSEEN)
shape('a-method-of-the-class-runs-other-code', LOOP % 'sum += new Point(i, 2).sum();', 'class Origin { constructor() { this.o = 0; } }\nclass Point extends Origin { constructor(x, y) { super(); this.x = unseen(x); this.y = y; } sum() { return this.x + this.y; } }\n', more=', calls', front=UNSEEN)
shape('a-class-that-extends-nothing', LOOP % 'sum += new Plain(i, 2).sum();', 'class Plain { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }\n')
shape('a-class-held-by-a-constant', LOOP % 'sum += new Held(i, 2).sum();', 'const Held = class { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } };\n')

# The turns write the variable.
shape('a-let-that-the-turns-step', 'function run(n) { for (let i = 0; i < n; i++) steps = steps + 1; return steps; }\n', 'let steps = 10;\n')
shape('a-let-that-the-turns-only-write', 'function run(n) { for (let i = 0; i < n; i++) last = i; return n; }\n', 'let last = -1;\n', behind='console.log(last);\n')
shape('a-let-that-a-callee-writes', 'function step() { steps = steps + 1; }\nfunction run(n) { for (let i = 0; i < n; i++) { step(); if (steps > 100) return -1; } return steps; }\n', 'let steps = 10;\n')

# An object that is made by the first read.
shape('a-list-of-data', LOOP % 'sum += steps[i & 1];', 'const steps = [1, 2];\n')
shape('an-object-of-data', LOOP % 'sum += table.a + table.b;', 'const table = { a: 1, b: 2 };\n')
shape('a-list-of-texts', LOOP % 'sum += kinds[i & 1].length;', 'const kinds = ["add", "neg"];\n')
shape('a-regular-expression', LOOP % 'sum += pattern.test("a" + i) ? 1 : 0;', 'const pattern = /a[12]/;\n')
shape('a-regular-expression-that-remembers', LOOP % 'sum += pattern.test("aaaa") ? pattern.lastIndex : 100;', 'const pattern = /a/g;\n', behind='console.log(pattern.lastIndex);\n')
shape('an-object-of-data-that-the-turns-write', LOOP % '{ table.a++; sum += table.a; }', 'const table = { a: 1, b: 2 };\n', behind='console.log(table.a);\n')
shape('one-object-whoever-reads-first', LOOP % 'sum += table.a;' + 'function same() { return table; }\n', 'const table = { a: 1, b: 2 };\n', behind='const first = same();\nconsole.log(attempt(0), first === same(), attempt(2), first === table);\n')
shape('the-loop-with-no-turn-comes-first', LOOP % 'sum += table.a;' + 'function mark() { table.a = 7; return table.a; }\n', 'const table = { a: 1, b: 2 };\n', behind='console.log(attempt(0), mark(), attempt(2));\n')
shape('two-objects-of-data', LOOP % 'sum += first.a + second[0];', 'const first = { a: 1 };\nconst between = attempt(3);\nconst second = [2];\n', behind='console.log(between);\n')

# Several loops.
shape('two-loops-one-behind-the-other', 'function run(n) { let sum = 0; for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); for (let i = 0; i < n; i++) sum += new Point(i, 3).sum(); return sum; }\n', POINT)
shape('the-first-loop-has-no-turn', 'function run(n) { let sum = 0; for (let i = 0; i < 0; i++) sum += new Point(i, 2).sum(); turns++; for (let i = 0; i < n; i++) sum += new Point(i, 3).sum(); return sum; }\n', POINT, more=', turns', front='let turns = 0;\n')
shape('the-check-stands-in-a-loop-inside', 'function run(n) { let sum = 0; for (let k = 0; k < n; k++) { turns++; for (let i = 0; i < k; i++) sum += new Point(i, 2).sum(); } return sum; }\n', POINT, more=', turns', front='let turns = 0;\n')
shape('a-loop-over-a-list', 'function run(n) { let sum = 0; for (const x of [1, 2, 3].slice(0, n)) sum += new Point(x, 2).sum(); return sum; }\n', POINT)
shape('a-while-loop', 'function run(n) { let sum = 0, i = 0; while (i < n) { sum += new Point(i, 2).sum(); i++; } return sum; }\n', POINT)
shape('a-loop-left-by-a-break', LOOP % '{ if (i === 1) break; sum += new Point(i, 2).sum(); }', POINT)
shape('a-loop-left-in-front-of-the-check', LOOP % '{ if (i === 0) break; sum += new Point(i, 2).sum(); }', POINT)

# Handlers.
shape('the-function-catches-around-the-loop', 'function run(n) { let sum = 0; try { for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); } catch (error) { return error.name.length; } return sum; }\n', POINT)
shape('the-turn-catches', LOOP % '{ try { sum += new Point(i, 2).sum(); } catch (error) { caught++; } }', POINT, more=', caught', front='let caught = 0;\n')
shape('the-turn-ends-in-a-finally', LOOP % '{ try { sum += new Point(i, 2).sum(); } finally { ended++; } }', POINT, more=', ended', front='let ended = 0;\n')

# The loop stands in the body of the module itself.
program('the-body-of-the-module-loops-in-front-of-the-declaration', '''let sum = 0, told = "";
try { for (let i = 0; i < 3; i++) sum += new Point(i, 2).sum(); } catch (error) { told = error.name; }
for (let i = 0; i < 0; i++) sum += new Point(i, 2).sum();
''' + POINT + '''for (let i = 0; i < 3; i++) sum += new Point(i, 2).sum();
console.log(told, sum);
''')

# Typed.
program('typed-a-class', '''function run(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); return sum; }
function attempt(n: number): string { try { return String(run(n)); } catch (error) { return (error as Error).name; } }
console.log(attempt(0), attempt(3));
class Origin { o: number; constructor() { this.o = 0; } }
class Point extends Origin { x: number; y: number; constructor(x: number, y: number) { super(); this.x = x; this.y = y; } sum() { return this.x + this.y + this.o; } }
console.log(attempt(0), attempt(3));
''', 'ts')
program('typed-a-list-of-texts', '''type Kind = "add" | "neg";
function run(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += kinds[i & 1].length; return sum; }
function attempt(n: number): string { try { return String(run(n)); } catch (error) { return (error as Error).name; } }
console.log(attempt(0), attempt(3));
const kinds: Kind[] = ["add", "neg"];
console.log(attempt(0), attempt(3));
''', 'ts')
