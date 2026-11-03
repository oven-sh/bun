import marshal, sys, math

def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

print(marshal.version, sorted(n for n in dir(marshal) if not n.startswith('__')))

values = [
    None, True, False, Ellipsis, StopIteration,
    0, 1, -1, 5, 255, 256, 1024, 1025, -5, -6, 32767, 32768, -32768, 65535, 65536,
    2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**32, 2**45, 2**53 - 1, 2**53, 2**53 + 1, -2**53, 2**62, 2**63 - 1, 2**63, -2**63, 2**64,
    2**100, -2**100, 3**200, -(7**333), 10**1000, (1 << 15) - 1, 1 << 15, 1 << 30, (1 << 30) - 1, 1 << 60, (1 << 75) + 12345,
    0.0, -0.0, 1.0, -1.0, 1.5, 2.0, 1e100, 1e-100, 5e-324, 1.7976931348623157e308, math.pi, float('inf'), float('-inf'), 3.0e10, 123456789.0,
    0j, 1j, -1j, 1.5 + 2.5j, complex(-0.0, -0.0), complex(float('inf'), 1), 2 + 0j,
    '', 'a', 'abc', 'a b', 'x' * 255, 'x' * 256, 'x' * 1000, 'é', 'éa', '\xff', 'Ā', '€uro', '😀', 'a😀b', '\ud800', '\udfff', 'a\ud83dz', '\x00', 'nul\x00nul', '\x7f', '\x80',
    b'', b'a', b'ab', b'\x00\xff', bytes(range(256)), b'x' * 1000,
    (), (1,), (1, 2), (None,), ((),), ((1, (2, (3,))),), tuple(range(255)), tuple(range(256)), tuple(range(300)),
    [], [1], [1, [2, [3]]], [None, True, 'x', b'y', 1.5], list(range(300)),
    {}, {1: 2}, {'a': 1, 'b': [2]}, {(1, 2): {3: 4}}, {None: None}, {1.5: 'x', 'y': 2.5},
    set(), {1}, {1, 2, 3}, {'a', 'b', 'c'}, {(1, 2), (3,)}, {1, 'a', 2.5, None, (1,)},
    frozenset(), frozenset({1}), frozenset({'x', 'y'}), frozenset({frozenset({1}), frozenset()}),
    slice(None), slice(1), slice(1, 2), slice(1, 2, 3), slice('a', (1,), [2]), slice(None, None, -1),
    frozendict(), frozendict(a=1), frozendict({1: frozendict({2: 3})}),
]
for version in range(0, 8):
    bad = 0
    for v in values:
        try:
            d = marshal.dumps(v, version)
        except ValueError as e:
            print(version, 'cannot dump', repr(v)[:40], e)
            continue
        r = marshal.loads(d)
        same = type(r) is type(v) and (repr(r) == repr(v))
        if isinstance(v, (set, frozenset)):
            same = type(r) is type(v) and r == v
        if not same:
            bad += 1
            print(version, 'MISMATCH', repr(v)[:60], repr(r)[:60])
    print('version', version, 'bad', bad)

n = marshal.loads(marshal.dumps(float('nan')))
print(n != n, type(n))
n = marshal.loads(marshal.dumps(float('nan'), 1))
print(n != n, type(n))
print(math.copysign(1, marshal.loads(marshal.dumps(-0.0))), math.copysign(1, marshal.loads(marshal.dumps(-0.0, 0))))

# bytes-like objects are written as bytes
for v in (bytearray(b'abc'), memoryview(b'abc'), bytearray(), memoryview(bytearray(b'xy'))):
    for version in (0, 2, 4, 6):
        print(marshal.loads(marshal.dumps(v, version)), end=' ')
print()
import array
print(marshal.loads(marshal.dumps(array.array('B', [1, 2, 3]))), marshal.loads(marshal.dumps(array.array('H', [1, 2]))))

# Subclasses are not written.
class I(int): pass
class F(float): pass
class S(str): pass
class B(bytes): pass
class T(tuple): pass
class L(list): pass
class D(dict): pass
class St(set): pass
class C(complex): pass
for v in (I(1), F(1.5), S('x'), T((1,)), L([1]), D(), St(), C(1), object(), len, t, type, int, NotImplemented, range(3), iter([]), [object()], (1, [2, {3: len}]), {len: 1}, {1: len}, {print}, Exception, StopIteration(), ValueError):
    t(marshal.dumps, v)
t(marshal.loads, marshal.dumps(B(b'sub')))
