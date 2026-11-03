# What is written does not depend on reference counts here: versions below 3, and values CPython has only one of.
import marshal
def name(v):
    # The order in which a set shows its items depends on their hashes.
    if isinstance(v, (set, frozenset)):
        return type(v).__name__ + repr(sorted(v, key=repr))
    return repr(v)[:40]
def show(v, version):
    try:
        print(version, name(v), marshal.dumps(v, version))
    except ValueError as e:
        print(version, name(v), 'ValueError', e)

I = int
for version in (0, 1, 2):
    for v in (None, True, False, ..., StopIteration, 0, 1, -1, 1000, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**15, 2**30, 2**45, 2**60, 2**64, -(2**64), 10**30,
              0.0, -0.0, 1.0, 1.5, -2.25, 1e100, 1e-7, 0.1, 1/3, 123456789012345678.0, float('inf'), float('-inf'), float('nan'),
              1j, 1.5 - 2j, complex(0.1, 1e22),
              '', 'a', 'abc', 'é', '€', '😀', '\ud800', 'x' * 300,
              b'', b'a', b'abc', (), (1,), (1, 'a', None), tuple(range(260)), [], [1, [2]], {}, {1: 2, 'a': (3,)},
              set(), {1}, {3, 1, 2}, {'b', 'a', 'c'}, frozenset(), frozenset({2, 1}), {1, 'a', 2.5, None, (1,), b'x'},
              bytearray(b'ab'), slice(1, 2), frozendict()):
        show(v, version)

# From version 3 on: what there is only one of is always numbered.
for version in (3, 4, 5, 6, 7, 100, -1):
    for v in (None, True, ..., 0, 1, -5, 1024, '', 'a', 'é', '\xff', b'', b'a', ()):
        show(v, version)
# Whether CPython numbers anything else depends on how many references there are to it: one, for what is made on the spot.
T = tuple
for version in (3, 4, 5, 6):
    print(version, marshal.dumps(T([0, 0]), version), marshal.dumps(T([1, 1, 1]), version), marshal.dumps(T(['a', 'a']), version), marshal.dumps(T(['', '']), version))
    print(version, marshal.dumps(T([(), ()]), version), marshal.dumps(T([b'', b'']), version), marshal.dumps(T([b'a', b'a', b'b']), version))
    print(version, marshal.dumps([0, 1, 0, 1], version), marshal.dumps({0: 0}, version), marshal.dumps({1, 0}, version), marshal.dumps(frozenset({0}), version))
    print(version, marshal.dumps([I('7000'), I('7') ** 30, float('1.5'), complex('1j'), bytes([1, 2]), ''.join(['a', ' b']), [I('1')], {I('2'): I('3')}], version))
    print(version, marshal.dumps({I('7000'), I('7001')}, version), marshal.dumps({float('1.5')}, version), marshal.dumps({T([I('7000')])}, version), marshal.dumps({bytes([1, 2])}, version))
    print(version, marshal.dumps([{I('7000')}, {I('7001')}], version), marshal.dumps(frozenset([frozenset([I('7000')])]), version))

# Interned strs (names in the source are).
for version in (3, 4, 6):
    for v in ('abc', 'marshal', 'show'):
        show(v, version)
    print(version, marshal.dumps(T(['abc', 'abc']), version), marshal.dumps(['abc', 'x', 'abc', 'x'], version))
import sys
s = sys.intern('not a name ' + str(1))
for version in (2, 3, 4):
    show(s, version)
    print(version, marshal.dumps(T([s, s]), version))
s = sys.intern('é' * 2 + str(1))
for version in (2, 3, 4):
    show(s, version)
    print(version, marshal.dumps([s, s], version))
s = sys.intern('y' * 300)
for version in (3, 4):
    print(version, marshal.dumps(s, version)[:8], len(marshal.dumps(s, version)), marshal.dumps(T([s, s]), version)[-6:])

# The same object twice.
def twice(make):
    for version in (2, 3, 4, 6):
        x = make()
        try:
            print(version, marshal.dumps(T([x, x]), version), marshal.dumps([x, [x]], version))
        except ValueError as e:
            print(version, 'ValueError', e)
twice(lambda: [I('7000')])
twice(lambda: (I('7000'), I('7001')))
twice(lambda: {I('7000'): None})
twice(lambda: I('7') ** 40)
twice(lambda: ''.join(['not', ' interned']))
twice(lambda: bytes([1, 2, 3]))
twice(lambda: {I('7000')})
twice(lambda: frozenset([I('7000')]))
twice(lambda: slice(I('7000'), None))
twice(lambda: frozendict({I('7000'): None}))
twice(lambda: complex('1+2j'))
twice(lambda: bytearray(b'abc'))
