import json, _json, json.encoder, decimal, collections, enum, fractions, math

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e, getattr(e, '__notes__', None))

print(json.encoder.c_make_encoder is _json.make_encoder, json.encoder.encode_basestring is _json.encode_basestring, json.encoder.encode_basestring_ascii is _json.encode_basestring_ascii)

strings = ['', 'a', 'abc', '"', '\\', '/', '\b\f\n\r\t', '\x00\x01\x1f\x7f', '\x80\xff', '\u0100', '\u2028\u2029', '\ud800', '\udfff', '\U0001f600', 'a\U0001f600b', '\U0010ffff', 'a"b\\c', ' ~', '\u00e9\u4e2d', 'x' * 100 + '"', '\ude00\ud83d']
for s in strings:
    print(ascii(_json.encode_basestring(s)), _json.encode_basestring_ascii(s), json.encoder.py_encode_basestring(s) == _json.encode_basestring(s), json.encoder.py_encode_basestring_ascii(s) == _json.encode_basestring_ascii(s))
class S(str):
    def __str__(self): return 'STR'
    def __repr__(self): return 'REPR'
print(_json.encode_basestring(S('a"')), _json.encode_basestring_ascii(S('\u00e9')), type(_json.encode_basestring(S('a'))))
for f in (_json.encode_basestring, _json.encode_basestring_ascii):
    show(f)
    show(f, 1)
    show(f, None)
    show(f, b'x')
    show(f, 'a', 'b')
    show(f, pystr='a')

class I(int):
    def __repr__(self): return 'IREPR'
    def __str__(self): return 'ISTR'
class F(float):
    def __repr__(self): return 'FREPR'
    def __str__(self): return 'FSTR'
class L(list): pass
class T(tuple): pass
class D(dict): pass
class E(enum.IntEnum):
    A = 1
class FE(float, enum.Enum):
    X = 1.5
class SE(str, enum.Enum):
    Y = 'y'
NT = collections.namedtuple('NT', 'a b')
values = [None, True, False, 0, 1, -1, 10**20, -10**30, 2**53, 2**53 + 1, 1.0, -1.0, 0.0, -0.0, 1.5, 1e100, 1e-100, 1e16, 1e15, 123456789.123456789, 0.1, 1/3, 5e-324, 1.7976931348623157e308,
          float('inf'), float('-inf'), float('nan'), 'x', '\u00e9', '\U0001f600', [], (), {}, [1], (1,), [1, 2], [[]], [{}], {'a': 1}, {'a': {'b': [1, {'c': None}]}}, [None, True, False],
          I(5), F(1.5), F('inf'), S('s'), L([1]), T((1,)), D(a=1), E.A, FE.X, SE.Y, NT(1, 2), collections.OrderedDict(b=1, a=2), collections.defaultdict(int, x=1), collections.Counter('aab'),
          {1: 1}, {1.5: 1}, {True: 1}, {False: 0}, {None: 1}, {I(5): 1}, {F(1.5): 1}, {S('k'): 1}, {E.A: 1}, {10**20: 1}, {float('inf'): 1}, {float('nan'): 1}, {-0.0: 1}, {1: 1, '1': 2}, {'b': 1, 'a': 2},
          frozendict(a=1) if 'frozendict' in dir(__builtins__) else {'a': 1}, [1.0, 2, 3.5], {'\u00e9': '\u00e9'}, {'"': '"'}, ['\n'], {'k': ()}, {'k': []}, {'k': {}}, [[], [], {}], [[1, 2], [3, 4]], range(0) and 0]
options = [{}, {'indent': 2}, {'indent': 0}, {'indent': '\t'}, {'indent': ''}, {'indent': '--'}, {'sort_keys': True}, {'ensure_ascii': False}, {'separators': (',', ':')}, {'separators': (' , ', ' : ')},
           {'indent': 1, 'separators': (',', ':')}, {'indent': 3, 'sort_keys': True, 'ensure_ascii': False}, {'check_circular': False}, {'check_circular': False, 'indent': 2}, {'skipkeys': True}, {'indent': True}, {'indent': -1}]
for o in options:
    print(o)
    for v in values:
        show(json.dumps, v, **o)
for v in [float('inf'), float('-inf'), float('nan'), [1, float('nan')], {'a': float('inf')}, {float('nan'): 1}, F('nan'), {'a': [F('inf')]}]:
    show(json.dumps, v, allow_nan=False)

