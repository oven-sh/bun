import pickle, _pickle, io, collections, decimal, fractions, datetime, enum, functools, operator, array, copyreg, sys

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e, getattr(e, '__notes__', None), type(e.__context__).__name__)

print(pickle.Pickler is _pickle.Pickler, pickle.Unpickler is _pickle.Unpickler, pickle.dumps is _pickle.dumps, pickle.loads is _pickle.loads, pickle.PicklingError is _pickle.PicklingError)
print(sorted(n for n in dir(_pickle) if not n.startswith('__')))
print(_pickle.__doc__)

class C:
    def __init__(self, a=1): self.a = a
    def __eq__(self, o): return type(o) is type(self) and o.__dict__ == self.__dict__
    def __repr__(self): return 'C(%r)' % (self.__dict__,)
class S:
    __slots__ = ('x', 'y')
    def __eq__(self, o): return type(o) is S and o.x == self.x
class SD(S):
    pass
class L(list): pass
class D(dict): pass
class T(tuple): pass
class I(int): pass
class F(float): pass
class St(str): pass
class B(bytes): pass
class Nested:
    class Inner:
        class Deep: pass
        def meth(self): pass
        @staticmethod
        def sm(): pass
        @classmethod
        def cm(cls): pass
class E(enum.Enum):
    A = 1
    B = 'b'
class NA:
    def __init__(self, a, b): self.a, self.b = a, b
    def __getnewargs__(self): return (self.a, self.b)
    def __new__(cls, a, b): return object.__new__(cls)
class NAX:
    def __new__(cls, a, *, k): 
        o = object.__new__(cls); o.a = a; o.k = k; return o
    def __getnewargs_ex__(self): return ((self.a,), {'k': self.k})
class GS:
    def __getstate__(self): return {'z': 1}
    def __setstate__(self, s): self.s = s
class R6:
    def __init__(self): self.v = []
    def __reduce__(self): return (R6, (), {'st': 1}, iter([1, 2]), iter([('k', 'v')]), setter)
    def append(self, x): self.v.append(x)
    def extend(self, x): self.v.extend(x)
    def __setitem__(self, k, v): self.v.append((k, v))
def setter(o, s): o.state = s
def func(): pass
NT = collections.namedtuple('NT', 'a b')

shared = [1, 2]
rec_l = []; rec_l.append(rec_l)
rec_d = {}; rec_d['self'] = rec_d
rec_t = ([],); rec_t[0].append(rec_t)
rec_c = C(); rec_c.me = rec_c
s1 = SD(); s1.x = 1; s1.y = 2; s1.z = 3
s0 = S(); s0.x = 5
values = [
    None, True, False, 0, 1, -1, 255, 256, 65535, 65536, -256, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**32, 2**53, 2**63, -2**63, 2**64, 10**30, -10**30, 2**2040, -(2**2040), 127, 128, -128, -129, 32767, 32768, -32768, -32769,
    0.0, -0.0, 1.0, 1.5, -1.5, 1e100, 1e-100, float('inf'), float('-inf'), 3.141592653589793, 5e-324,
    '', 'a', 'abc', 'x' * 255, 'x' * 256, 'é', '中文', '\U0001f600', 'a\nb', 'a\\b', 'a\rb\x00c\x1ad', '\ud800', '\udfff x', "it's", '"q"', '\x7f\x80\xff',
    b'', b'a', b'abc', b'x' * 255, b'x' * 256, bytes(range(256)), bytearray(), bytearray(b'abc'), bytearray(range(256)),
    (), (1,), (1, 2), (1, 2, 3), (1, 2, 3, 4), ((),), ((1,), (2,)), [], [1], [1, 2], [[]], [[], []], list(range(10)), {}, {'a': 1}, {'a': 1, 'b': 2}, {1: {2: {3: {}}}}, {(1, 2): [3]},
    set(), {1}, frozenset(), frozenset({1}), [set(), frozenset()],
    [shared, shared], (shared, shared), {'a': shared, 'b': shared}, ['ab', 'ab'],
    rec_l, rec_d, rec_t, rec_c,
    C(), C([1, 2]), [C(), C()], s0, s1, L([1, 2]), D(a=1), T((1, 2)), I(5), F(1.5), St('s'), B(b'b'), NT(1, 2), E.A, E.B, NA(1, 2), NAX(1, k=2), GS(), R6(),
    int, str, list, dict, type, object, C, Nested, Nested.Inner, Nested.Inner.Deep, type(None), type(...), type(NotImplemented), ..., NotImplemented,
    len, print, func, Nested.Inner.meth, Nested.Inner.sm, Nested.Inner.cm, [].append.__self__.__class__, operator.add, functools.partial(int, base=2), collections.OrderedDict, collections.OrderedDict(a=1, b=2),
    collections.deque([1, 2], 5), collections.defaultdict(list, a=[1]), collections.Counter('aab'), decimal.Decimal('1.50'), fractions.Fraction(1, 3), 1 + 2j, range(1, 10, 2), slice(1, 2, 3),
    datetime.date(2020, 1, 2), datetime.datetime(2020, 1, 2, 3, 4, 5, 6), datetime.timedelta(1, 2, 3), array.array('i', [1, 2, 3]), 'abc'.upper, [1, 2].count, C(3).__eq__,
    ValueError('x', 1), KeyError('k'), OSError(2, 'msg'), StopIteration(3), Exception(), UnicodeDecodeError('utf-8', b'x', 0, 1, 'r'), pickle.PicklingError('p'),
    iter([1, 2, 3]), iter((1, 2)), iter('ab'), reversed([1, 2]), iter({1: 2}), iter({1}), sys.flags.__class__ and 1,
]
def norm(b):
    return b
for proto in range(pickle.HIGHEST_PROTOCOL + 1):
    print('protocol', proto)
    for v in values:
        try:
            d = pickle.dumps(v, proto)
        except BaseException as e:
            print(type(e).__name__, e, getattr(e, '__notes__', None))
            continue
        print(d)
