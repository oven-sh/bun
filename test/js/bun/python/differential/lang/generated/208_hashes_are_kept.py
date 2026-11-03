# What a dict or a set knows of the hashes of its keys goes with the keys into a new set or dict: __hash__ is not asked again.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')

try:
    def asked(label, f):
        K.count = 0
        result = f()
        print(label, K.count, sorted(map(repr, result)) if result is not None else None)
        return result
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def asked(label, f):')

try: keys = [K(i) for i in range(5)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: keys = [K(i) for i in range(5)]')
try: d = asked('dict', lambda: dict.fromkeys(keys, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: d = asked('dict', lambda: dict.fromkeys(keys, 1))")
try: fd = frozendict(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fd = frozendict(d)')
try: s = asked('set(list)', lambda: set(keys))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: s = asked('set(list)', lambda: set(keys))")
try: fs = frozenset(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs = frozenset(s)')
try:
    for source, name in ((d, 'dict'), (fd, 'frozendict'), (s, 'set'), (fs, 'frozenset'), (d.keys(), 'keys')):
        try: asked('set(%s)' % name, lambda: set(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('set(%s)' % name, lambda: set(source))")
        try: asked('frozenset(%s)' % name, lambda: frozenset(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('frozenset(%s)' % name, lambda: frozenset(source))")
        try: asked('dict.fromkeys(%s)' % name, lambda: dict.fromkeys(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('dict.fromkeys(%s)' % name, lambda: dict.fromkeys(source))")
        try: asked('update %s' % name, lambda: (lambda x: x.update(source) or x)(set()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('update %s' % name, lambda: (lambda x: x.update(source) or x)(s...")
        try: asked('union %s' % name, lambda: set().union(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('union %s' % name, lambda: set().union(source))")
        try: asked('difference %s' % name, lambda: s.difference(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('difference %s' % name, lambda: s.difference(source))")
        try: asked('difference_update %s' % name, lambda: (lambda x: x.difference_update(source) or x)(set(s)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('difference_update %s' % name, lambda: (lambda x: x.difference_...")
        try: asked('intersection %s' % name, lambda: s.intersection(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('intersection %s' % name, lambda: s.intersection(source))")
        try: asked('symmetric_difference %s' % name, lambda: s.symmetric_difference(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('symmetric_difference %s' % name, lambda: s.symmetric_differenc...")
        try: asked('symmetric_difference_update %s' % name, lambda: (lambda x: x.symmetric_difference_update(source) or x)(set(s)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('symmetric_difference_update %s' % name, lambda: (lambda x: x.s...")
        try: asked('isdisjoint %s' % name, lambda: [s.isdisjoint(source)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('isdisjoint %s' % name, lambda: [s.isdisjoint(source)])")
        try: asked('issuperset %s' % name, lambda: [s.issuperset(source)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('issuperset %s' % name, lambda: [s.issuperset(source)])")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for source, name in ((d, 'dict'), (fd, 'frozendict'), (s, 'set'), (fs...")
try: asked('dict(dict)', lambda: dict(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('dict(dict)', lambda: dict(d))")
try: asked('d.copy()', lambda: d.copy())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('d.copy()', lambda: d.copy())")
try: asked('d | d', lambda: d | d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('d | d', lambda: d | d)")
try: asked('{**d}', lambda: {**d})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('{**d}', lambda: {**d})")
try: asked('update', lambda: (lambda x: x.update(d) or x)({}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('update', lambda: (lambda x: x.update(d) or x)({}))")
try: asked('s.copy()', lambda: s.copy())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('s.copy()', lambda: s.copy())")
try: asked('s | s', lambda: s | s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('s | s', lambda: s | s)")
try: asked('s & s', lambda: s & s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('s & s', lambda: s & s)")
try: asked('s - s', lambda: s - s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('s - s', lambda: s - s)")
try: asked('s ^ s', lambda: s ^ s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('s ^ s', lambda: s ^ s)")
try: asked('{*s}', lambda: {*s})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('{*s}', lambda: {*s})")
try:
    class D(dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(dict): pass')
try:
    class St(set): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class St(set): pass')
try: asked('set(subclass of dict)', lambda: set(D(d)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('set(subclass of dict)', lambda: set(D(d)))")
try: asked('set(subclass of set)', lambda: set(St(s)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('set(subclass of set)', lambda: set(St(s)))")
try: asked('fromkeys of a subclass', lambda: D.fromkeys(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked('fromkeys of a subclass', lambda: D.fromkeys(d))")

# Hashes of every size.
try: values = [0, 1, -1, -2, 2**31 - 1, 2**31, 2**32 - 1, 2**32, 2**32 + 1, -2**31, -2**32, 2**60, -2**60, 2**61 - 2, 2**63 - 1, -2**63]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: values = [0, 1, -1, -2, 2**31 - 1, 2**31, 2**32 - 1, 2**32, 2**32 + 1...')
try: wide = [K(i, h) for i, h in enumerate(values)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wide = [K(i, h) for i, h in enumerate(values)]')
try: wd = {k: i for i, k in enumerate(wide)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wd = {k: i for i, k in enumerate(wide)}')
try: print('[wd[k] for k in wide] =>', [wd[k] for k in wide])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [wd[k] for k in wide]')
try: print('len(wd) =>', len(wd))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(wd)')
try: print('all(K(i, h) in wd for i, h in enumerate(values)) =>', all(K(i, h) in wd for i, h in enumerate(values)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(K(i, h) in wd for i, h in enumerate(values))')
try: print('K(0, 1) in wd =>', K(0, 1) in wd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K(0, 1) in wd')
try: print('K(99, 2**32) in wd =>', K(99, 2**32) in wd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K(99, 2**32) in wd')
try: ws = set(wd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ws = set(wd)')
try: print('len(ws) =>', len(ws))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ws)')
try: print('all(k in ws for k in wide) =>', all(k in ws for k in wide))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(k in ws for k in wide)')
try: print('sorted(k.value for k in ws) =>', sorted(k.value for k in ws))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k.value for k in ws)')
try: print([hash(k) for k in wide])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [hash(k) for k in wide]')
# Two keys whose hashes differ only above 32 bits are never compared.
try:
    class Loud(K):
        __hash__ = K.__hash__
        def __eq__(self, other):
            print('  compared', self.value, other.value)
            return super().__eq__(other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Loud(K):')
try: a, b = Loud('a', 5), Loud('b', 5 + 2**32)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: a, b = Loud('a', 5), Loud('b', 5 + 2**32)")
try: print('len({a: 1, b: 2}) =>', len({a: 1, b: 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({a: 1, b: 2})')
try: print('len({a, b}) =>', len({a, b}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({a, b})')
try: print('b in {a} =>', b in {a})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b in {a}')
try: print('b in {a: 1} =>', b in {a: 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b in {a: 1}')
try: c = Loud('c', 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c = Loud('c', 5)")
try: print('len({a: 1, c: 2}) =>', len({a: 1, c: 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({a: 1, c: 2})')
try: print('c in {a} =>', c in {a})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c in {a}')
# A dict of str keys that gets another kind of key, and loses it again.
try: m = {'a': 1, 'b': 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: m = {'a': 1, 'b': 2}")
try: m[K(1, 2**40)] = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[K(1, 2**40)] = 3')
try: m[2**40] = 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[2**40] = 4')
try: m[-1] = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[-1] = 5')
try: m[1.5] = 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[1.5] = 6')
try: m[(1, 2)] = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[(1, 2)] = 7')
try: print('list(m.values()) =>', list(m.values()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(m.values())')
try: print("m['a'] =>", m['a'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: m['a']")
try: print('m[K(1, 2**40)] =>', m[K(1, 2**40)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[K(1, 2**40)]')
try: print('m[2**40] =>', m[2**40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[2**40]')
try: print('m[-1] =>', m[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[-1]')
try: print('m[1.5] =>', m[1.5])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[1.5]')
try: print('m[(1, 2)] =>', m[(1, 2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[(1, 2)]')
try: del m[K(1, 2**40)], m[2**40]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del m[K(1, 2**40)], m[2**40]')
try: m['c'] = 8
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: m['c'] = 8")
try: print(list(m.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(m.items())')
try: big = {str(i): i for i in range(1000)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: big = {str(i): i for i in range(1000)}')
try: big[K('x', -2**62)] = 'x'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: big[K('x', -2**62)] = 'x'")
try: print('len(big) =>', len(big))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(big)')
try: print("big['999'] =>", big['999'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: big['999']")
try: print("big[K('x', -2**62)] =>", big[K('x', -2**62)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: big[K('x', -2**62)]")
try: print('sum(v for v in big.values() if isinstance(v, int)) =>', sum(v for v in big.values() if isinstance(v, int)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(v for v in big.values() if isinstance(v, int))')
# The order of a set of small ints, and of ints that collide.
try: print('list({3, 1, 2}) =>', list({3, 1, 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({3, 1, 2})')
try: print('list({8, 16, 0}) =>', list({8, 16, 0}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({8, 16, 0})')
try: print('list({2**32, 0, 1}) =>', list({2**32, 0, 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({2**32, 0, 1})')
try: print('list({-1, -2, 1}) =>', list({-1, -2, 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({-1, -2, 1})')
try: print('list(set(range(20, 0, -3))) =>', list(set(range(20, 0, -3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(set(range(20, 0, -3)))')
try: print("list({'a': 1, 1: 2, None: 3}) =>", list({'a': 1, 1: 2, None: 3}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: list({'a': 1, 1: 2, None: 3})")
try: print("list(dict.fromkeys([1, 'a', 1.0, True, 'a'])) =>", list(dict.fromkeys([1, 'a', 1.0, True, 'a'])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: list(dict.fromkeys([1, 'a', 1.0, True, 'a']))")
