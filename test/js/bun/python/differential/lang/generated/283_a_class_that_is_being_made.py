# The mro() of a metaclass gets the class before it has been made, and keys of dicts are asked while it is being made.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")

try:
    def short(classes):
        return [c.__name__ for c in classes]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(classes):')

try:
    def assign(target, bases):
        try:
            target.__bases__ = bases
            return 'assigned'
        except Exception as e:
            return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign(target, bases):')

# It assigns to its own __bases__.
try:
    class Early(type):
        act = None
        def mro(cls):
            act, Early.act = Early.act, None
            if act:
                act(cls)
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Early(type):')

try:
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
            try: Early.act = act
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Early.act = act')
            try: N = Early('N', (X,), dict(namespace))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = Early('N', (X,), dict(namespace))")
            try: print('   ', 'short(N.__bases__) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(N.__bases__))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__bases__)')
            try: print('short(N.__mro__) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(N.__mro__))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
            try: print('N.__base__.__name__ [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', N.__base__.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N.__base__.__name__')
            try: print('short(X.__subclasses__()) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(X.__subclasses__()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(X.__subclasses__())')
            try: print('short(Y.__subclasses__()) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(Y.__subclasses__()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Y.__subclasses__())')
            try: print('short(Z.__subclasses__()) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(Z.__subclasses__()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Z.__subclasses__())')
            try: print('    afterwards:', 'assign(N, (Y,)) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', assign(N, (Y,)))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(N, (Y,))')
            try: print('short(N.__mro__) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(N.__mro__))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
            try: print('short(X.__subclasses__()) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(X.__subclasses__()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(X.__subclasses__())')
            try: print('short(Y.__subclasses__()) [' + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'choose=' + (repr(choose) if type(choose) in (str, int, float, bytes, bool, type(None)) or (type(choose) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in choose)) else choose.__name__ if type(choose) is type else type(choose).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(Y.__subclasses__()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Y.__subclasses__())')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for what, choose in (('the same', lambda X, Y, Z: (X,)), ('another', ...")

# A key in the dict of a base is asked while the class is being made, and gives that base another base.
try:
    class Key:
        act = None
        def __init__(self, name): self.hash = hash(name)
        def __hash__(self): return self.hash
        def __eq__(self, other):
            act, Key.act = Key.act, None
            if act:
                act()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')

try:
    class Plain(type):
        def mro(cls): return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain(type):')

# (About '__new__': which other names are asked about while a class is made differs from CPython.)
try:
    for name in ('__new__',):
        class C0(metaclass=Plain): w = 'first'
        class C3(metaclass=Plain): pass
        try: C1 = Plain('C1', (C0,), {Key(name): 1})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: C1 = Plain('C1', (C0,), {Key(name): 1})")
        try: Key.act = lambda: print(name, '| from the key, C1.__bases__ = (C3,):', assign(C1, (C3,)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Key.act = lambda: print(name, '| from the key, C1.__bases__ = (C3,):'...")
        class N(C1): pass
        try: Key.act = None
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.act = None')
        try: print('   ', 'short(N.__mro__) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', short(N.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
        try: print('short(C1.__mro__) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', short(C1.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(C1.__mro__)')
        try: print('short(C0.__subclasses__()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', short(C0.__subclasses__()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(C0.__subclasses__())')
        try: print('short(C1.__subclasses__()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', short(C1.__subclasses__()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(C1.__subclasses__())')
        try: n = N()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = N()')
        try: print('   ', "getattr(N, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(N, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(N, 'w', 'none')")
        try: print("getattr(n, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(n, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(n, 'w', 'none')")
        try: C0.w = 'second'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: C0.w = 'second'")
        try: print('   ', "getattr(N, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(N, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(N, 'w', 'none')")
        try: print("getattr(n, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(n, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(n, 'w', 'none')")
        try: del C0.w
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del C0.w')
        try: print('   ', "getattr(N, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(N, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(N, 'w', 'none')")
        try: print("getattr(n, 'w', 'none') [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', getattr(n, 'w', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(n, 'w', 'none')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('__new__',):")
