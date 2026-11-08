# A class changes: every class derived from it answers anew, whatever it had been asked before, however many ways lead
# to it and however deep it lies.

def asked(classes, name):
    return [getattr(c, name, 'none') for c in classes]

# A lattice: each level has two classes, and each of them derives from both of the level above. The ways from Base to
# the last level double with every level.
def lattice(levels):
    class Base: pass
    rows = [(Base,)]
    a = b = Base
    for i in range(levels):
        bases = (a,) if a is b else (a, b)
        a, b = type('A%d' % i, bases, {}), type('B%d' % i, bases, {})
        rows.append((a, b))
    return Base, [c for row in rows for c in row]

for levels in (1, 2, 5, 30, 200):
    Base, classes = lattice(levels)
    instances = [c() for c in classes]
    print(levels, len(classes), set(asked(classes, 'x')), set(asked(instances, 'x')))
    Base.x = 1
    print(levels, set(asked(classes, 'x')), set(asked(instances, 'x')))
    Base.x = 2
    print(levels, set(asked(classes, 'x')), set(asked(instances, 'x')))
    middle = classes[len(classes) // 2]
    middle.x = 3
    print(levels, middle.__name__, sorted(set(asked(classes, 'x'))), asked(classes, 'x').count(3), asked(instances, 'x').count(3))
    del middle.x
    print(levels, set(asked(classes, 'x')))
    del Base.x
    print(levels, set(asked(classes, 'x')), set(asked(instances, 'x')))
    # What the interpreter looks up by itself. (CPython goes every way there is for these, so not for the tall ones.)
    if levels > 5:
        continue
    try:
        print(len(instances[-1]))
    except TypeError as e:
        print(e)
    Base.__len__ = lambda self: 7
    print(levels, {len(o) for o in instances}, {bool(o) for o in instances})
    Base.__len__ = lambda self: 0
    print(levels, {len(o) for o in instances}, {bool(o) for o in instances})
    Base.__bool__ = lambda self: True
    print(levels, {bool(o) for o in instances})
    del Base.__len__, Base.__bool__
    print(levels, {bool(o) for o in instances}, {hasattr(o, '__len__') for o in instances})
    Base.__getattr__ = lambda self, name: name.upper()
    print(levels, {o.y for o in instances})
    del Base.__getattr__
    print(levels, set(asked(instances, 'y')))
    Base.__init__ = lambda self, *a: setattr(self, 'made', len(a))
    print(levels, {c(1, 2).made for c in classes})
    del Base.__init__
    Base.__call__ = lambda self: 'called'
    print(levels, {o() for o in instances}, {callable(o) for o in instances})
    del Base.__call__
    print(levels, {callable(o) for o in instances})

# A chain. With the MRO that Python makes, a chain of n classes takes n * n / 2 entries; this metaclass keeps each at two,
# so a class at the end finds nothing of Root's, but is told of every change all the same.
class Short(type):
    def mro(cls):
        return [cls, object]

for depth in (10, 3000):
    class Root(metaclass=Short): pass
    c = Root
    for i in range(depth):
        c = Short('C', (c,), {})
    print(depth, getattr(c, 'x', 'none'), getattr(Root, 'x', 'none'))
    Root.x = 1
    print(depth, getattr(c, 'x', 'none'), Root.x)
    Root.__len__ = lambda self: 3
    print(depth, len(Root()), hasattr(c(), '__len__'))
    del Root.x, Root.__len__
    print(depth, getattr(Root, 'x', 'none'))

# A chain with the MROs that Python makes.
class Root: pass
chain = [Root]
for i in range(400):
    chain.append(type('C%d' % i, (chain[-1],), {}))
print(set(asked(chain, 'x')))
Root.x = 1
print(set(asked(chain, 'x')))
chain[200].x = 2
print(asked(chain, 'x').count(1), asked(chain, 'x').count(2))
del chain[200].x
print(set(asked(chain, 'x')))

# Two classes, each with the other in an MRO of its own making, and each derived from the other by __bases__.
class Loop(type):
    other = None
    def mro(cls):
        return [cls] + ([Loop.other] if Loop.other else []) + [object]
class P(metaclass=Loop): pass
Loop.other = P
class Q(metaclass=Loop): pass
Loop.other = Q
class Holder(metaclass=Loop): pass
P.__bases__ = (Holder,)
print([c.__name__ for c in P.__mro__], [c.__name__ for c in Q.__mro__])
print(getattr(P, 'x', 'none'), getattr(Q, 'x', 'none'))
Q.x = 1
print(getattr(P, 'x', 'none'), getattr(Q, 'x', 'none'))
P.x = 2
print(getattr(P, 'x', 'none'), getattr(Q, 'x', 'none'))
del Q.x
print(getattr(P, 'x', 'none'), getattr(Q, 'x', 'none'))
del P.x
print(getattr(P, 'x', 'none'), getattr(Q, 'x', 'none'))

# Classes that have died, and classes that come while the others are asked.
import gc
Base, classes = lattice(6)
kept = classes[:5]
del classes
gc.collect()
Base.x = 1
print(set(asked(kept, 'x')), len(Base.__subclasses__()))
late = type('Late', (kept[-1], kept[-2]), {})
print(late.x)
Base.x = 2
print(late.x, set(asked(kept, 'x')))

# __bases__ moves a part of a lattice under another class.
Base, classes = lattice(8)
class Other: x = 'other'
Base.x = 'base'
print(set(asked(classes, 'x')))
classes[1].__bases__ = (Other,)
print(sorted(set(asked(classes, 'x'))), asked(classes, 'x').count('other'))
Base.x = 'base again'
print(sorted(set(asked(classes, 'x'))), asked(classes, 'x').count('other'))
Other.x = 'other again'
print(sorted(set(asked(classes, 'x'))), asked(classes, 'x').count('other again'))

# __bases__: whose mro() is called, and in which order. A class comes once for each way that leads to it.
class Log(type):
    calls = []
    fails = None
    def mro(cls):
        Log.calls.append(cls.__name__)
        if Log.fails == (cls.__name__, Log.calls.count(cls.__name__)):
            raise ValueError('no MRO for ' + cls.__name__)
        return super().mro()
class X(metaclass=Log): pass
class Y(metaclass=Log): pass
class A(X): pass
class B(A): pass
class C(A): pass
class D(B, C): pass
class E(D): pass
class F(C): pass
class G(E, F): pass
every = (A, B, C, D, E, F, G)
def names():
    return [''.join(k.__name__[0] for k in c.__mro__) for c in every]
print(names())
Log.calls.clear()
A.__bases__ = (Y,)
print(Log.calls, names())
for fails in (('A', 1), ('D', 1), ('D', 2), ('G', 1), ('G', 3), ('F', 1), ('G', 4), ('G', 5)):
    Log.calls.clear()
    Log.fails = fails
    try:
        A.__bases__ = (X,)
        print(fails, 'assigned')
        Log.fails = None
        A.__bases__ = (Y,)
    except ValueError as e:
        print(fails, e)
    print(Log.calls, A.__bases__, names())
Log.fails = None
Log.calls.clear()
C.__bases__ = (A, X)
print(Log.calls, names())

# __bases__: which class decides the layout, for all that have it from there.
def derive(*bases):
    try:
        type('Z', bases, {})
        return 'fits'
    except TypeError as e:
        return str(e)
class S1: __slots__ = ('a',)
class S2: __slots__ = ('a',)
class Mid(S1): pass
class Low(Mid): pass
class Lower(Low): pass
class Own(Low): __slots__ = ('b',)
class UnderOwn(Own): pass
class Beside(S1): pass
class Both(Lower, Beside): pass
for c in (Mid, Low, Lower, Own, UnderOwn, Both):
    print(c.__name__, derive(c, S1), '|', derive(c, S2))
try:
    Mid.__bases__ = (S2,)
except TypeError as e:
    print(e)
for c in (Mid, Low, Lower, Own, UnderOwn, Both):
    print(c.__name__, c.__base__.__name__, derive(c, S1), '|', derive(c, S2))

# Assignments from inside assignments, three deep. The third would lead round if the second were taken back; it is not, and all three stay.
class Hooked(type):
    plan = {}
    def mro(cls):
        act = Hooked.plan.pop(cls.__name__, None)
        if act:
            act()
        return type.mro(cls)
def assign(target, bases):
    try:
        target.__bases__ = bases
        return 'assigned'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)
