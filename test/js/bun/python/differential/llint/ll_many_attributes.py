# Instances with few and with many attributes: what is set in __init__, in other methods, by bases, from outside, in any order,
# and what becomes of it when the class, the __dict__ or the list of names the compiler has made is changed.
import copy
import gc
import pickle
import weakref


def make(count, bases=(), prefix='a', extra=''):
    lines = ['class K(*bases):', '    def __init__(self, start=0):']
    if bases:
        lines.append('        super().__init__(start)')
    for i in range(count):
        lines.append(f'        self.{prefix}{i} = start + {i}')
    lines.append('        pass')
    lines.append(extra)
    scope = {'bases': bases}
    exec('\n'.join(lines), scope)
    return scope['K']


def show(tag, obj):
    d = vars(obj)
    print(tag, len(d), list(d)[:3], list(d)[-3:], sum(v for v in d.values() if isinstance(v, int)))


print('--- counts')
for count in (0, 1, 5, 6, 7, 8, 9, 15, 16, 17, 29, 30, 31, 32, 59, 60, 61, 62, 63, 64, 65, 100, 300):
    K = make(count)
    print(count, len(K.__static_attributes__), sorted(K.__static_attributes__)[:2])
    o = K(10)
    total = 0
    for i in range(count):
        total += getattr(o, f'a{i}')
    print(' read', total)
    o.later = 1
    o.later2 = 2
    for i in range(0, count, 3):
        delattr(o, f'a{i}')
    o.a0 = 'again'
    print(' names', len(dir(o)) - len(dir(object())), o.later, o.later2, o.a0)
    show(' vars', o)
    p = K(1)
    show(' other', p)

print('--- read and written by the same lines')
kinds = [make(n) for n in (1, 7, 12, 40, 70)]
objects = [K(i) for i, K in enumerate(kinds)] * 3
for round in range(3):
    total = 0
    for o in objects:
        total += o.a0
        o.a0 = total
        o.fresh = round
    print(round, total, [o.fresh for o in objects[:5]])

print('--- bases')
A = make(10, prefix='a')
B = make(10, (A,), prefix='b')
C = make(10, (B,), prefix='c')
c = C(100)
show('C', c)
print(c.a9, c.b9, c.c9, len(C.__static_attributes__), len(B.__static_attributes__))
L = make(9, prefix='l')
R = make(9, prefix='r')


class Both(L, R):
    def __init__(self):
        L.__init__(self, 1)
        R.__init__(self, 2)
        self.own = 3

    def other(self):
        self.set_elsewhere = 4
        self.l0 = 'shared name'


b = Both()
show('Both', b)
b.other()
show('Both', b)
print(sorted(Both.__static_attributes__))

print('--- set in another order, and in part')


class Part:
    def __init__(self, which):
        if which & 1:
            self.p0 = 0; self.p1 = 1; self.p2 = 2; self.p3 = 3
        if which & 2:
            self.q0 = 0; self.q1 = 1; self.q2 = 2; self.q3 = 3
        if which & 4:
            self.r0 = 0; self.r1 = 1; self.r2 = 2; self.r3 = 3
        if not which & 1:
            self.p3 = 30; self.p2 = 20; self.p1 = 10; self.p0 = 0


for which in range(8):
    o = Part(which)
    print(which, list(vars(o)), o.p3)

print('--- __slots__ with a __dict__')


class Slotted:
    __slots__ = ('s0', 's1', 's2', '__dict__', '__weakref__')

    def __init__(self):
        self.s0 = 0; self.s1 = 1; self.s2 = 2
        self.d0 = 0; self.d1 = 1; self.d2 = 2; self.d3 = 3; self.d4 = 4; self.d5 = 5; self.d6 = 6; self.d7 = 7; self.d8 = 8


class SlottedChild(Slotted):
    __slots__ = ('t0',)

    def __init__(self):
        super().__init__()
        self.t0 = 'slot'
        self.e0 = 'dict'


