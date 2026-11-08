#!/usr/bin/env python3
# generate-classes-read-early.py <folder>: all 246; ../parallel/classes-read-early/ holds 0 of them: a class exported by each kind of edge, read by each kind of road WHILE ITS MODULE HAS BEGUN AND NOT FINISHED (a ring), and once more behind its statement. One deed a program; the reference is `bun <file>`.
import os, sys
root = sys.argv[1]
body = '{\n  run() {\n    return 1;\n  }\n}'
edges = {   # name: (what the holder writes, the module that the reader imports, what lies between, the exported name, the way from the namespace to the holder's)
    'a-class-exported-where-it-is-declared': ('export class C ' + body, './holder.mjs', None, 'C', ''),
    'a-class-exported-by-a-list': ('class C ' + body + '\nexport { C };', './holder.mjs', None, 'C', ''),
    'a-class-exported-under-another-name': ('class Inner ' + body + '\nexport { Inner as C };', './holder.mjs', None, 'C', ''),
    'a-class-exported-as-the-default': ('export default class C ' + body, './holder.mjs', None, 'default', ''),
    'a-class-without-a-name-exported-as-the-default': ('export default class ' + body, './holder.mjs', None, 'default', ''),
    'a-class-expression-exported-in-a-const': ('export const C = class ' + body + ';', './holder.mjs', None, 'C', ''),
    'a-class-exported-again-by-name': ('export class C ' + body, './middle.mjs', 'export { C } from "./holder.mjs";', 'C', ''),
    'a-class-exported-again-by-a-star': ('export class C ' + body, './middle.mjs', 'export * from "./holder.mjs";', 'C', ''),
    'a-class-exported-again-inside-a-namespace': ('export class C ' + body, './middle.mjs', 'export * as inner from "./holder.mjs";', 'C', '.inner'),
}
roads = {   # name: (takes the namespace, the expression)
    'a-binding': (False, 'typeof Read'),
    'a-member-of-the-namespace': (True, 'typeof all{way}.{name}'),
    'a-computed-name': (True, 'typeof all{way}[key]'),
    'reflect-get': (True, 'typeof Reflect.get(all{way}, key)'),
    'a-descriptor': (True, 'typeof Object.getOwnPropertyDescriptor(all{way}, key).value'),
    'the-values-of-the-namespace': (True, 'Object.values(all{way}).length'),
    'a-spread-of-the-namespace': (True, 'Object.keys({{ ...all{way} }}).length'),
    'the-in-operator': (True, 'key in all{way}'),
}
def write(folder, name, text):
    os.makedirs(folder, exist_ok=True); open(os.path.join(folder, name), 'w').write(text + '\n')
count = 0
for edge, (definition, path, middle, name, way) in edges.items():
    for road, (takesNamespace, expression) in roads.items():
        folder = os.path.join(root, edge + '-is-read-early-through-' + road)
        if takesNamespace: head = 'import * as all from "%s";' % path
        elif way: head = 'import { inner } from "%s";' % path; expression = 'typeof inner.' + name
        elif name == 'default': head = 'import Read from "%s";' % path
        else: head = 'import { %s as Read } from "%s";' % (name, path)
        write(folder, 'main.mjs', '// The holder has begun and not finished while what it imports runs, and that reads the class back: the binding is in its dead zone.\nimport "./holder.mjs";')
        write(folder, 'holder.mjs', 'import { look } from "./early.mjs";\n' + definition + '\nconsole.log("behind:", look());')
        write(folder, 'early.mjs', head + '\nconst key = ["%s"].join("");\nexport function look() {\n  try {\n    return String(%s);\n  } catch (error) {\n    return error.constructor.name;\n  }\n}\nconsole.log("early:", look(), key.length);' % (name, expression.format(way=way, name=name)))
        if middle: write(folder, 'middle.mjs', middle)
        count += 1
for edge, (definition, path, middle, name, way) in edges.items():
    if middle: continue
    local = {'a-class-exported-under-another-name': 'Inner', 'a-class-without-a-name-exported-as-the-default': None}.get(edge, 'C')
    folder = os.path.join(root, edge + '-is-read-early-through-its-own-namespace')
    write(folder, 'main.mjs', '// The module reads its own namespace in front of the statement of the class.\nimport * as self from "./main.mjs";\nconst key = ["%s"].join("");\nfunction look() {\n  try {\n    return typeof self[key];\n  } catch (error) {\n    return error.constructor.name;\n  }\n}\nconsole.log("early:", look());\nconsole.log("side effect in front of the class");\n%s\nconsole.log("behind:", look());' % (name, definition))
    count += 1
print(count, 'programs')
