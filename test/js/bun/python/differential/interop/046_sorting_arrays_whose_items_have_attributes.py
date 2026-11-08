# list.sort() empties the list for as long as it sorts. Not an array of JS that cannot be emptied, or whose items are more than values: JS has said of an item
# that it cannot be deleted or written, or has given it a getter, or has forbidden to write the length. Such an array keeps its items while it is sorted and
# has them written one by one afterwards, as by the sort() of JS.
import js

make = {
    'plain': '[3, 1, 2, 5, 4]',
    'one item that cannot be deleted': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 1, { configurable: false }); return a; })()',
    'the first cannot be deleted': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 0, { configurable: false }); return a; })()',
    'the last cannot be deleted': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 4, { configurable: false }); return a; })()',
    'one item that cannot be written': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 2, { writable: false }); return a; })()',
    'one item that is not enumerable': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 2, { enumerable: false }); return a; })()',
    'one item with a getter and a setter': '(() => { const a = [3, 1, 2, 5, 4]; let v = 2; Object.defineProperty(a, 2, { get() { return v; }, set(x) { v = x; } }); return a; })()',
    'one item with a getter only': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, 2, { get() { return 2; } }); return a; })()',
    'sealed': 'Object.seal([3, 1, 2, 5, 4])',
    'frozen': 'Object.freeze([3, 1, 2, 5, 4])',
    'not extensible': 'Object.preventExtensions([3, 1, 2, 5, 4])',
    'a length that cannot be written': '(() => { const a = [3, 1, 2, 5, 4]; Object.defineProperty(a, "length", { writable: false }); return a; })()',
    'sparse once': '(() => { const a = [3, 1, 2, 5, 4]; a[100000] = 0; a.length = 5; return a; })()',
    'shifted': '(() => { const a = [9, 3, 1, 2, 5, 4]; a.shift(); return a; })()',
    'strings, one that cannot be deleted': '(() => { const a = ["c", "a", "b"]; Object.defineProperty(a, 1, { configurable: false }); return a; })()',
    'doubles, one that cannot be deleted': '(() => { const a = [3.5, 1.5, 2.5]; Object.defineProperty(a, 1, { configurable: false }); return a; })()',
    'empty, a length that cannot be written': '(() => { const a = []; Object.defineProperty(a, "length", { writable: false }); return a; })()',
    'one item, which cannot be deleted': '(() => { const a = [1]; Object.defineProperty(a, 0, { configurable: false }); return a; })()',
}


def attempt(function):
    try:
        return repr(function())
    except Exception as error:
        return '%s: %s' % (type(error).__name__, error)


show = js.eval('''(a => JSON.stringify(a) + " " + Object.keys(Object.getOwnPropertyDescriptors(a)).filter(k => k != "length").map(k => {
    const d = Object.getOwnPropertyDescriptor(a, k);
    return (d.get ? "g" : "") + (d.set ? "s" : "") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
}).join(","))''')


class Fails:
    def __init__(self, value): self.value = value
    def __lt__(self, other):
        if self.value == 2 or other.value == 2:
            raise ValueError('no order for 2')
        return self.value < other.value


def seen_by_the_key(a):
    lengths = []
    def key(x):
        lengths.append(len(a))
        return x
    list.sort(a, key=key)
    return sorted(set(lengths))


def grown_by_the_key(a):
    def key(x):
        if x == 5:
            a.append(7)
        return x
    list.sort(a, key=key)


def shrunk_by_the_key(a):
    def key(x):
        if x == 5:
            a.pop()
        return x
    list.sort(a, key=key)


ways = {
    'sort()': lambda a: list.sort(a),
    'sort(key=)': lambda a: list.sort(a, key=lambda x: (x is None, x if isinstance(x, str) else -(x or 0))),
    'sort(reverse=True)': lambda a: list.sort(a, reverse=True),
    'the sort() of JS': lambda a: js.eval('(a => { a.sort(); })')(a),
    'sorted()': lambda a: sorted(a),
    'a comparison raises': lambda a: list.sort(a, key=Fails),
    'a key raises': lambda a: list.sort(a, key=lambda x: 1 // (x - 2)),
    'how long the key finds it': seen_by_the_key,
    'the key appends': grown_by_the_key,
    'the key pops': shrunk_by_the_key,
}
for name, source in make.items():
    print('---', name, '|', show(js.eval(source)))
    for how, sort in ways.items():
        a = js.eval(source)
        print(how, '|', attempt(lambda: sort(a)), '|', show(a))