bad = [object, 1j, b'x', bytearray(b'x'), {1, 2}, frozenset(), decimal.Decimal('1.5'), fractions.Fraction(1, 2), range(3), iter([]), len, ..., NotImplemented, memoryview(b''), collections.deque([1]), collections.UserDict(a=1), collections.UserList([1]),
       [1, [2, {1, 2}]], {'a': {'b': b'x'}}, (1, (2, 1j)), {'a': [1, {'b': (1, object)}]}, L([1j]), D(a=1j), NT(1, 1j), collections.OrderedDict(a=1j)]
for v in bad:
    show(json.dumps, v)
    show(json.dumps, v, indent=2)
badkeys = [{(1, 2): 1}, {b'x': 1}, {1j: 1}, {frozenset(): 1}, {object: 1}, {decimal.Decimal(1): 1}, {'a': {(1,): 2}}, [{(): 1}], {'a': 1, (1,): 2, 'b': 3}, {(1,): 1, (2,): 2}]
for v in badkeys:
    show(json.dumps, v)
    show(json.dumps, v, skipkeys=True)
    show(json.dumps, v, skipkeys=True, indent=1)
    show(json.dumps, v, sort_keys=True)
show(json.dumps, {1: 1, 'a': 2}, sort_keys=True)
show(json.dumps, {1: 1, 2.5: 2, True: 3}, sort_keys=True)
show(json.dumps, {None: 1, 'a': 2}, sort_keys=True)
show(json.dumps, {'b': 1, 'a': {'d': 1, 'c': 2}}, sort_keys=True)
show(json.dumps, {'a': 1, 'a2': 2, 'A': 3, '': 4, '\u00e9': 5}, sort_keys=True)

# default
def default(o):
    if isinstance(o, set): return sorted(o)
    if isinstance(o, complex): return {'re': o.real, 'im': o.imag}
    if isinstance(o, bytes): return o.decode()
    if o is Ellipsis: return ...
    if o is object: raise KeyError('default')
    raise TypeError('cannot: %r' % (o,))
for v in [{1, 2}, 1j, b'x', [{3}, {'a': 2j}], {'k': {1}}, 1.5, range(2), [range(2)], object, [[object]], {'a': {'b': object}}]:
    show(json.dumps, v, default=default)
    show(json.dumps, v, default=default, indent=1)
show(json.dumps, ..., default=default)
show(json.dumps, [...], default=default)
show(json.dumps, ..., default=default, check_circular=False) if False else None
show(json.dumps, 1j, default=5)
show(json.dumps, 1j, default=lambda o: o.real)
show(json.dumps, 1j, default=lambda: 1)
show(json.dumps, 1j, default=str)
show(json.dumps, {1j: 1}, default=str)
class Enc(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, complex): return [o.real, o.imag]
        return super().default(o)
show(json.dumps, [1j, {'a': 2j}], cls=Enc)
show(json.dumps, [1j, {'a': b''}], cls=Enc)
show(Enc(indent=1).encode, [1j])
show(lambda: list(Enc().iterencode([1j, {'a': 1}])))

# Circular references
l = []; l.append(l)
d = {}; d['d'] = d
l2 = [[]]; l2[0].append(l2)
d2 = {'a': [1]}; d2['a'].append(d2)
for v in (l, d, l2, d2, [l], {'x': d}):
    show(json.dumps, v)
    show(json.dumps, v, indent=1)
shared = [1]
show(json.dumps, [shared, shared, {'a': shared}])
def circ(o): return [o]
show(json.dumps, 1j, default=circ)
for v in (l, d):
    try:
        json.dumps(v, check_circular=False)
    except RecursionError as e:
        print('RecursionError')

# Deep nesting
def nest(n):
    x = []
    for i in range(n): x = [x]
    return x
print(len(json.dumps(nest(500))), len(json.dumps(nest(200), indent=1)))
def nestd(n):
    x = {}
    for i in range(n): x = {'k': x}
    return x
print(len(json.dumps(nestd(500))))
for f in (nest, nestd):
    try:
        json.dumps(f(200000))
        print('no error')
    except RecursionError:
        print('RecursionError')
for s in ('[' * 200000 + ']' * 200000, '{"a":' * 200000 + '1' + '}' * 200000, '[' * 200000):
    try:
        json.loads(s)
        print('no error')
    except RecursionError:
        print('RecursionError')
