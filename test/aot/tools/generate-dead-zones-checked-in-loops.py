#!/usr/bin/env python3
"""generate-dead-zones-checked-in-loops.py <folder>: writes the programs of parallel/dead-zones-checked-in-loops. The same bytes every time.
A loop reads a `const`, `let` or class that no turn writes. The check of its dead zone is asked once, in front of the typed copy of the loop; where the place is empty the other copy runs, which checks in its turn.
Each program enters the loop while the variable is in its dead zone and again behind it: with no turn (nothing throws), with turns (ReferenceError where the program throws it, and whatever the turns did in front of it shows), and filled.
What differs: what is read (an object out of sight, a class, a function, a number), where it lies (a module, another module, a scope), and what stands between the head of the turn and the check.
Each program twice: <name>: the build stays closed wherever the shape lets it . <name>-with-eval: one eval puts the whole build into the open regime."""
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

ATTEMPT = '''function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
'''
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

def folder(name, files):
    for isOpen in (False, True):
        for file, text in files.items():
            if file == 'main.mjs':
                text = ('const zero = (0, eval)("0");\n' if isOpen else 'const zero = 0;\n') + text
            write(os.path.join(out, name + ('-with-eval' if isOpen else ''), file), text)

def shape(name, run, declaration, more='', front='', behind='', extension='mjs'):
    program(name, front + run + ATTEMPT + asks(more) + declaration + asks(more) + behind, extension)

TABLE = 'const table = { handler: (x) => x + 3 };\nglobalThis.table = table;\n'
LOOP = 'function run(n) { let sum = 0; for (let i = 0; i < n; i++) %s return sum; }\n'

# What is read.
shape('an-object-out-of-sight', LOOP % 'sum = table.handler(sum) | 0;', TABLE)
shape('an-object-in-sight', LOOP % 'sum = table.handler(sum) | 0;', 'const table = { handler: (x) => x + 3 };\n')
shape('a-field-of-an-object-out-of-sight', LOOP % 'sum = (sum + table.step) | 0;', 'const table = { step: 3 };\nglobalThis.table = table;\n')
shape('a-class', LOOP % 'sum += new Point(i, 2).sum();', 'class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }\n')
shape('a-class-and-the-class-above-it', LOOP % 'sum += new Derived(i, 2).total;', 'class Base { constructor(a, b) { this.total = a + b; } }\nclass Derived extends Base { constructor(...list) { super(...list); } }\n')
shape('a-static-method', LOOP % 'sum += Point.of(i);', 'class Point { static of(x) { return x + 2; } }\n')
shape('a-function-held-by-a-constant', LOOP % 'sum = step(sum) | 0;', 'const step = (x) => x + 3;\n')
shape('a-number', LOOP % 'sum = (sum + step) | 0;', 'const step = 3;\n')
shape('a-double', LOOP % 'sum = sum + step;', 'const step = 3.5;\n')
shape('a-text', LOOP % 'sum = sum + step.length;', 'const step = "abc";\n')
shape('a-list', LOOP % 'sum = sum + steps[i];', 'const steps = [1, 2, 3];\n')
shape('a-let-that-nobody-writes-again', LOOP % 'sum = table.handler(sum) | 0;', 'let table = { handler: (x) => x + 3 };\nglobalThis.table = table;\n')
shape('a-let-written-again-behind-the-loop', LOOP % 'sum = table.handler(sum) | 0;', 'let table = { handler: (x) => x + 3 };\nglobalThis.table = table;\n', behind='table = { handler: (x) => x + 5 };\n' + asks())
shape('typeof-in-the-dead-zone', LOOP % 'sum = sum + (typeof table).length;', TABLE)

# What stands between the head of the turn and the check.
COUNT = 'const count = { turns: 0 };\nglobalThis.count = count;\n'
shape('something-is-done-in-front-of-the-check', LOOP % '{ count.turns++; sum = table.handler(sum) | 0; }', TABLE, more=', count.turns', front=COUNT)
shape('a-variable-is-written-in-front-of-the-check', LOOP % '{ turns++; sum = table.handler(sum) | 0; }', TABLE, more=', turns', front='let turns = 0;\n')
shape('the-check-stands-under-a-condition', LOOP % '{ turns++; if (i > 1) sum = table.handler(sum) | 0; }', TABLE, more=', turns, attempt(2), turns', front='let turns = 0;\n')
shape('the-check-stands-on-one-of-two-ways', LOOP % '{ if (i & 1) sum = table.handler(sum) | 0; else sum = (sum + 1) | 0; }', TABLE, more=', attempt(1)')
shape('the-check-stands-in-the-condition-of-the-loop', 'function run(n) { let sum = 0; for (let i = 0; i < n && i < table.limit; i++) sum = (sum + i) | 0; return sum; }\n', 'const table = { limit: 2 };\nglobalThis.table = table;\n')
shape('the-check-stands-first-in-the-condition-of-the-loop', 'function run(n) { let sum = 0; for (let i = 0; i < table.limit && i < n; i++) sum = (sum + i) | 0; return sum; }\n', 'const table = { limit: 2 };\nglobalThis.table = table;\n')
shape('the-check-stands-in-the-step-of-the-loop', 'function run(n) { let sum = 0; for (let i = 0; i < n; i = i + table.step) { turns++; sum = (sum + i) | 0; } return sum; }\n', 'const table = { step: 1 };\nglobalThis.table = table;\n', more=', turns', front='let turns = 0;\n')
shape('a-loop-that-tests-behind-its-turn', 'function run(n) { let sum = 0, i = 0; do { sum = table.handler(sum) | 0; i++; } while (i < n); return sum; }\n', TABLE)
shape('two-variables-and-the-second-is-empty', LOOP % '{ sum = first.handler(sum) | 0; turns++; sum = table.handler(sum) | 0; }', TABLE, more=', turns', front='let turns = 0;\nconst first = { handler: (x) => x + 1 };\nglobalThis.first = first;\n')
shape('two-reads-of-one-variable', LOOP % '{ sum = table.handler(sum) | 0; sum = table.handler(sum) | 0; }', TABLE)
shape('the-loop-stands-in-a-loop', 'function run(n) { let sum = 0; for (let k = 0; k < 2; k++) { turns++; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; } return sum; }\n', TABLE, more=', turns', front='let turns = 0;\n')
shape('a-loop-stands-in-front-of-the-check', 'function run(n) { let sum = 0; for (let k = 0; k < n; k++) { for (let i = 0; i < 2; i++) turns++; sum = table.handler(sum) | 0; } return sum; }\n', TABLE, more=', turns', front='let turns = 0;\n')

