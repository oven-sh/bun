#!/usr/bin/env python3
# generate-loops-in-loops.py <folder> <how many> [seed]: loops in loops on plain values, held to `bun <file>`: what a loop inside is told changes from look to look at the loops around it,
# and the compiler keeps what it has found of a loop for the next time that the same types arrive at it. The programs of test/aot/parallel/loops-in-loops: 150 7.
import random, sys, os
folder, count = sys.argv[1], int(sys.argv[2]); seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
os.makedirs(folder, exist_ok=True)
def program(r):
    names = ['a', 'b', 'c', 'd', 'e']
    outer = ['m0', 'm1']
    lines = []
    counters = []
    declared = []
    labels = []
    def value(depth):
        pool = names + counters + outer + ['p', 'q']
        k = r.random()
        if k < 0.35: return r.choice(pool)
        if k < 0.55: return str(r.choice([0, 1, 2, 3, 7, -1, 255, 65536, 2147483647, 2147483648, 4294967295, 9007199254740991, 0.5, -0.5]))
        if k < 0.62: return r.choice(['"x"', 'true', 'undefined', 'null', '-0', 'NaN'])
        op = r.choice(['+', '-', '*', '|', '&', '^', '>>', '>>>', '<<', '%'])
        return f'({r.choice(pool)} {op} {r.choice(pool + ["1", "2", "3"])})'
    def test():
        pool = names + counters + outer + ['p', 'q']
        return f'{r.choice(pool)} {r.choice(["<", "<=", ">", ">=", "===", "!==", "==", "!="])} {r.choice(pool + ["0", "1", "2", "5", "100"])}'
    def statement(depth, indent):
        k = r.random(); pad = '  ' * indent
        if k < 0.30: return [f'{pad}{r.choice(names + outer)} = {value(depth)};']
        if k < 0.45: return [f'{pad}{r.choice(names + outer)}{r.choice(["++", "--", " += 1", " -= 1", " += 2", " *= 2", " |= 0", " >>>= 0"])};']
        if k < 0.55: return [f'{pad}if ({test()}) {r.choice(names)} = {value(depth)}; else {r.choice(names)} = {value(depth)};']
        if k < 0.62 and labels: return [f'{pad}if ({test()}) {r.choice(["break", "continue"])} {r.choice(labels)};']
        if k < 0.68 and labels: return [f'{pad}if ({test()}) {r.choice(["break", "continue"])};']
        if k < 0.72: return [f'{pad}const t{len(lines) + r.randrange(1000)} = {value(depth)};']
        if depth < 5: return loop(depth + 1, indent)
        return [f'{pad}{r.choice(names)} = {value(depth)};']
    def loop(depth, indent):
        pad = '  ' * indent; i = f'i{len(counters)}_{r.randrange(100)}'; label = f'L{len(labels)}_{r.randrange(100)}'
        turns = r.choice([1, 2, 3, 3, 4])
        kind = r.choice(['for', 'for', 'for', 'do', 'while', 'down'])
        out = []
        if kind == 'for': out.append(f'{pad}{label}: for (let {i} = 0; {i} < {r.choice([str(turns), "n", "p"])} && {i} < {turns}; {i}++) {{')
        elif kind == 'down': out.append(f'{pad}{label}: for (let {i} = {turns}; {i} > 0; {i}--) {{')
        elif kind == 'do': out += [f'{pad}{i} = 0;', f'{pad}{label}: do {{']
        else: out += [f'{pad}{i} = 0;', f'{pad}{label}: while ({i}++ < {turns}) {{']
        if kind in ('do', 'while'): declared.append(i)
        counters.append(i); labels.append(label)
        for _ in range(r.randrange(1, 5)): out += statement(depth, indent + 1)
        labels.pop()
        out.append(f'{pad}}}' + (f' while (++{i} < {turns});' if kind == 'do' else ''))
        if kind in ('for', 'down'): counters.remove(i)
        return out
    body = []
    for _ in range(r.randrange(1, 3)): body += loop(1, 1)
    typed = r.random() < 0.5
    sig = '(n: number, p: number, q: any)' if typed else '(n, p, q)'
    text = 'let m0' + (': any' if typed else '') + ' = 0, m1' + (': any' if typed else '') + ' = 1;\n'
    text += f'function run{sig} {{\n  let a' + (': any' if typed else '') + ' = 0, b' + (': any' if typed else '') + ' = 1, c' + (': any' if typed else '') + ' = p, d' + (': any' if typed else '') + ' = q, e' + (': any' if typed else '') + ' = 0.5;\n' + (('  let ' + ', '.join(f'{name} = 0' for name in declared) + ';\n') if declared else '') + '\n'.join(body) + '\n  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");\n}\n'
    text += 'for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {\n  try {\n    console.log(run(n' + (' as number' if typed else '') + ', p' + (' as number' if typed else '') + ', q));\n  } catch (error) {\n    console.log((error as Error).name);\n  }\n}\n' if typed else 'for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {\n  try {\n    console.log(run(n, p, q));\n  } catch (error) {\n    console.log(error.name);\n  }\n}\n'
    return text, typed
r = random.Random(seed)
for k in range(count):
    text, typed = program(r)
    open(os.path.join(folder, f'loops-in-loops-{seed}-{k:04d}.' + ('ts' if typed else 'js')), 'w').write(text)