print(len(json.loads('[' * 500 + ']' * 500)))

# dict subclasses and their items()
class D2(dict):
    def items(self): return [('x', 1), ('y', 2)]
class D3(dict):
    def items(self): return iter([('x', 1)])
class D4(dict):
    def items(self): return [1]
class D5(dict):
    def items(self): return 5
class D6(dict):
    def items(self): return [('x', 1, 2)]
class D7(dict):
    def items(self): return [['x', 1]]
class D8(dict):
    def items(self): raise KeyError('items')
class D9(dict):
    items = None
for c in (D2, D3, D4, D5, D6, D7, D8, D9):
    show(json.dumps, c(a=1))
    show(json.dumps, c())
    show(json.dumps, c(a=1), sort_keys=True)

# Mutation while encoding
class Mut:
    pass
lst = [Mut(), 2, 3]
def dm(o):
    lst.clear()
    return 'm'
show(json.dumps, lst, default=dm)
dct = {'a': Mut(), 'b': 2}
def dm2(o):
    dct.clear()
    return 'm'
show(json.dumps, dct, default=dm2)

# make_encoder itself
me = _json.make_encoder
show(me)
show(me, 1, 2, 3)
show(me, 1, 2, 3, 4, 'a', 'b', 1, 1, 1)
show(me, None, 2, 3, 4, 5, 'b', 1, 1, 1)
show(me, None, 2, 3, 4, 'a', None, 1, 1, 1)
show(me, None, 2, 3, 4, 'a', b'b', 1, 1, 1)
show(me, None, 2, 3, 4, 'a', 'b', 1, 1, 1, 1)
show(me, [], 2, 3, 4, 'a', 'b', 1, 1, 1)
show(lambda: type(me({}, 2, 3, 4, 'a', 'b', 1, 1, 1)))
show(lambda: type(me(markers=None, default=None, encoder=None, indent=None, key_separator=':', item_separator=',', sort_keys=0, skipkeys=0, allow_nan=0)))
e = me({}, repr, _json.encode_basestring, None, ': ', ', ', False, True, True)
print(e.markers, e.default is repr, e.encoder is _json.encode_basestring, e.indent, e.key_separator, e.item_separator, e.sort_keys, e.skipkeys, hasattr(e, 'allow_nan'))
show(e, [1, 'a', {'b': 1j}], 0)
show(e, [1], 5)
show(e)
show(e, 1)
show(e, 1, 'a')
show(e, 1, None)
show(e, 1, 2**70)
show(e, 1, 0, 0)
show(e, obj=1, _current_indent_level=0)
show(e, 1, foo=0)
show(setattr, e, 'indent', 1)
e = me(None, repr, lambda s: '<' + s + '>', '  ', ': ', ', ', False, False, True)
show(e, ['a', {'b': 'c'}], 0)
show(e, ['a', {'b': 'c'}], 2)
show(e, ['a', {'b': 'c'}], -1)
e = me(None, repr, lambda s: 5, None, ': ', ', ', False, False, True)
show(e, ['a'], 0)
show(e, {'a': 1}, 0)
show(e, {1: 1}, 0)
e = me(None, repr, lambda s: S('q'), None, S(':'), S(','), False, False, True)
show(e, ['a', 'b', {'c': 1}], 0)
e = me(None, repr, _json.encode_basestring_ascii, 5, ':', ',', False, False, True)
show(e, [1], 0)
show(e, 1, 0)
show(e, [], 0)
show(e, [1], 1)
e = me(None, repr, _json.encode_basestring_ascii, S('>'), ':', S(','), False, False, True)
show(e, [1, [2, 3]], 1)
try:
    class Sub(_json.make_encoder): pass
    print('subclassed')
except TypeError as ex:
    print('TypeError', ex)

# dump, iterencode, big ints
import io
o = io.StringIO(); json.dump([1, {'a': 'b'}], o, indent=1); print(repr(o.getvalue()))
print(list(json.JSONEncoder().iterencode({'a': [1, 2]})))
show(lambda: len(json.dumps(10 ** 4299)))
show(json.dumps, 10 ** 4300)
show(json.dumps, [10 ** 4300])
show(json.dumps, {10 ** 4300: 1})
# round trips
for v in [1.1, 1e22, 1e23, 2**63, -2**63, 0.30000000000000004, 1e-7, 123456789012345678]:
    print(json.dumps(v), json.loads(json.dumps(v)) == v)