# Handlers.
shape('the-turn-catches', LOOP % '{ try { sum = table.handler(sum) | 0; } catch (error) { caught++; } }', TABLE, more=', caught', front='let caught = 0;\n')
shape('the-function-catches-around-the-loop', 'function run(n) { let sum = 0; try { for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; } catch (error) { return -1; } return sum; }\n', TABLE)
shape('the-function-ends-in-a-finally', 'function run(n) { let sum = 0; try { for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; } finally { ended++; } return sum; }\n', TABLE, more=', ended', front='let ended = 0;\n')

# The dead zone ends between two turns.
program('the-loop-suspends-and-the-dead-zone-ends-between-two-turns', '''function* run(n) { let sum = 0; for (let i = 0; i < n; i++) { yield sum; sum = table.handler(sum) | 0; } return sum; }
const turns = run(3);
console.log(turns.next().value);
''' + TABLE + '''console.log(turns.next().value, turns.next().value, turns.next().value);
''')
program('the-initializer-itself-enters-the-loop', LOOP % 'sum = table.handler(sum) | 0;' + ATTEMPT + '''function make() { told = attempt(0) + " " + attempt(3); return { handler: (x) => x + 3 }; }
let told = "";
const table = make();
globalThis.table = table;
console.log(told, attempt(3));
''')

# Where the variable lies.
program('a-scope-of-a-function', '''function outer() {
  function run(n) { let sum = 0; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; return sum; }
  function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
  const early = attempt(0) + " " + attempt(3);
  const table = { handler: (x) => x + 3 };
  globalThis.table = table;
  return early + " " + attempt(0) + " " + attempt(3);
}
console.log(outer());
''')
program('a-scope-of-a-turn', '''function outer(rounds) {
  let told = "";
  for (let round = 0; round < rounds; round++) {
    const run = (n) => { let sum = 0; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; return sum; };
    const attempt = (n) => { try { return String(run(n)); } catch (error) { return error.name; } };
    told += attempt(0) + " " + attempt(3) + " ";
    const table = { handler: (x) => x + round };
    globalThis.table = table;
    told += attempt(3) + " ";
  }
  return told;
}
console.log(outer(3));
''')
program('the-loop-stands-in-the-scope-itself', '''function outer(n) {
  let sum = 0;
  try { for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; } catch (error) { sum = -1; }
  const table = { handler: (x) => x + 3 };
  globalThis.table = table;
  for (let i = 0; i < n; i++) sum = table.handler(sum) | 0;
  return sum;
}
console.log(outer(0), outer(3));
''')
folder('another-module-that-imports-this-one', {
    'main.mjs': 'import "./late.mjs";\n',
    'late.mjs': 'import { told } from "./early.mjs";\nexport const table = { handler: (x) => x + 3 };\nglobalThis.table = table;\nimport { attempt } from "./early.mjs";\nconsole.log(told, attempt(0), attempt(3));\n',
    'early.mjs': 'import { table } from "./late.mjs";\nfunction run(n) { let sum = 0; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; return sum; }\nexport function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }\nexport const told = attempt(0) + " " + attempt(3);\n',
})
folder('a-class-of-another-module-that-imports-this-one', {
    'main.mjs': 'import "./late.mjs";\n',
    'late.mjs': 'import { told, attempt } from "./early.mjs";\nexport class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }\nconsole.log(told, attempt(0), attempt(3));\n',
    'early.mjs': 'import { Point } from "./late.mjs";\nfunction run(n) { let sum = 0; for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); return sum; }\nexport function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }\nexport const told = attempt(0) + " " + attempt(3);\n',
})

# The caller's loop, and a copy of the callee in it.
shape('the-read-stands-in-a-callee-that-is-copied', 'function once(sum) { return table.handler(sum) | 0; }\n' + LOOP % 'sum = once(sum);', TABLE)
shape('the-read-stands-in-a-getter', 'const holder = { get step() { return table.step; } };\n' + LOOP % 'sum = (sum + holder.step) | 0;', 'const table = { step: 3 };\nglobalThis.table = table;\n')

# Typed.
program('typed-an-object-out-of-sight', '''function run(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; return sum; }
function attempt(n: number): string { try { return String(run(n)); } catch (error) { return (error as Error).name; } }
console.log(attempt(0), attempt(3));
const table = { handler: (x: number) => x + 3 };
(globalThis as any).table = table;
console.log(attempt(0), attempt(3));
''', 'ts')
program('typed-a-class', '''function run(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += new Point(i, 2).sum(); return sum; }
function attempt(n: number): string { try { return String(run(n)); } catch (error) { return (error as Error).name; } }
console.log(attempt(0), attempt(3));
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
console.log(attempt(0), attempt(3));
''', 'ts')