for K in (Slotted, SlottedChild):
    o = K()
    print(K.__name__, list(vars(o)), o.s2, o.d8, sorted(K.__static_attributes__)[:4])
    del o.s1
    try:
        o.s1
    except AttributeError as e:
        print(' ', e)
    r = weakref.ref(o)
    print(' ', r() is o)


class OnlySlots:
    __slots__ = tuple(f's{i}' for i in range(40))

    def __init__(self):
        for i in range(40):
            setattr(self, f's{i}', i)
        try:
            self.other = 1
        except AttributeError as e:
            print(type(e).__name__)


o = OnlySlots()
print(o.s0, o.s39, OnlySlots.__static_attributes__)

print('--- __class__')
Small = make(2)
Big = make(40)
s, g = Small(1), Big(2)
s.__class__ = Big
g.__class__ = Small
show('small as Big', s)
show('big as Small', g)
for i in range(50):
    setattr(s, f'n{i}', i)
    setattr(g, f'n{i}', i)
show('small as Big', s)
show('big as Small', g)
print(type(s).__name__, s.a1, s.n49, g.a39, g.n49)
Big.__init__(s, 5)
Small.__init__(g, 6)
show('small as Big', s)
show('big as Small', g)

print('--- __dict__')
o = Big(3)
d = o.__dict__
d['a39'] = 'through the dict'
d['new'] = 1
d[5] = 'no name'
print(o.a39, o.new, len(d), d is o.__dict__)
o.a0 = 'through the object'
print(d['a0'])
del o.a1
print('a1' in d)
o.__dict__ = {'only': 1}
print(vars(o), hasattr(o, 'a0'))
Big.__init__(o)
show('again', o)
o = Big()
o.__dict__.clear()
print(vars(o))
Big.__init__(o, 7)
show('again', o)

print('--- copies')
Module = make(35)
Module.__module__ = __name__
Module.__qualname__ = 'Module'
o = Module(4)
o.more = [1, 2]
for name, other in (('copy', copy.copy(o)), ('deepcopy', copy.deepcopy(o)), ('pickle', pickle.loads(pickle.dumps(o)))):
    show(name, other)
    print(' ', other.more, other.more is o.more, type(other) is Module)

print('--- what the compiler has listed is only a hint')
for listed in (None, 5, (), ('x',), ('x',) * 1000, tuple(f'n{i}' for i in range(5000)), (1, None, b'x', ('t',)), ['a', 'b'], 'abc', {'a': 1}):
    T = type('T', (), {'__static_attributes__': listed})
    o = T()
    for i in range(70):
        setattr(o, f'v{i}', i)
    shown = repr(T.__static_attributes__)
    print(shown[:40], len(vars(o)), o.v0, o.v69)


class StrangeTuple(tuple):
    def __len__(self):
        raise RuntimeError('not asked')

    def __iter__(self):
        raise RuntimeError('not asked')

    def __getitem__(self, i):
        raise RuntimeError('not asked')


class StrangeStr(str):
    def __hash__(self):
        raise RuntimeError('not asked')

    def __eq__(self, other):
        raise RuntimeError('not asked')


T = type('T', (), {'__static_attributes__': StrangeTuple(('a', 'b'))})
o = T(); o.a = 1; print(vars(o))
T = type('T', (), {'__static_attributes__': (StrangeStr('a'), StrangeStr('b'))})
o = T(); o.a = 1; print(vars(o))

K = make(20)
del K.__static_attributes__
o = K(); show('deleted', o)
K = make(20)
K.__static_attributes__ = ()
o = K(); show('emptied', o)
K = make(2)
first = K()
K.__static_attributes__ = tuple(f'z{i}' for i in range(50))
second = K()
for o in (first, second):
    for i in range(50):
        setattr(o, f'z{i}', i)
    show('changed late', o)

print('--- classes derived from built-in types')
for base in (list, dict, int, str, tuple, set, Exception, object):
    scope = {}
    exec('class D(base):\n    def fill(self):\n' + '\n'.join(f'        self.f{i} = {i}' for i in range(12)), {'base': base}, scope)
    o = scope['D']()
    o.fill()
    o.fill()
    show(base.__name__, o)

