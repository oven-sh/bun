# A heap snapshot in V8's form says of every object whether it is a function. It is made while the heap is marked, on several threads.
import gc

import js

snapshot = js.eval("() => Bun.generateHeapSnapshot('v8')")
written = js.eval("() => { const path = process.getBuiltinModule('node:v8').writeHeapSnapshot('/dev/null'); return typeof path }")


class Callable:
    def __call__(self): pass


class Plain:
    pass


# The kinds of the nodes, by name. (The text is long: JS goes through it.)
types_of_nodes = js.eval("""(text, wanted) => {
    const parsed = JSON.parse(text);
    const meta = parsed.snapshot.meta, fields = meta.node_fields, kinds = meta.node_types[0];
    const name = fields.indexOf("name"), type = fields.indexOf("type");
    const found = new Map();
    for (let at = 0; at < parsed.nodes.length; at += fields.length) {
        const key = parsed.strings[parsed.nodes[at + name]];
        if (!wanted(key))
            continue;
        if (!found.has(key))
            found.set(key, new Set());
        found.get(key).add(kinds[parsed.nodes[at + type]]);
    }
    return [...found].map(([key, set]) => [key, [...set].sort()]);
}""")


kept = []
for i in range(1000):
    cls = type('C%d' % i, (Callable if i % 2 else Plain,), {})
    # Names that nothing refers to any more but what remembers where they were looked for.
    try:
        eval('cls.name_%d' % i)
    except AttributeError:
        pass
    kept.append(cls())
gc.collect()
more = ['x%d' % i for i in range(20000)]
gc.collect()

proxy = js.eval('globalThis.keptProxies = [new Proxy(function () {}, {}), new Proxy({}, {})]')

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

# A rope stays one, though it is the name of other nodes.
js.eval("""
globalThis.part = String(Date.now()).slice(0, 3);
globalThis.Named = function () {};
Named.displayName = "ROPE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + part + "_bbbbbbbbbbbbbbbbbbbbbbbbb";
globalThis.named = [new Named(), new Named()];
""")

# (One snapshot for all: a debug build takes a quarter of a minute for each.)
names = ('ProxyObject', 'PyInstance', 'Function', 'Object', 'Array')
wanted = js.eval('(names) => (name) => names.includes(name) || (name.startsWith("ROPE_") && name.length > 60)')(list(names))
found = {str(name): [str(kind) for kind in kinds] for name, kinds in types_of_nodes(snapshot(), wanted)}
for name in names:
    print(name, [kind for kind in found.get(name, []) if kind != 'string'])
print([kinds for name, kinds in found.items() if name.startswith('ROPE_')])
print(asked)
print(written(), asked)
# And they are what they were.
print(sum(callable(o) for o in kept), callable(kept[0]), callable(kept[1]))
kind = js.eval('(o) => typeof o')
print(kind(kept[0]), kind(kept[1]))
print(kind(odd), kind(odd_callable), asked)
# (How often it is asked then depends on what else has been looked up.)
print(js.eval('(o) => o()')(odd_callable), sorted(set(asked)))
