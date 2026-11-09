#!/usr/bin/env python3
# generate-unions-told-by-a-tag.py <folder>: all 760; ../parallel/unions-told-by-a-tag/ holds 8 of them: a union of records told apart by a written tag; the program tests the tag in one way, something arrives, and a member's own field is used behind the test: one program each, held to `bun <file>`.
# Behind the program's test only the members whose written tag fits are expected. That is a guess: the tag may lie, may be stored later, and what arrives may be no member at all.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
# the tags: how they are written in the types, and as values
tags = [
 ('numbers', '1', '2', '3'),
 ('texts', '"a"', '"b"', '"c"'),
 ('booleans', 'true', 'false', None),
 ('an-enum', 'Kind.A', 'Kind.B', 'Kind.C'),
]
# how the program tells: {A} {B} {C} are the tags, USE_A .. what is done with the member
tests = [
 ('if-equal', 'if (x.kind === {A}) return USE_A;\n  return REST;'),
 ('if-not-equal', 'if (x.kind !== {A}) return REST;\n  return USE_A;'),
 ('if-written-first', 'if ({A} === x.kind) return USE_A;\n  return REST;'),
 ('a-condition', 'return x.kind === {A} ? USE_A : REST;'),
 ('and', 'return (x.kind === {A} && USE_A) || REST;'),
 ('a-switch', 'switch (x.kind) {\n    case {A}: return USE_A;\n    case {B}: return USE_B;\n    default: return OTHER;\n  }'),
 ('a-switch-that-falls-through', 'let s: unknown = "none";\n  switch (x.kind) {\n    case {A}: s = USE_A;\n    case {B}: return [s, x.kind].join();\n    default: return OTHER;\n  }'),
 ('the-tag-read-first', 'const kind = x.kind;\n  if (kind === {A}) return USE_A;\n  return REST;'),
 ('a-test-in-a-loop', 'let s = "";\n  for (let i = 0; i < 3; i++) {\n    if (x.kind === {A}) s += USE_A; else s += REST;\n  }\n  return s;'),
 ('a-predicate', 'if (isA(x)) return USE_A;\n  return REST;'),
]
# what arrives: an expression; `lies` says in a word what is wrong with it
arrivals = [
 ('the-first-member', '{ kind: {A}, a: 7 }'),
 ('the-second-member', '{ kind: {B}, b: 8 }'),
 ('the-first-tag-on-the-second-member', '({ kind: {A}, b: 8 } as any)'),
 ('the-second-tag-on-the-first-member', '({ kind: {B}, a: 7 } as any)'),
 ('a-tag-that-no-member-has', '({ kind: 99, a: 7 } as any)'),
 ('no-tag', '({ a: 7 } as any)'),
 ('the-tag-stored-later', 'later({ kind: {B}, b: 8 } as any, {A})'),
 ('the-tag-stored-later-and-the-field-added', 'grown({ kind: {B}, b: 8 } as any, {A})'),
 ('the-fields-in-another-order', '({ a: 7, kind: {A} } as A)'),
 ('one-field-more', '({ kind: {A}, a: 7, more: 1 } as A)'),
 ('a-third-layout-unannounced', '({ kind: {A}, c: 9, a: "seven" } as any)'),
 ('an-instance-of-a-class', '(new Stranger({A}) as any)'),
 ('the-tag-is-an-accessor', '({ get kind() { calls++; return {A}; }, a: 7 } as any)'),
 ('the-tag-answers-differently-each-time', '({ get kind() { return calls++ & 1 ? {B} : {A}; }, a: 7, b: 8 } as any)'),
 ('the-field-is-an-accessor', '({ kind: {A}, get a() { calls++; return 7; } } as any)'),
 ('the-field-stands-above', '(Object.assign(Object.create({ a: 7 }), { kind: {A} }) as any)'),
 ('a-proxy', '(new Proxy({ kind: {A}, a: 7 }, { get(target: any, key) { calls++; return target[key]; } }) as any)'),
 ('frozen', 'Object.freeze({ kind: {A}, a: 7 } as A)'),
 ('null', '(null as any)'),
 ('a-number', '(5 as any)'),
]
n = 0
for tagName, A, B, C in tags:
    for testName, test in tests:
        if C is None and 'switch' in testName: continue
        for arrivalName, arrival in arrivals:
            enum = 'const enum Kind { A = 1, B = 2, C = 3 }\n' if tagName == 'an-enum' else ''
            third = f'interface C {{ kind: {C}; c: number }}\n' if C else ''
            union = 'A | B | C' if C else 'A | B'
            body = test.replace('{A}', A).replace('{B}', B).replace('USE_A', 'show(x.a)').replace('USE_B', 'show(x.b)').replace('REST', 'show((x as any).b)').replace('OTHER', 'show((x as any).c)')
            text = f'''// Made by test/aot/tools/generate-unions-told-by-a-tag.py.
{enum}interface A {{ kind: {A}; a: number }}
interface B {{ kind: {B}; b: number }}
{third}type N = {union};
class Stranger {{ a = 70; b = 80; kind: unknown; constructor(kind: unknown) {{ this.kind = kind; }} }}
let calls = 0;
function show(x: unknown): string {{ return typeof x + ":" + String(x); }}
function later(x: any, tag: unknown): N {{ x.kind = tag; return x; }}
function grown(x: any, tag: unknown): N {{ x.kind = tag; x.a = 77; return x; }}
function isA(x: N): x is A {{ return x.kind === {A}; }}
function tell(x: N): unknown {{
  {body}
}}
function members(): N[] {{ return [{{ kind: {A}, a: 1 }}, {{ kind: {B}, b: 2 }}]; }}
function safely(x: N): string {{
  try {{
    return String(tell(x)) + " " + calls;
  }} catch (error: any) {{
    return "thrown: " + error.name + " " + calls;
  }}
}}
for (let turn = 0; turn < 3; turn++) {{
  for (const member of members()) console.log(safely(member));
  console.log(safely({arrival.replace('{A}', A).replace('{B}', B)}));
}}
'''
            open(f'{out}/{tagName}-{testName}-{arrivalName}.ts', 'w').write(text); n += 1
print(n, 'programs')