def short(classes):
    return [c.__name__ for c in classes]
class O1(metaclass=Hooked): pass
class O2(metaclass=Hooked): pass
class O3(metaclass=Hooked): pass
class T(O1): pass
class U(T): pass
def third():
    print('O2.__bases__ = (U,):', assign(O2, (U,)))
def second():
    Hooked.plan['U'] = third
    print('U.__bases__ = (O3,):', assign(U, (O3,)))
Hooked.plan['T'] = second
print('T.__bases__ = (O2,):', assign(T, (O2,)))
for c in (T, U, O1, O2, O3):
    print(c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))

# A class registered as a sequence, then as a mapping: what derives from it, by whichever way, is one too.
import collections.abc
def kind(o):
    match o:
        case []: return 'sequence'
        case {}: return 'mapping'
    return 'neither'
class R:
    def __len__(self): return 0
class R1(R): pass
class R2(R): pass
class R3(R1, R2): pass
class R4(R3): pass
kinds = lambda: [kind(c()) for c in (R, R1, R2, R3, R4)]
print(kinds())
collections.abc.Sequence.register(R1)
print(kinds())
collections.abc.Mapping.register(R)
print(kinds())
collections.abc.Sequence.register(R3)
print(kinds())

# An assignment from inside another takes a class out of the MROs' way: T has P in its MRO still, and P has nobody in its list. What is read from T follows P all the same.
class P(metaclass=Hooked): x = 'first'
class Q1(metaclass=Hooked): pass
class Q2(P): pass
class Q3(metaclass=Hooked): pass
class V(Q1): pass
class W(V): pass
Hooked.plan['W'] = lambda: print('Q2.__bases__ = (Q3,):', assign(Q2, (Q3,)))
print('V.__bases__ = (Q2,):', assign(V, (Q2,)))
print(short(V.__mro__), short(W.__mro__), short(Q2.__mro__), short(P.__subclasses__()), short(Q2.__subclasses__()))
v, w = V(), W()
def read():
    return [getattr(o, 'x', None) for o in (V, W, v, w)]
