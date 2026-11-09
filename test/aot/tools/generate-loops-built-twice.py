#!/usr/bin/env python3
# generate-loops-built-twice.py <folder> <how many> [seed]: loops over texts and lists in functions that get out, so that the compiler tests the parameter in front of the loop and builds the loop twice,
# alone and in loops: sums that begin small, turn negative, pass 2^31 and 2^53, become fractions, NaN or texts. What the first looks at a loop find is narrow, what comes round later is not,
# and what a loop inside hands the walk has to lie within what the looks at the loops around it have counted on. Held to `bun <file>`. The programs of test/aot/parallel/loops-built-twice: 240 11.
import random, sys, os
folder, count = sys.argv[1], int(sys.argv[2]); seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
os.makedirs(folder, exist_ok=True)
def program(r, typed):
    sums = ['h', 'g', 'k']
    def read(i):
        return r.choice([f's.charCodeAt({i})', f's.charCodeAt({i})', f'list[{i}]', f'list[{i}]', f's.length', f'list.length', f'{i}', f's.charCodeAt({i} + 1)', f'(list[{i}] | 0)', f's.codePointAt({i})'])
    def step(i):
        x = r.choice(sums); y = r.choice(sums); v = read(i)
        return r.choice([
            f'{x} = ({x} * 31 + {v}) | 0;', f'{x} = ({x} * 33 ^ {v}) >>> 0;', f'{x} = {x} * 31 + {v};', f'{x} += {v};', f'{x} = ({x} + {v}) & 65535;',
            f'{x} = ({x} << 5) - {x} + {v};', f'{x} = {y} - {v};', f'{x} = -{x} + {v};', f'{x} = {x} * 2 + 1;', f'{x} = ({x} ^ {y}) + {v};', f'{x} = Math.imul({x}, 16777619) ^ {v};',
            f'{x} = {x} / 2 + {v};', f'{x} = {y};', f'if ({x} > {r.choice(["65535", "2147483647", "0", "1e15"])}) {x} = {r.choice(["0", "-1", "0.5", y])};', f'if ({v} > 100) {x} = {y}; else {y} = {x};',
            f'{x} = ({x} % 1000003) * 31 + {v};', f'{x} = {x} + "" === "7" ? 0 : {x} + {v};',
        ])
    counters = []
    serial = [0]
    def loop(depth, indent):
        pad = '  ' * indent; serial[0] += 1; i = f'i{depth}_{r.randrange(100)}_{serial[0]}'
        over = r.choice(['s.length', 's.length', 'list.length', 'list.length', 'n', '3'])
        kind = r.choice(['for', 'for', 'for', 'down', 'while'])
        out = []
        if kind == 'for': out.append(f'{pad}for (let {i} = 0; {i} < {over}; {i}++) {{')
        elif kind == 'down': out.append(f'{pad}for (let {i} = {over} - 1; {i} >= 0; {i}--) {{')
        else: out += [f'{pad}let {i} = 0;', f'{pad}while ({i} < {over}) {{']
        counters.append(i)
        for _ in range(r.randrange(1, 4)):
            out.append('  ' * (indent + 1) + step(r.choice(counters)))
            if depth < 3 and r.random() < 0.3: out += loop(depth + 1, indent + 1)
        if kind == 'while': out.append('  ' * (indent + 1) + f'{i}++;')
        counters.pop()
        out.append(pad + '}')
        return out
    body = []
    for _ in range(r.randrange(1, 3)): body += loop(1, 1)
    any_ = ': any' if typed else ''
    sig = r.choice(['(s: string, list: number[], n: number)', '(s: any, list: any, n: any)', '(s: string, list: any, n: number)']) if typed else '(s, list, n)'
    start = r.choice(['0', '0', '0', '1', '5381', '-1', '2166136261', '0.5'])
    text = f'function run{sig} {{\n  let h{any_} = {start}, g{any_} = 0, k{any_} = 1;\n' + '\n'.join(body) + '\n  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");\n}\n'
    text += ('(globalThis as any)' if typed else 'globalThis') + '.kept = run;\n'
    rows = '[["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\\uffff\\uffff\\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\\ud83d\\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]'
    text += f'for (const [s, list, n] of {rows}' + (' as any[]' if typed else '') + ') console.log(run(s, list, n));\n'
    if r.random() < 0.4:
        text += 'try {\n  console.log(' + ('(globalThis as any)' if typed else 'globalThis') + '.kept([104, 105], "hi", 2));\n} catch (error) {\n  console.log(' + ('(error as Error)' if typed else 'error') + '.name);\n}\n'
    return text
r = random.Random(seed)
for k in range(count):
    typed = r.random() < 0.6
    open(os.path.join(folder, f'loops-built-twice-{seed}-{k:04d}.' + ('ts' if typed else 'js')), 'w').write(program(r, typed))
