# While a class is being made, keys that are no strs are asked, and what they do then comes to a class that is in no list yet. Here they change a base of it.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")

try:
    def short(classes): return [c.__name__ for c in classes]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(classes): return [c.__name__ for c in classes]')
try:
    def attempt(f):
        try: return type(f()).__name__
        except Exception as e: return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(f):')

try:
    class Key:
        acts = []
        asked = 0
        def __init__(self, name): self.hash = hash(name)
        def __hash__(self): return self.hash
        def __eq__(self, other):
            Key.asked += 1
            if Key.acts: Key.acts.pop(0)()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')

# The mro() of the metaclass leaves the base out of the MRO of the new class, and names a class from which the base derives. The new class is told of changes to that one by way
# of its base, and the key takes the base from under it.
try:
    class LeavesOutTheBase(type):
        def mro(cls):
            if cls.__name__ == 'N': return [cls, E, object]
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LeavesOutTheBase(type):')
try:
    for where in ('in the dict of the new class', 'in the dict of the class that is named'):
        try: E = LeavesOutTheBase('E', (), {'w': 1} if where.endswith('new class') else {'w': 1, Key('__new__'): 1})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: E = LeavesOutTheBase('E', (), {'w': 1} if where.endswith('new class')...")
        try: Other = LeavesOutTheBase('Other', (), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Other = LeavesOutTheBase('Other', (), {})")
        try: F = LeavesOutTheBase('F', (E,), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: F = LeavesOutTheBase('F', (E,), {})")
        def act(): F.__bases__ = (Other,)
        try: Key.acts[:] = [act]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.acts[:] = [act]')
        try: N = LeavesOutTheBase('N', (F,), {Key('__new__'): 1} if where.endswith('new class') else {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = LeavesOutTheBase('N', (F,), {Key('__new__'): 1} if where.endswith...")
        try: print('where [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', where)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: where')
        try: print('|', 'len(Key.acts) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', len(Key.acts))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Key.acts)')
        try: print('short(N.__bases__) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', short(N.__bases__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__bases__)')
        try: print('short(N.__mro__) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', short(N.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
        try: print('short(F.__mro__) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', short(F.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(F.__mro__)')
        try: print('short(E.__subclasses__()) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', short(E.__subclasses__()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(E.__subclasses__())')
        try: print('short(F.__subclasses__()) [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', short(F.__subclasses__()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(F.__subclasses__())')
        try: before = N.w
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before = N.w')
        try: E.w = 2
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.w = 2')
        try: print('   N.w:', 'before [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', before)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before')
        try: print('; behind E.w = 2:', 'N.w [' + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + '] =>', N.w)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N.w')
        try: Key.acts[:] = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.acts[:] = []')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for where in ('in the dict of the new class', 'in the dict of the cla...")

# Two bases, of which the mro() names none.
try:
    class NamesNone(type):
        def mro(cls):
            if cls.__name__ == 'N': return [cls, E, object]
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NamesNone(type):')
try: E = NamesNone('E', (), {'w': 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: E = NamesNone('E', (), {'w': 1})")
try: Other = NamesNone('Other', (), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Other = NamesNone('Other', (), {})")
try: F = NamesNone('F', (E,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: F = NamesNone('F', (E,), {})")
try: G = NamesNone('G', (E,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: G = NamesNone('G', (E,), {})")
try:
    def act(): F.__bases__ = (Other,); G.__bases__ = (Other,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def act(): F.__bases__ = (Other,); G.__bases__ = (Other,)')
try: Key.acts[:] = [act]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.acts[:] = [act]')
try: N = NamesNone('N', (F, G), {Key('__new__'): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = NamesNone('N', (F, G), {Key('__new__'): 1})")
try: before = N.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before = N.w')
try: E.w = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.w = 2')
try: print('both bases taken away |', 'short(N.__mro__) =>', short(N.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
try: print('short(E.__subclasses__()) =>', short(E.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(E.__subclasses__())')
try: print('| N.w:', 'before =>', before)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before')
try: print('; behind E.w = 2:', 'N.w =>', N.w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N.w')

# The key lies in the dict of the base. At its first asking it gives the base another base; in there the base asks it on its own account, and it raises: no instance of the base
# is made from then on. The new class had taken from its base what makes instances before that, and keeps it.
try: T = type('T', (), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: T = type('T', (), {})")
try: Other = type('Other', (), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Other = type('Other', (), {})")
try: F = type('F', (T,), {Key('__new__'): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: F = type('F', (T,), {Key('__new__'): 1})")
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def one():
        try: F.__bases__ = (Other,); log.append('assigned')
        except Exception as e: log.append('%s: %s' % (type(e).__name__, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one():')
try:
    def two(): raise KeyError('at the second asking')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def two(): raise KeyError('at the second asking')")
try: Key.acts[:] = [one, two]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.acts[:] = [one, two]')
try: N = type('N', (F,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = type('N', (F,), {})")
try: Key.acts[:] = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.acts[:] = []')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('| F():', 'attempt(F) =>', attempt(F))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(F)')
try: print('| N():', 'attempt(N) =>', attempt(N))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(N)')
try: print('| a class made afterwards:', "attempt(type('N2', (F,), {})) =>", attempt(type('N2', (F,), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(type('N2', (F,), {}))")