print(read(), read())
P.x = 'second'
print(read())
del P.x
print(read())
P.x = property(lambda self: 'third')
print(read()[2:])

# The same where the outer assignment fails and is taken back.
class P(metaclass=Hooked): x = 'first'
class Q1(P): pass
class Q2(metaclass=Hooked): pass
class Q3(metaclass=Hooked): pass
class V(Q1): pass
class W(V): pass
def act():
    print('Q1.__bases__ = (Q3,):', assign(Q1, (Q3,)))
    raise KeyError('the outer one fails')
Hooked.plan['W'] = act
print('V.__bases__ = (Q2,):', assign(V, (Q2,)))
print(short(V.__bases__), short(V.__mro__), short(W.__mro__), short(Q1.__mro__), short(P.__subclasses__()), short(Q1.__subclasses__()), short(Q2.__subclasses__()))
v, w = V(), W()
print(read(), read())
P.x = 'second'
Q2.x = 'of Q2'
Q3.x = 'of Q3'
print(read())
del Q3.x, Q2.x
print(read())

# A key with the hash of '__del__' in the dict of the class is asked behind the writing of the bases: what it assigns then is held against them.
import warnings
warnings.simplefilter('ignore')
class Key:
    act = None
    def __hash__(self): return hash('__del__')
    def __eq__(self, other):
        act, Key.act = Key.act, None
        if act:
            act()
        return False
