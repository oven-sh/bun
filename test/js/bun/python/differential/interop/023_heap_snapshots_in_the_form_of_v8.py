# A heap snapshot in V8's form says of every object whether it is a function. It is made while the heap is marked, on several threads.
import gc
import json

import js

snapshot = js.eval("() => Bun.generateHeapSnapshot('v8')")
written = js.eval("() => { const path = process.getBuiltinModule('node:v8').writeHeapSnapshot('/dev/null'); return typeof path }")


class Callable:
    def __call__(self): pass


class Plain:
    pass


def types_of_nodes(text):
    parsed = json.loads(text)
    meta = parsed['snapshot']['meta']
    fields, kinds = meta['node_fields'], meta['node_types'][0]
    nodes, strings = parsed['nodes'], parsed['strings']
    found = {}
    for at in range(0, len(nodes), len(fields)):
        name = strings[nodes[at + fields.index('name')]]
        found.setdefault(name, set()).add(kinds[nodes[at + fields.index('type')]])
    return found


kept = []
for i in range(4000):
    cls = type('C%d' % i, (Callable if i % 2 else Plain,), {})
    # Names that nothing refers to any more but what remembers where they were looked for.
    try:
        eval('cls.name_%d' % i)
    except AttributeError:
        pass
    kept.append(cls())
gc.collect()
more = ['x%d' % i for i in range(100000)]
gc.collect()

proxy = js.eval('globalThis.keptProxies = [new Proxy(function () {}, {}), new Proxy({}, {})]')
found = types_of_nodes(str(snapshot()))
for name in ('ProxyObject', 'PyInstance', 'Function', 'Object', 'Array'):
    print(name, sorted(found.get(name, set()) - {'string'}))
print(written())
# And they are what they were.
print(sum(callable(o) for o in kept), callable(kept[0]), callable(kept[1]))
print(js.eval('(o) => typeof o')(kept[0]), js.eval('(o) => typeof o')(kept[1]))

# To ask whether an object can be called runs nothing of the program: not the __eq__ of a key that is no str, in the dict of a class.
asked = []


class Key:
    def __hash__(self): return hash('__call__')

    def __eq__(self, other):
        asked.append(other)
        gc.collect()
        return False


Odd = type('Odd', (), {Key(): 1})
OddCallable = type('OddCallable', (), {Key(): 1, '__call__': lambda self: 'called'})
odd, odd_callable = Odd(), OddCallable()
asked.clear()
print(len(str(snapshot())) > 1000, asked)
kind = js.eval('(o) => typeof o')
print(kind(odd), kind(odd_callable), asked)
print(js.eval('(o) => o()')(odd_callable), asked)

# A rope stays one, though it is the name of other nodes.
js.eval("""
globalThis.part = String(Date.now()).slice(0, 3);
globalThis.Named = function () {};
Named.displayName = "ROPE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + part + "_bbbbbbbbbbbbbbbbbbbbbbbbb";
globalThis.named = [new Named(), new Named()];
""")
found = types_of_nodes(str(snapshot()))
print(sorted(sorted(kinds) for name, kinds in found.items() if name.startswith('ROPE_') and len(name) > 60))
