#!/usr/bin/env python3
# generate-loops-over-lists-with-and-without-their-types.py <folder>: one loop over a list, written twice: with its types declared and without. Writing the type must not make the loop slower.
import re, sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
# name, declarations, type of the list, how element i is made, result type, body of the function
pairs = [
 ('sum-of-integers', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return s;'),
 ('sum-of-fractions', '', 'number[]', 'i * 0.5', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return s;'),
 ('sum-of-integers-readonly', '', 'readonly number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return s;'),
 ('sum-of-integers-for-of', '', 'number[]', 'i & 7', 'let s = 0;\n  for (const x of list) s += x;\n  return s;'),
 ('difference-of-integers', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s -= list[i];\n  return s;'),
 ('integers-over-three', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] > 3) s++;\n  return s;'),
 ('integers-that-are-three', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] === 3) s++;\n  return s;'),
 ('greatest-integer', '', 'number[]', 'i & 7', 'let m = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] > m) m = list[i];\n  return m;'),
 ('bits-of-integers', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s ^= list[i];\n  return s;'),
 ('integers-as-keys', '', 'number[]', 'i & 7', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s ^= list[list[i]];\n  return s;'),
 ('lengths-of-texts', '', 'string[]', '"abcdefgh".slice(0, i & 7)', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i].length;\n  return s;'),
 ('texts-that-are-abc', '', 'string[]', '"abcdefgh".slice(0, i & 7)', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] === "abc") s++;\n  return s;'),
 ('booleans-that-hold', '', 'boolean[]', '(i & 3) === 1', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i]) s++;\n  return s;'),
 ('kinds-of-objects', 'interface Node { kind: number; next: Node | null }\n', 'Node[]', '{ kind: i & 7, next: null }', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i].kind === 3) s++;\n  return s;'),
 ('sum-of-fields', 'interface Node { kind: number; next: Node | null }\n', 'Node[]', '{ kind: i & 7, next: null }', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i].kind;\n  return s;'),
 ('kinds-of-instances', 'class Node { kind: number; constructor(kind: number) { this.kind = kind; } }\n', 'Node[]', 'new Node(i & 7)', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i].kind === 3) s++;\n  return s;'),
 ('pairs-in-tuples', '', '[number, number][]', '[i & 7, i & 3]', 'let s = 0;\n  for (let i = 0; i < list.length; i++) { const pair = list[i]; s += pair[0] + pair[1]; }\n  return s;'),
 ('numbers-or-texts', '', '(number | string)[]', 'i & 1 ? i & 7 : "x"', 'let s = 0;\n  for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "number") s += x; }\n  return s;'),
 ('numbers-or-nothing', '', '(number | undefined)[]', 'i & 1 ? i & 7 : undefined', 'let s = 0;\n  for (let i = 0; i < list.length; i++) { const x = list[i]; if (x !== undefined) s += x; }\n  return s;'),
 ('stores-of-integers', '', 'number[]', 'i & 7', 'for (let i = 0; i < list.length; i++) list[i] = i & 3;\n  return list.length;'),
]
def strip(declarations):
    if declarations.startswith('interface'): return ''
    return declarations.replace('kind: number; constructor(kind: number)', 'constructor(kind)')
for name, declarations, kind, element, body in pairs:
    made = kind.replace('readonly ', '')
    typed = f'const n = +process.argv[2] || 3000;\n{declarations}const list: {made} = [];\nfor (let i = 0; i < 1000; i++) list.push({element});\nfunction run(list: {kind}): number {{\n  {body}\n}}\nlet all = 0;\nfor (let k = 0; k < n / 1000; k++) all += run(list);\nconsole.log(all);\n'
    untyped = f'const n = +process.argv[2] || 3000;\n{strip(declarations)}const list = [];\nfor (let i = 0; i < 1000; i++) list.push({element});\nfunction run(list) {{\n  {body}\n}}\nlet all = 0;\nfor (let k = 0; k < n / 1000; k++) all += run(list);\nconsole.log(all);\n'
    open(f'{out}/{name}-typed.ts', 'w').write(typed); open(f'{out}/{name}-untyped.js', 'w').write(untyped)
print(len(pairs), 'pairs')