class K1: pass
class K2: pass
KA = type('KA', (K1,), {Key(): 1})
class KB(K2): pass
Key.act = lambda: print('from inside, KB.__bases__ = (KA,):', assign(KB, (KA,)))
print('KA.__bases__ = (KB,):', assign(KA, (KB,)))
print(short(KA.__bases__), short(KB.__bases__), short(KA.__mro__), short(KB.__mro__))

# A base that is named twice, which an mro() of the metaclass's own lets through.
class Twice(type):
    calls = 0
    def mro(cls):
        Twice.calls += 1
        return [cls] + list(cls.__bases__[0].__mro__)
class First(metaclass=Twice): pass
class Second(metaclass=Twice): pass
class Root(First): pass
last = Root
for i in range(12):
    last = Twice('C%d' % i, (last, last), {})
print(short(Root.__subclasses__()), short(last.__bases__))
Twice.calls = 0
Root.__bases__ = (Second,)
print(Twice.calls, short(last.__mro__[-3:]))
Twice.calls = 0
last.__bases__[0].__bases__ = (Root, Root, Second)
print(Twice.calls, short(Root.__subclasses__()), short(Second.__subclasses__()))

# A class that is being made, handed out by its own mro(): as a base of one of its bases.
class Early(type):
    act = None
    def mro(cls):
        act, Early.act = Early.act, None
        if act:
            act(cls)
        return type.mro(cls)
class E1(metaclass=Early): pass
class E2(metaclass=Early): pass
for target in (E1, E2):
    Early.act = lambda cls: print(target.__name__, assign(target, (cls,)))
    class N(E1, E2): pass
    print(short(N.__mro__), short(target.__bases__))

# As above, T is left with P in its MRO and P with nobody in its list; and a key in the dict of a class derived from T is asked about '__new__' at the end of the assignment. What it reads
# then, it reads anew after a change of P.
class NewKey:
    act = None
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        act, NewKey.act = NewKey.act, None
        if act:
            act()
        return False
class P(metaclass=Hooked): x = 'first'
class R1(metaclass=Hooked): pass
class R2(P): pass
class R3(metaclass=Hooked): pass
class T(R1): pass
U = Hooked('U', (T,), {NewKey(): 1})
def from_the_key():
    print('the key reads', T.x, U.x, short(T.__mro__))
    P.x = 'second'
    print('the key reads', T.x, U.x)
def act():
    print('R2.__bases__ = (R3,):', assign(R2, (R3,)))
    NewKey.act = from_the_key
Hooked.plan['U'] = act
print('T.__bases__ = (R2,):', assign(T, (R2,)))
print(short(T.__mro__), short(U.__mro__), T.x, U.x, T().x)
P.x = 'third'
print(T.x, U.x, T().x)

# Three assignments to one class from inside one another: other bases, the old base again, the other bases again by the very same tuple. Then the first one fails and is taken back.
class G1(metaclass=Hooked): pass
class G2(metaclass=Hooked): pass
class B(metaclass=Hooked): w = 'first'
class A(B): pass
class S(A): pass
others = (G1,)
def innermost():
    print('A.__bases__ = others:', assign(A, others))
def inner():
    Hooked.plan['S'] = innermost
    print('A.__bases__ = (B,):', assign(A, (B,)))
    raise KeyError('the first one fails')
Hooked.plan['S'] = inner
print('A.__bases__ = others:', assign(A, others))
print(short(A.__bases__), short(A.__mro__), short(S.__mro__))
a = A()
read = lambda: [getattr(x, 'w', 'none') for x in (A, S, a)]
print(read())
G1.w = 'of G1'
print(read())
B.w = 'second'
G1.w = 'of G1 again'
print(read())
del G1.w
print(read())
print('A.__bases__ = (B, G2):', assign(A, (B, G2)))
print(short(A.__mro__), short(S.__mro__), read())
B.w = 'third'
print(read())
del B.w
print(read())

