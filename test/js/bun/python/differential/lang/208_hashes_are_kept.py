# What a dict or a set knows of the hashes of its keys goes with the keys into a new set or dict: __hash__ is not asked again.
class K:
    count = 0
    def __init__(self, value, hash_value=None):
        self.value = value
        self.hash_value = hash(value) if hash_value is None else hash_value
    def __hash__(self):
        K.count += 1
        return self.hash_value
    def __eq__(self, other):
        return isinstance(other, K) and self.value == other.value
    def __repr__(self):
        return 'K(%r)' % (self.value,)

def asked(label, f):
    K.count = 0
    result = f()
    print(label, K.count, sorted(map(repr, result)) if result is not None else None)
    return result

keys = [K(i) for i in range(5)]
d = asked('dict', lambda: dict.fromkeys(keys, 1))
fd = frozendict(d)
s = asked('set(list)', lambda: set(keys))
fs = frozenset(s)
for source, name in ((d, 'dict'), (fd, 'frozendict'), (s, 'set'), (fs, 'frozenset'), (d.keys(), 'keys')):
    asked('set(%s)' % name, lambda: set(source))
    asked('frozenset(%s)' % name, lambda: frozenset(source))
    asked('dict.fromkeys(%s)' % name, lambda: dict.fromkeys(source))
    asked('update %s' % name, lambda: (lambda x: x.update(source) or x)(set()))
    asked('union %s' % name, lambda: set().union(source))
    asked('difference %s' % name, lambda: s.difference(source))
    asked('difference_update %s' % name, lambda: (lambda x: x.difference_update(source) or x)(set(s)))
    asked('intersection %s' % name, lambda: s.intersection(source))
    asked('symmetric_difference %s' % name, lambda: s.symmetric_difference(source))
    asked('symmetric_difference_update %s' % name, lambda: (lambda x: x.symmetric_difference_update(source) or x)(set(s)))
    asked('isdisjoint %s' % name, lambda: [s.isdisjoint(source)])
    asked('issuperset %s' % name, lambda: [s.issuperset(source)])
asked('dict(dict)', lambda: dict(d))
asked('d.copy()', lambda: d.copy())
asked('d | d', lambda: d | d)
asked('{**d}', lambda: {**d})
asked('update', lambda: (lambda x: x.update(d) or x)({}))
asked('s.copy()', lambda: s.copy())
asked('s | s', lambda: s | s)
asked('s & s', lambda: s & s)
asked('s - s', lambda: s - s)
asked('s ^ s', lambda: s ^ s)
asked('{*s}', lambda: {*s})
class D(dict): pass
class St(set): pass
asked('set(subclass of dict)', lambda: set(D(d)))
asked('set(subclass of set)', lambda: set(St(s)))
asked('fromkeys of a subclass', lambda: D.fromkeys(d))

# Hashes of every size.
values = [0, 1, -1, -2, 2**31 - 1, 2**31, 2**32 - 1, 2**32, 2**32 + 1, -2**31, -2**32, 2**60, -2**60, 2**61 - 2, 2**63 - 1, -2**63]
wide = [K(i, h) for i, h in enumerate(values)]
wd = {k: i for i, k in enumerate(wide)}
print([wd[k] for k in wide], len(wd))
print(all(K(i, h) in wd for i, h in enumerate(values)), K(0, 1) in wd, K(99, 2**32) in wd)
ws = set(wd)
print(len(ws), all(k in ws for k in wide), sorted(k.value for k in ws))
print([hash(k) for k in wide])
# Two keys whose hashes differ only above 32 bits are never compared.
class Loud(K):
    __hash__ = K.__hash__
    def __eq__(self, other):
        print('  compared', self.value, other.value)
        return super().__eq__(other)
a, b = Loud('a', 5), Loud('b', 5 + 2**32)
print(len({a: 1, b: 2}), len({a, b}), b in {a}, b in {a: 1})
c = Loud('c', 5)
print(len({a: 1, c: 2}), c in {a})
# A dict of str keys that gets another kind of key, and loses it again.
m = {'a': 1, 'b': 2}
m[K(1, 2**40)] = 3
m[2**40] = 4
m[-1] = 5
m[1.5] = 6
m[(1, 2)] = 7
print(list(m.values()), m['a'], m[K(1, 2**40)], m[2**40], m[-1], m[1.5], m[(1, 2)])
del m[K(1, 2**40)], m[2**40]
m['c'] = 8
print(list(m.items()))
big = {str(i): i for i in range(1000)}
big[K('x', -2**62)] = 'x'
print(len(big), big['999'], big[K('x', -2**62)], sum(v for v in big.values() if isinstance(v, int)))
# The order of a set of small ints, and of ints that collide.
print(list({3, 1, 2}), list({8, 16, 0}), list({2**32, 0, 1}), list({-1, -2, 1}), list(set(range(20, 0, -3))))
print(list({'a': 1, 1: 2, None: 3}), list(dict.fromkeys([1, 'a', 1.0, True, 'a'])))
