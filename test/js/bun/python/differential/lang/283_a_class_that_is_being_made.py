# The mro() of a metaclass gets the class before it has been made, and keys of dicts are asked while it is being made.
import warnings
warnings.simplefilter('ignore')

def short(classes):
    return [c.__name__ for c in classes]

def assign(target, bases):
    try:
        target.__bases__ = bases
        return 'assigned'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)

# It assigns to its own __bases__.
class Early(type):
    act = None
    def mro(cls):
        act, Early.act = Early.act, None
        if act:
            act(cls)
        return type.mro(cls)

for what, choose in (('the same', lambda X, Y, Z: (X,)), ('another', lambda X, Y, Z: (Y,)), ('one derived from it', lambda X, Y, Z: (Z,)), ('two', lambda X, Y, Z: (X, Y)), ('two, the other way', lambda X, Y, Z: (Y, X)),
                     ('itself', lambda X, Y, Z: (None,)), ('none', lambda X, Y, Z: ()), ('no class', lambda X, Y, Z: (1,)), ('no tuple', lambda X, Y, Z: [X])):
    for namespace in ({}, {'__slots__': ()}, {'__slots__': ('a',)}):
        class X(metaclass=Early): pass
        class Y(metaclass=Early): pass
        class Z(X): pass
        def act(cls):
            bases = choose(X, Y, Z)
            if bases == (None,):
                bases = (cls,)
            print(what, sorted(namespace), '|', assign(cls, bases))
        Early.act = act
        N = Early('N', (X,), dict(namespace))
        print('   ', short(N.__bases__), short(N.__mro__), N.__base__.__name__, short(X.__subclasses__()), short(Y.__subclasses__()), short(Z.__subclasses__()))
        print('    afterwards:', assign(N, (Y,)), short(N.__mro__), short(X.__subclasses__()), short(Y.__subclasses__()))

# A key in the dict of a base is asked while the class is being made, and gives that base another base.
class Key:
    act = None
    def __init__(self, name): self.hash = hash(name)
    def __hash__(self): return self.hash
    def __eq__(self, other):
        act, Key.act = Key.act, None
        if act:
            act()
        return False

class Plain(type):
    def mro(cls): return type.mro(cls)

# (About '__new__': which other names are asked about while a class is made differs from CPython.)
for name in ('__new__',):
    class C0(metaclass=Plain): w = 'first'
    class C3(metaclass=Plain): pass
    C1 = Plain('C1', (C0,), {Key(name): 1})
    Key.act = lambda: print(name, '| from the key, C1.__bases__ = (C3,):', assign(C1, (C3,)))
    class N(C1): pass
    Key.act = None
    print('   ', short(N.__mro__), short(C1.__mro__), short(C0.__subclasses__()), short(C1.__subclasses__()))
    n = N()
    print('   ', getattr(N, 'w', 'none'), getattr(n, 'w', 'none'))
    C0.w = 'second'
    print('   ', getattr(N, 'w', 'none'), getattr(n, 'w', 'none'))
    del C0.w
    print('   ', getattr(N, 'w', 'none'), getattr(n, 'w', 'none'))
