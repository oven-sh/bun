# The classes here are plain ones, no metaclass but type, but for one that is needed to get into the state of the last part. A class whose MRO names a class to which its bases do not lead is told by that class all the same, also after assignments to __bases__
# further up, whose walks do not come to it. (No oracle: CPython remembers what it has looked up in plain classes, tells by the lists alone, and reads the old value in most of these.)
import warnings
warnings.simplefilter('ignore')


class Key:
    act = None
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        act, Key.act = Key.act, None
        if act:
            act()
        return False


def short(classes):
    return [c.__name__ for c in classes]


def left_out():
    "N keeps C0, and so G, in its MRO; C1, its only base, derives from Z by then."
    class G: w = 'G'
    class C0(G): pass
    class Z: pass
    C1 = type('C1', (C0,), {Key(): 1})
    def act(): C1.__bases__ = (Z,)
    Key.act = act
    class N(C1): pass
    Key.act = None
    return G, C0, Z, C1, N


print('--- what it looks like')
G, C0, Z, C1, N = left_out()
print(short(N.__mro__), short(C1.__mro__), short(G.__subclasses__()), short(C0.__subclasses__()), short(C1.__subclasses__()))

print('--- the class that is named changes')
print(N.w, N().w)
G.w = 'G again'
print(N.w, N().w)
C0.w = 'C0'
print(N.w, N().w)
del C0.w
print(N.w, N().w)

print('--- the class in between is given another base: its walk does not come to N, which goes on naming G')
G, C0, Z, C1, N = left_out()
class G2: w = 'G2'
print(N.w)
C0.__bases__ = (G2,)
print(short(N.__mro__), short(C0.__mro__), short(G.__subclasses__()), short(G2.__subclasses__()))
print(N.w)
G.w = 'G again'
print(N.w, N().w)
G2.w = 'G2 again'
print(N.w, C0.w)
del G.w
print(getattr(N, 'w', 'none'))

print('--- the same for a class derived from N, made afterwards')
G, C0, Z, C1, N = left_out()
class D(N): pass
class G2: w = 'G2'
print(short(D.__mro__), D.w)
C0.__bases__ = (G2,)
G.w = 'G again'
print(D.w, D().w)

print('--- twice, and back')
G, C0, Z, C1, N = left_out()
class G2: w = 'G2'
class G3: w = 'G3'
print(N.w)
C0.__bases__ = (G2,)
C0.__bases__ = (G3,)
G.w = 'G, 2'
print(N.w)
C0.__bases__ = (G,)
G.w = 'G, 3'
print(N.w, C0.w)

print('--- an assignment that is refused changes nothing of that')
G, C0, Z, C1, N = left_out()
print(N.w)
try:
    C0.__bases__ = (int,)
except TypeError as e:
    print(type(e).__name__)
G.w = 'G again'
print(N.w)

print('--- special methods go by the MRO too')
G, C0, Z, C1, N = left_out()
class G2: pass
C0.__bases__ = (G2,)
G.__len__ = lambda self: 3
print(N.__len__(N()))
G.__getattr__ = lambda self, name: 'from G'
print(N().anything)

print('--- when N itself gets its turn, G goes from its MRO, and is no longer listened to')
G, C0, Z, C1, N = left_out()
print(N.w)
C1.__bases__ = (Z,)
print(short(N.__mro__), getattr(N, 'w', 'none'))
G.w = 'G again'
print(getattr(N, 'w', 'none'))


print('--- a class that is left out of the list of its base: the base is given another base')
class Hooked(type):
    plan = []
    def mro(cls):
        if Hooked.plan:
            Hooked.plan.pop(0)()
        return type.mro(cls)


def left_out_of_the_list():
    "A derives from B and is not in its list: three assignments to A.__bases__ from inside one another, the third by the tuple of the first, and the first fails."
    class Q: pass
    class X: pass
    class E: w = 'E'
    class F: pass
    class B(E): pass
    class A(B): pass
    class S(A, metaclass=Hooked): pass
    others = (X,)
    def one():
        A.__bases__ = (B,)
        raise KeyError('the outermost fails')
    def two():
        A.__bases__ = others
    Hooked.plan[:] = [one, two]
    try:
        A.__bases__ = others
    except KeyError as e:
        print(e)
    X.__bases__ = (Q,)          # A is in the list of X still: its MRO is worked out again, from B.
    return Q, X, E, F, B, A, S


def by_its_mro(cls, name):
    return next((c.__dict__[name] for c in cls.__mro__ if name in c.__dict__), 'none')


Q, X, E, F, B, A, S = left_out_of_the_list()
for c in (A, B, S, X, E):
    print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
# The walk of this one meets plain classes only, and does not come to A.
B.__bases__ = (F,)
for c in (A, B, S, E, F):
    print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
o = A()
print(A.w, S.w, o.w)
E.w = 'E again'
print(A.w, S.w, o.w, '| by its MRO:', by_its_mro(A, 'w'))
del E.w
print(getattr(A, 'w', 'none'), getattr(S, 'w', 'none'), getattr(o, 'w', 'none'))
F.w = 'F'
print(getattr(A, 'w', 'none'), getattr(B, 'w', 'none'), '| by its MRO:', by_its_mro(A, 'w'))

print('--- the same, and the assignment to the base is refused in the end')
Q, X, E, F, B, A, S = left_out_of_the_list()
print(A.w)
try:
    B.__bases__ = (F, F)
except TypeError as e:
    print(type(e).__name__)
E.w = 'E again'
print(A.w, S.w, '| by its MRO:', by_its_mro(A, 'w'))
