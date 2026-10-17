#!/usr/bin/env python3
"""other-build-time-walkers.py <folder>: Other walkers of the engine that the build's evaluation of texts may reach, 60 places each: the build must end."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
d = '.' + '/'
def program(make, use, n=60): return make + '\n' + '\n'.join('export function f%d() { return new RegExp("%d" + %s); }' % (i, i, use) for i in range(n)) + '\nconsole.log("done", typeof f0);\n'
arrays = 'let shared = [1];\nfor (let i = 0; i < 40; i++) shared = [shared, shared];'
open(d+'t1_typed_array_plus.mjs','w').write(program('const shared = new Float64Array(1 << 24);', 'shared'))
open(d+'t2_typed_array_stringify.mjs','w').write(program('const shared = new Float64Array(1 << 24);', 'JSON.stringify(shared)'))
open(d+'t3_getters.mjs','w').write(program('let shared = { leaf: 1 };\nfor (let i = 0; i < 40; i++) { const held = shared; shared = { get a() { return held; }, get b() { return held; } }; }', 'JSON.stringify(shared)'))
open(d+'t4_toJSON.mjs','w').write(program('let shared = { leaf: 1 };\nfor (let i = 0; i < 40; i++) { const held = shared; shared = { toJSON() { return [held, held]; } }; }', 'JSON.stringify(shared)'))
open(d+'t5_flat.mjs','w').write(program(arrays, 'shared.flat(Infinity).length'))
open(d+'t6_sort.mjs','w').write(program(arrays + '\nconst list = [shared, shared, shared];', 'list.sort().length'))
open(d+'t7_proxy.mjs','w').write(program('let shared = { leaf: 1 };\nfor (let i = 0; i < 40; i++) shared = new Proxy({ a: shared, b: shared }, {});', 'JSON.stringify(shared)'))
open(d+'t8_a_maps_values.mjs','w').write(program(arrays + '\nconst map = new Map([["k", shared]]);', 'Array.from(map.values()).join()'))