# The same three, which leave A out of the list of its base B. Then B is given another base: no walk comes to A, which keeps an MRO with what B derived from.
class G1(metaclass=Hooked): pass
class G2(metaclass=Hooked): pass
class E(metaclass=Hooked): w = 'first'
class F(metaclass=Hooked): pass
class B(E): pass
class A(B): pass
class S(A): pass
others = (G1,)
Hooked.plan['S'] = inner
print('A.__bases__ = others:', assign(A, others))
print('G1.__bases__ = (G2,):', assign(G1, (G2,)))
print(short(A.__bases__), short(A.__mro__), short(S.__mro__), short(B.__subclasses__()), short(G1.__subclasses__()))
print('B.__bases__ = (F,):', assign(B, (F,)))
print(short(A.__mro__), short(B.__mro__), short(E.__subclasses__()))
a = A()
print(read())
E.w = 'second'
print(read())
del E.w
print(read())

# An assignment from inside gives the class its old base again, for each class of a chain. How often mro() is called for an assignment at the top afterwards.
class Counted(type):
    act = None
    calls = 0
    def mro(cls):
        Counted.calls += 1
        act, Counted.act = Counted.act, None
        if act:
            act()
        return type.mro(cls)
class H1(metaclass=Counted): pass
class H2(metaclass=Counted): pass
class Top(H1): pass
chain = [Top]
for i in range(14):
    chain.append(Counted('L%d' % i, (chain[-1],), {}))
for c in chain[1:]:
    Counted.act = lambda c=c, base=c.__bases__[0]: setattr(c, '__bases__', (base,))
    c.__bases__ = (H2,)
print(short(Top.__subclasses__()), short(chain[1].__bases__), short(H2.__subclasses__()))
Counted.calls = 0
Top.__bases__ = (H2,)
print(Counted.calls, short(chain[-1].__mro__[-4:]))

# Who is in whose list after assignments to one class from inside one another, with every end.
def check(*classes):
    for c in classes:
        print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))

def fresh():
    global B, G1, G2, A, S
    class B(metaclass=Hooked): pass
    class G1(metaclass=Hooked): pass
    class G2(metaclass=Hooked): pass
    class A(B): pass
    class S(A): pass

def fail():
    raise KeyError('fails')

def then(*acts):
    def act():
        for a in acts:
            a()
    return act

def inside(bases, *after):
    return then(lambda: print('  from inside,', short(bases), assign(A, bases)), *after)

print('another from inside')
fresh()
Hooked.plan['S'] = inside((G2,))
print(assign(A, (G1,)))
check(A, B, G1, G2, S)

print('another from inside, and the outer one fails')
fresh()
Hooked.plan['S'] = inside((G2,), fail)
print(assign(A, (G1,)))
check(A, B, G1, G2, S)

print('the old base again from inside')
fresh()
Hooked.plan['S'] = inside((B,))
print(assign(A, (G1,)))
check(A, B, G1, G2, S)

print('the old base again from inside, and the outer one fails')
fresh()
Hooked.plan['S'] = inside((B,), fail)
print(assign(A, (G1,)))
check(A, B, G1, G2, S)

print('the one from inside fails')
fresh()
Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', fail), inside((G2,)))
print(assign(A, (G1,)))
check(A, B, G1, G2, S)

print('three deep, the third by the tuple of the first, and the first fails')
fresh()
others = (G1,)
Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B,)), fail)
print(assign(A, others))
check(A, B, G1, G2, S)

print('three deep, the third by the tuple of the first')
fresh()
others = (G1,)
Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B, G2)))
print(assign(A, others))
check(A, B, G1, G2, S)

print('bases that are kept, dropped and new at once')
fresh()
print(assign(A, (B, G1)))
Hooked.plan['S'] = inside((G2, B), fail)
print(assign(A, (G1, G2)))
check(A, B, G1, G2, S)

print('an assignment that fails leaves the class in its place')
fresh()
class Later(B): pass
Hooked.plan['S'] = fail
print(assign(A, (G1,)), short(B.__subclasses__()))
print(assign(A, (B, G1)), short(B.__subclasses__()))