print('--- many of them, while the collector runs')


class Node:
    def __init__(self, i, before):
        self.i = i; self.before = before; self.n2 = [i]; self.n3 = (i,); self.n4 = str(i); self.n5 = {i: i}; self.n6 = i * 2
        self.n7 = [i, i]; self.n8 = float(i); self.n9 = None; self.n10 = self; self.n11 = 'x' * (i % 7); self.n12 = i + 12


node = None
for i in range(20000):
    node = Node(i, node if i % 100 else None)
    if i % 5000 == 0:
        gc.collect()
gc.collect()
count = total = 0
while node:
    assert node.n10 is node and node.n2 == [node.i] and node.n5 == {node.i: node.i} and node.n7[1] == node.i
    total += node.n12 + len(node.n11) + int(node.n4)
    count += 1
    node = node.before
print(count, total)

print('--- an instance is asked for while the order of the bases is being worked out')


class Before0:
    pass


class EarlyMeta(type):
    def mro(cls):
        for make in (lambda: object.__new__(cls), lambda: cls(), lambda: cls.__new__(cls), lambda: super(EarlyMeta, cls).__call__(), lambda: setattr(Before0(), '__class__', cls)):
            try:
                print('made', make())
            except (TypeError, AttributeError) as e:
                print(type(e).__name__, e)
        return type.mro(cls)


class Early(metaclass=EarlyMeta):
    def __init__(self):
        self.e0 = 0; self.e1 = 1; self.e2 = 2; self.e3 = 3; self.e4 = 4; self.e5 = 5; self.e6 = 6; self.e7 = 7; self.e8 = 8


show('Early', Early())


class EarlyList(list, metaclass=EarlyMeta):
    pass


print(EarlyList([1]))

print('--- names that a slot or a property takes')


class Taken:
    __slots__ = tuple(f's{i}' for i in range(20)) + ('__dict__',)

    def __init__(self):
        for i in range(20):
            setattr(self, f's{i}', i)
        self.s0 = 'slot'; self.s1 = 'slot'; self.s19 = 'slot'
        self.p0 = 'through the property'; self.p1 = 'through the property'
        self.d0 = 'dict'; self.d1 = 'dict'

    p0 = property(lambda self: self._p0, lambda self, value: setattr(self, '_p0', value))
    p1 = property(lambda self: self._p1, lambda self, value: setattr(self, '_p1', value))


o = Taken()
print(vars(o), o.s0, o.s2, o.s19, o.p0, o.p1, sorted(Taken.__static_attributes__))

print('--- the first instance of a class comes about by an assignment to __class__, and a key in its dict is no str')
acts = [None]


class ActingKey:
    def __hash__(self):
        return hash('a')

    def __eq__(self, other):
        act, acts[0] = acts[0], None
        if act:
            act()
        return False


class Before:
    pass


for label, act in (('adds', lambda o: setattr(o, 'y', 2)), ('asks for the dict', lambda o: o.__dict__.__setitem__('y', 3))):
    Target = type('Target', (), {ActingKey(): 1, '__static_attributes__': ('a',)})
    o = Before()
    o.x = 1
    o.__class__ = Target
    acts[0] = lambda: act(o)
    d = o.__dict__
    asked = acts[0] is None
    acts[0] = None
    print(label, d is o.__dict__, d.get('x'), d.get('y') if asked else 'not asked', getattr(o, 'y', None) == d.get('y'))

print('--- more names than an object has room for')
for count in (49, 50, 51, 52, 53, 59, 60, 61, 62, 63, 64, 70):
    K = make(count)
    o = K(1)
    o.extra = 'x'
    print(count, sum(getattr(o, f'a{i}') for i in range(count)), o.extra, len(vars(o)))
    S = type('S', (), {'__slots__': tuple(f's{i}' for i in range(count)) + ('__dict__',)})
    o = S()
    for i in range(count):
        setattr(o, f's{i}', i)
    for i in range(10):
        setattr(o, f'd{i}', i)
    print('  slots', sum(getattr(o, f's{i}') for i in range(count)), len(vars(o)))
