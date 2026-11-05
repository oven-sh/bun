# What holds for hashes whatever the seed is.
import sys, collections, functools, fractions, decimal, math, datetime, enum, dataclasses, types

print(sys.hash_info.width, sys.hash_info.modulus, sys.hash_info.inf, sys.hash_info.nan, sys.hash_info.imag, sys.hash_info.algorithm, sys.hash_info.hash_bits, sys.hash_info.seed_bits, sys.hash_info.cutoff)

# ---- full width ----
hashes = [hash(str(i)) for i in range(200000)]
print(len(set(hashes)), max(h.bit_length() for h in hashes) > 56, min(hashes) < 0 < max(hashes), all(-2**63 <= h < 2**63 for h in hashes), -1 in hashes)
hashes = [hash(b'%d' % i) for i in range(200000)]
print(len(set(hashes)), max(h.bit_length() for h in hashes) > 56)
print(sum(bin(h & (2**64 - 1)).count('1') for h in hashes) // len(hashes) in range(30, 35))

# ---- the same text, the same hash ----
texts = ['', 'a', 'abc', 'x' * 100, '\xe9', 'caf\xe9' * 30, '€', 'a€' * 50, '\U0001f600', 'a\U0001f600€' * 40, '\ud800', 'a\udc80']
for t in texts:
    others = [t + '', ''.join(list(t)), (t + '\U0001f600')[:len(t)], ('€' + t)[1:], t.encode('utf-8', 'surrogatepass').decode('utf-8', 'surrogatepass'), '%s' % t, f'{t}', str(t), t[:], t * 1,
              ''.join(reversed(t[::-1])), t.replace('q', 'q'), (t + 'z').rstrip('z') if not t.endswith('z') else t, sys.intern(t + '') if t.isascii() else t]
    print(ascii(t)[:20], all(o == t and hash(o) == hash(t) for o in others), hash(t) == t.__hash__() == str.__hash__(t), hash(t) == hash(t))
print(hash('') == 0, hash(b'') == 0)
print([hash(t) == hash(t.encode('latin-1')) for t in ['a', 'abc', 'x' * 100, '\xe9', 'caf\xe9' * 30]])
for b in [b'', b'a', b'abc' * 50, bytes(range(256))]:
    print(hash(b) == hash(bytes(bytearray(b))) == hash(memoryview(b)) == hash(b[:]) == hash(b + b'') == b.__hash__(), hash(memoryview(b)[:]) == hash(b))
class S(str): pass
class B(bytes): pass
print(hash(S('abc')) == hash('abc'), hash(B(b'abc')) == hash(b'abc'), {S('k'): 1}['k'], {'k': 1}[S('k')], S('k') in {'k'}, 'k' in {S('k')})

# ---- whoever says it is equal to a str, and hashes like it, is found ----
class Like:
    def __init__(self, text): self.text = text
    def __hash__(self): return hash(self.text)
    def __eq__(self, other): return self.text == (other.text if isinstance(other, Like) else other)
    def __repr__(self): return 'Like(%r)' % self.text
for key in ['abc', '', 'x' * 200, '€', '\U0001f600z', 'a']:
    d = {key: 1, 'other': 2}
    print(d[Like(key)], Like(key) in d, d.get(Like(key)), Like(key) in d.keys(), Like(key) in set(d), Like(key) in frozenset(d), Like('nope') in d)
    e = {Like(key): 1, 'other': 2}
    print(e[key], key in e, key in set(e), e.get(key), len({Like(key), key}), len({key, Like(key)}), len({key: 1, Like(key): 2}), {key: 1, Like(key): 2}[key])
    d[Like(key)] = 5
    print(len(d), d[key], type(next(iter(d))).__name__, d.pop(Like(key)), len(d), key in d)
    d.setdefault(key, 7); print(d.setdefault(Like(key), 8), len(d))
ns = types.SimpleNamespace(abc=1)
print(vars(ns)[Like('abc')], Like('abc') in vars(ns))
class C: attr = 1
print(Like('attr') in C.__dict__, C.__dict__[Like('attr')], Like('attr') in vars(C).keys())
g = {'name': 1}
print(eval('name', g), Like('name') in g, Like('__builtins__') in g)
def f(**kw): return kw[Like('a')], Like('b') in kw
print(f(a=1, b=2))

# ---- dicts whose keys are strs, and then are not ----
d = {str(i): i for i in range(1000)}
print(all(d[str(i)] == i for i in range(1000)), '1000' in d, 5 in d)
d[5] = 'five'; d[(1, 'a')] = 'tuple'; d[2.5] = 'float'; d[None] = 'none'; d[b'5'] = 'bytes'
print(all(d[str(i)] == i for i in range(1000)), d[5], d[(1, 'a')], d[2.5], d[None], d[b'5'], d['5'], len(d))
for i in range(0, 1000, 2): del d[str(i)]
print(len(d), all(d[str(i)] == i for i in range(1, 1000, 2)), '0' in d, d[5], list(d)[:3], list(d)[-5:])
c = d.copy(); c.update({'0': 0}); print(len(c), c['0'], c[5], c == d, {**d} == d, dict(d.items()) == d)
s = set(d); print(len(s), '1' in s, 5 in s, (1, 'a') in s, '0' in s, s == set(d.keys()), s == set(list(d)), frozenset(d) == s, hash(frozenset(d)) == hash(frozenset(list(d))))
print(sorted(d.keys() & {'1', '3', 5, 'zz'}, key=repr), sorted({'1', '3', 5, 'zz'} & d.keys(), key=repr), sorted(({'1', '3', 5, 'zz'} - d.keys())), len(d.keys() | {'zz'}), len(d.keys() ^ {'1', 'zz'}))
s = {'a', 'b'}; s.update({'c': 1, 'd': 2}); s ^= {'a': 1, 'z': 2}.keys(); s.symmetric_difference_update({'b': 1, 'y': 2}); print(sorted(s))
s = {'a', 'b', 'c'}; s.intersection_update({'a': 1, 'c': 2, 'q': 3}); print(sorted(s)); s.difference_update({'a': 1}); print(sorted(s))
print(sorted(dict.fromkeys({'a', 'b', 'c'}, 0).items()), sorted(dict.fromkeys(frozenset('xyz'))), dict.fromkeys({'k': 1, 'l': 2}, 0))
od = collections.OrderedDict((str(i), i) for i in range(10)); od.move_to_end('3'); od.move_to_end('7', last=False); od[1] = 'int'; od.move_to_end('0')
print(list(od), od.popitem(), od.popitem(last=False), od.pop('5'), od == dict(od), list(reversed(od)))
print(collections.Counter('abracadabra').most_common(3), collections.Counter(['x', 1, 'x', 1.0, (1,), 'y'])['x'], collections.Counter(['x', 1, 'x', 1.0])[1])
dd = collections.defaultdict(list); [dd[w[0]].append(w) for w in ['apple', 'avocado', 'banana', 'blueberry', 'cherry']]; print(dict(dd))
cm = collections.ChainMap({'a': 1}, {'a': 2, 'b': 3}); print(cm['a'], cm['b'], sorted(cm))
@functools.lru_cache(maxsize=4)
def up(a, b='x', *, c='y'): return a + b + c
print([up('a'), up('a'), up('a', 'b'), up('a', b='b'), up('a', c='z'), up('q'), up('a')], up.cache_info())
@functools.cache
def one(a): return a * 2
print(one('ab'), one('ab'), one(('ab', 1)), one.cache_info())

# ---- the hash of a key is asked for once ----
class Counting:
    calls = 0
    def __init__(self, v): self.v = v
    def __hash__(self): Counting.calls += 1; return hash(self.v)
    def __eq__(self, o): return self.v == o.v
keys = [Counting(str(i)) for i in range(50)]
d = dict.fromkeys(keys); n1 = Counting.calls
s = set(d); n2 = Counting.calls
e = dict(d); e2 = d.copy(); e3 = {**d}; n3 = Counting.calls
fs = frozenset(s); s2 = s.copy(); s3 = s | fs; s4 = set(s); n4 = Counting.calls
d2 = dict.fromkeys(s); d3 = dict.fromkeys(d); n5 = Counting.calls
for i in range(2000): d[Counting('x%d' % i)] = i
n6 = Counting.calls
print(n1, n2 - n1, n3 - n2, n4 - n3, n5 - n4, n6 - n5)

# ---- numbers: equal values, equal hashes ----
P = sys.hash_info.modulus
def hash_fraction(m, n):
    while m % P == n % P == 0: m, n = m // P, n // P
    if n % P == 0: h = sys.hash_info.inf
    else: h = (abs(m) % P) * pow(n, P - 2, P) % P
    if m < 0: h = -h
    return -2 if h == -1 else h
F, D = fractions.Fraction, decimal.Decimal
ints = [0, 1, -1, 2, -2, 10, 255, 2**30, 2**31, 2**32, 2**53, 2**53 + 1, 2**60, 2**61 - 2, 2**61 - 1, 2**61, 2**61 + 1, 2**62, 2**63 - 1, 2**63, 2**64, 2**64 + 1, 2**122 - 2, (2**61 - 1)**2, 10**18, 10**19, 10**30, 10**100, 3**200, 2**1000, 2**1000 - 1]
for i in ints + [-i for i in ints]:
    same = [hash(i) == hash_fraction(i, 1), hash(F(i)) == hash(i), hash(D(i)) == hash(i), hash(complex(i)) == hash(float(i)) if abs(i) < 2**1000 else None, hash(float(i)) == hash(int(float(i))) if abs(i) < 2**1000 else None]
    print(hash(i), same)
floats = [0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 0.1, 1.5, 2.5, 1e10, 1e15, 1e16, 1e22, 1e100, 1e308, 5e-324, 2.2250738585072014e-308, math.pi, -math.e, 1 / 3, 123456789.125, 2.0**61, 2.0**61 - 512, 2.0**62, 2.0**63, 2.0**64, 2.0**1000, float(2**61 - 1)]
for x in floats:
    m, n = x.as_integer_ratio()
    print(repr(x), hash(x), hash(x) == hash_fraction(m, n) == hash(F(x)) == hash(D(x)) == hash(complex(x, 0)), hash(x) == hash(int(x)) if x == int(x) else None)
print(hash(float('inf')), hash(float('-inf')), hash(D('inf')), hash(D('-inf')), hash(complex('inf')), hash(complex(0, float('inf'))), hash(True), hash(False))
for z in [0j, 1j, -1j, 1 + 1j, 1.5 - 2.5j, complex(2**61 - 1, 1), complex(-1, 0), complex(0, -1), complex(1e100, 1e-100), complex(-2, 1000003)]:
    h = (hash(z.real) + sys.hash_info.imag * hash(z.imag)) & (2**64 - 1)
    h = h - 2**64 if h >= 2**63 else h
    print(z, hash(z), hash(z) == (-2 if h == -1 else h))
for q in [F(1, 3), F(-1, 3), F(22, 7), F(1, P), F(P, 3), F(3, P * 2), F(-5, P), F(10**30, 7**30), F(1, 2**100), F(2**100, 3)]:
    print(q if q.denominator < 10**6 and abs(q.numerator) < 10**6 else '...', hash(q), hash(q) == hash_fraction(q.numerator, q.denominator))
for t in ['0', '-0', '1', '1.0', '1.00', '1e2', '100', '0.1', '-0.1', '1.5', '1e-5', '1e30', '1e-30', '123.456', '9.99e99', '1e400', '1e-400', '-1e400']:
    x = D(t); print(t, hash(x), hash(x) == hash(F(x)), hash(x) == hash(float(x)) if D(float(x)) == x else None)
print({1: 'a', 1.0: 'b', True: 'c', F(1): 'd', D(1): 'e', 1 + 0j: 'f'}, len({0, 0.0, -0.0, False, F(0), D(0), 0j, D('-0')}), {2**61 - 1: 1}.get(0), {0: 1}.get(2**61 - 1))
nan = float('nan'); print(hash(nan) == hash(nan), nan in {nan}, float('nan') in {nan}, len({nan, nan}), len({float('nan'), float('nan')}) )

# ---- containers ----
for t in [(), (1,), (1, 2), (1, 2, 3), ((),), ((1,), (2,)), (0,) * 10, tuple(range(100)), (None,), (None, None), (True, False), (1.5, 2**70, -1), (-1,), (-2,), ((-1, -2), -3), (1, (2, (3, (4,))))]:
    print(hash(t))
print(hash((1, 2)) == hash((1.0, 2.0)) == hash((True, 2)), hash(('a', 1)) == hash(('a', 1.0)), hash((1, 2)) != hash((2, 1)))
for s in [frozenset(), frozenset([1]), frozenset([1, 2, 3]), frozenset(range(100)), frozenset([frozenset(), frozenset([1])]), frozenset([(1, 2), 3, None]), frozenset([-1]), frozenset([-2])]:
    print(hash(s))
print(hash(frozenset('abc')) == hash(frozenset('cba')) == hash(frozenset(['a', 'b', 'c', 'a'])), hash(frozenset('abc')) == hash(frozenset(set('abc'))))
print(hash(range(0)), hash(range(5)), hash(range(1, 5)), hash(range(1, 5, 2)), hash(range(1, 6, 2)) == hash(range(1, 5, 2)), hash(range(5, 1)) == hash(range(0)), hash(range(10**30)), hash(range(3, 4, 100)) == hash(range(3, 4)))
print(hash(slice(None)), hash(slice(1)), hash(slice(1, 2)), hash(slice(1, 2, 3)), hash(slice(None, None, -1)), hash(slice((1, 2), 'a'[:0] or None)), hash(slice(1.0, 2)) == hash(slice(1, 2)))
print(hash(None), hash(None) == hash(type(None)()), hash(()) )
for bad in [[], {}, set(), bytearray(), ([],), (1, [2]), frozenset([()]) and slice([]), memoryview(bytearray(b'a')), collections.deque(), collections.OrderedDict(), collections.Counter()]:
    try: print(hash(bad))
    except TypeError as e: print('TypeError', e)
    except ValueError as e: print('ValueError', e)

# ---- classes ----
class Plain: pass
p = Plain(); print(hash(p) == hash(p) == object.__hash__(p) == p.__hash__(), hash(p) != hash(Plain()) , hash(Plain) == type.__hash__(Plain))
class OnlyEq:
    def __eq__(self, o): return True
print(OnlyEq.__hash__)
try: hash(OnlyEq())
except TypeError as e: print(e)
for value in [0, 1, -1, -2, 2**61 - 1, 2**61, 2**63 - 1, 2**63, 2**64, -2**63, -2**63 - 1, 2**100, -2**100, True]:
    class H:
        def __hash__(self): return value
    print(value, hash(H()), H().__hash__() == value)
for value in [1.0, 'a', None, (1,)]:
    class H:
        def __hash__(self): return value
    try: print(hash(H()))
    except TypeError as e: print(e)
class IntSub(int): pass
class H:
    def __hash__(self): return IntSub(5)
print(hash(H()), type(hash(H())).__name__, hash(IntSub(7)), hash(IntSub(-1)), hash(IntSub(2**61)))
class Color(enum.Enum): RED = 1; GREEN = 2
print(hash(Color.RED) == hash('RED'), {Color.RED: 1}[Color.RED], hash(enum.IntEnum('I', 'A B').A))
@dataclasses.dataclass(frozen=True)
class Point: x: int; y: str
print(hash(Point(1, 'a')) == hash((1, 'a')), {Point(1, 'a'): 1}[Point(1, 'a')])
NT = collections.namedtuple('NT', 'a b'); print(hash(NT(1, 'x')) == hash((1, 'x')))
print(hash(datetime.timedelta(1, 2, 3)) == hash((1, 2, 3)), hash(datetime.timedelta(-1)) == hash((-1, 0, 0)), hash(datetime.timezone.utc) == hash(datetime.timedelta(0)), hash(datetime.date(2020, 1, 2)) == hash(b'\x07\xe4\x01\x02'),
      hash(datetime.time(1, 2, 3, 4)) == hash(b'\x01\x02\x03\x00\x00\x04'), hash(datetime.datetime(2020, 1, 2, 3, 4, 5, 6)) == hash(b'\x07\xe4\x01\x02\x03\x04\x05\x00\x00\x06'))
print(hash(len) == hash(len), hash('a'.upper) == hash('a'.upper), hash(p.__init__) == hash(p.__init__), hash(Plain.__init__) == hash(object.__init__))
def fn(): pass
print(hash(fn) == hash(fn), hash(fn.__code__) == hash(fn.__code__), hash(int) == hash(int), hash(types.MappingProxyType({}).__class__) == hash(types.MappingProxyType))
print(hash(list[int]) == hash(list[int]), hash(int | str) == hash(str | int), hash(types.GenericAlias(dict, (str, int))) == hash(dict[str, int]))
