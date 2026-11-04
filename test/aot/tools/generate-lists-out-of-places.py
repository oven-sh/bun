#!/usr/bin/env python3
# generate-lists-out-of-places.py <folder>: a list declared `Node[]` comes out of a place (a field, a variable, a map, a call), something lies in it, and its elements are used in one way: one program each, held to `bun <file>`.
# What is written of the contents of a list is a guess wherever the list comes from. Now and then the type lies.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
# name, declarations, how `run` gets the list out of `list`
places = [
 ('a-field-of-a-literal', 'interface Holder { nodes: Node[] }\nfunction hold(list: Node[]): Holder { return { nodes: list }; }', 'Holder', 'const list = holder.nodes;'),
 ('a-field-read-in-every-turn', 'interface Holder { nodes: Node[] }\nfunction hold(list: Node[]): Holder { return { nodes: list }; }', 'Holder', None),
 ('a-field-of-an-instance', 'class Holder { nodes: Node[]; constructor(list: Node[]) { this.nodes = list; } }\nfunction hold(list: Node[]): Holder { return new Holder(list); }', 'Holder', 'const list = holder.nodes;'),
 ('a-private-field', 'class Holder { #nodes: Node[]; constructor(list: Node[]) { this.#nodes = list; } get(): Node[] { return this.#nodes; } }\nfunction hold(list: Node[]): Holder { return new Holder(list); }', 'Holder', 'const list = holder.get();'),
 ('a-getter', 'class Holder { private kept: Node[]; constructor(list: Node[]) { this.kept = list; } get nodes(): Node[] { return this.kept; } }\nfunction hold(list: Node[]): Holder { return new Holder(list); }', 'Holder', 'const list = holder.nodes;'),
 ('an-optional-field', 'interface Holder { nodes?: Node[] }\nfunction hold(list: Node[]): Holder { return { nodes: list }; }', 'Holder', 'const list = holder.nodes;\n  if (!list) return "none";'),
 ('a-field-of-a-field', 'interface Inner { nodes: Node[] }\ninterface Holder { inner: Inner }\nfunction hold(list: Node[]): Holder { return { inner: { nodes: list } }; }', 'Holder', 'const list = holder.inner.nodes;'),
 ('a-pattern', 'interface Holder { nodes: Node[]; more: number }\nfunction hold(list: Node[]): Holder { return { nodes: list, more: 1 }; }', 'Holder', 'const { nodes: list } = holder;'),
 ('a-list-of-lists', 'type Holder = Node[][];\nfunction hold(list: Node[]): Holder { return [[], list]; }', 'Holder', 'const list = holder[1];'),
 ('a-map', 'type Holder = Map<string, Node[]>;\nfunction hold(list: Node[]): Holder { return new Map([["nodes", list]]); }', 'Holder', 'const list = holder.get("nodes")!;'),
 ('a-record', 'type Holder = Record<string, Node[]>;\nfunction hold(list: Node[]): Holder { return { nodes: list }; }', 'Holder', 'const list = holder["no" + "des"];'),
 ('a-closure', 'type Holder = () => Node[];\nfunction hold(list: Node[]): Holder { return () => list; }', 'Holder', 'const list = holder();'),
 ('a-variable-of-the-module', 'let kept: Node[] = [];\ntype Holder = number;\nfunction hold(list: Node[]): Holder { kept = list; return 0; }', 'Holder', 'const list = kept;'),
 ('a-tuple', 'type Holder = [number, Node[]];\nfunction hold(list: Node[]): Holder { return [1, list]; }', 'Holder', 'const list = holder[1];'),
]
contents = [
 ('as-declared', '{ kind: i & 3, next: null }'),
 ('another-order-of-fields', 'i === 2 ? ({ next: null, kind: 3 } as Node) : { kind: i & 3, next: null }'),
 ('one-field-more', 'i === 2 ? ({ more: 1, kind: 3, next: null } as Node) : { kind: i & 3, next: null }'),
 ('the-field-is-missing', 'i === 2 ? ({ next: null } as any) : { kind: i & 3, next: null }'),
 ('the-field-holds-a-text', 'i === 2 ? ({ kind: "3", next: null } as any) : { kind: i & 3, next: null }'),
 ('the-field-holds-a-fraction', 'i === 2 ? { kind: 3.5, next: null } : { kind: i & 3, next: null }'),
 ('the-field-is-an-accessor', 'i === 2 ? ({ get kind() { calls++; return 3; }, set kind(value: number) { calls += 10; }, next: null } as Node) : { kind: i & 3, next: null }'),
 ('the-field-stands-above', 'i === 2 ? (Object.create({ kind: 3, next: null }) as Node) : { kind: i & 3, next: null }'),
 ('an-instance-of-a-class', 'i === 2 ? new Other(3) : { kind: i & 3, next: null }'),
 ('a-frozen-object', 'i === 2 ? Object.freeze({ kind: 3, next: null }) : { kind: i & 3, next: null }'),
 ('a-proxy', 'i === 2 ? new Proxy({ kind: 0, next: null }, { get(target, key) { calls++; return key === "kind" ? 3 : undefined; } }) : { kind: i & 3, next: null }'),
 ('a-number-against-the-type', 'i === 2 ? (3 as any) : { kind: i & 3, next: null }'),
 ('a-text-against-the-type', 'i === 2 ? ("kind" as any) : { kind: i & 3, next: null }'),
 ('null-against-the-type', 'i === 2 ? (null as any) : { kind: i & 3, next: null }'),
 ('undefined-against-the-type', 'i === 2 ? (undefined as any) : { kind: i & 3, next: null }'),
 ('a-list-against-the-type', 'i === 2 ? ([3] as any) : { kind: i & 3, next: null }'),
 ('a-function-against-the-type', 'i === 2 ? ((() => 3) as any) : { kind: i & 3, next: null }'),
]
uses = [
 ('counted-by-kind', 'let s = 0;\n  for (let i = 0; i < LIST.length; i++) if (LIST[i].kind === 3) s++;\n  return String(s);'),
 ('kinds-summed', 'let s = 0;\n  for (let i = 0; i < LIST.length; i++) s += LIST[i].kind;\n  return String(s);'),
 ('kinds-summed-by-for-of', 'let s = 0;\n  for (const node of LIST) s += node.kind;\n  return String(s);'),
 ('kinds-stored', 'for (let i = 0; i < LIST.length; i++) LIST[i].kind = i;\n  return LIST.map(node => String(node.kind)).join();'),
]
n = 0
for place, declarations, holder, taken in places:
    for what, element in contents:
        for use, body in uses:
            name = 'holder.nodes' if taken is None else 'list'
            text = f'''// Made by test/aot/tools/generate-lists-out-of-places.py.
interface Node {{ kind: number; next: Node | null }}
class Other {{ next: Node | null = null; kind: number; constructor(kind: number) {{ this.kind = kind; }} }}
let calls = 0;
{declarations}
function make(): Node[] {{
  const list: Node[] = [];
  for (let i = 0; i < 5; i++) list.push({element});
  return list;
}}
function run(holder: {holder}): string {{
  {(taken + chr(10) + "  ") if taken else ""}{body.replace("LIST", name)}
}}
function safely(): string {{
  try {{
    return run(hold(make())) + " " + calls;
  }} catch (error: any) {{
    return "thrown: " + error.name + " " + calls;
  }}
}}
for (let turn = 0; turn < 3; turn++) console.log(safely());
'''
            open(f'{out}/{place}-{what}-{use}.ts', 'w').write(text); n += 1
print(len(places), 'places,', len(contents), 'contents,', len(uses), 'uses,', n, 'programs')
