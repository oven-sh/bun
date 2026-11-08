# While a class is being made, keys that are no strs are asked, and what they do then comes to a class that is in no list yet. Here they change a base of it.
import warnings
warnings.simplefilter('ignore')

def short(classes): return [c.__name__ for c in classes]
def attempt(f):
    try: return type(f()).__name__
    except Exception as e: return '%s: %s' % (type(e).__name__, e)

class Key:
    acts = []
    asked = 0
    def __init__(self, name): self.hash = hash(name)
    def __hash__(self): return self.hash
    def __eq__(self, other):
        Key.asked += 1
        if Key.acts: Key.acts.pop(0)()
        return False

# The mro() of the metaclass leaves the base out of the MRO of the new class, and names a class from which the base derives. The new class is told of changes to that one by way
# of its base, and the key takes the base from under it.
class LeavesOutTheBase(type):
    def mro(cls):
        if cls.__name__ == 'N': return [cls, E, object]
        return type.mro(cls)
for where in ('in the dict of the new class', 'in the dict of the class that is named'):
    E = LeavesOutTheBase('E', (), {'w': 1} if where.endswith('new class') else {'w': 1, Key('__new__'): 1})
    Other = LeavesOutTheBase('Other', (), {}); F = LeavesOutTheBase('F', (E,), {})
    def act(): F.__bases__ = (Other,)
    Key.acts[:] = [act]
    N = LeavesOutTheBase('N', (F,), {Key('__new__'): 1} if where.endswith('new class') else {})
    print(where, '|', len(Key.acts), short(N.__bases__), short(N.__mro__), short(F.__mro__), short(E.__subclasses__()), short(F.__subclasses__()))
    before = N.w; E.w = 2
    print('   N.w:', before, '; behind E.w = 2:', N.w)
    Key.acts[:] = []

# Two bases, of which the mro() names none.
class NamesNone(type):
    def mro(cls):
        if cls.__name__ == 'N': return [cls, E, object]
        return type.mro(cls)
E = NamesNone('E', (), {'w': 1}); Other = NamesNone('Other', (), {}); F = NamesNone('F', (E,), {}); G = NamesNone('G', (E,), {})
def act(): F.__bases__ = (Other,); G.__bases__ = (Other,)
Key.acts[:] = [act]
N = NamesNone('N', (F, G), {Key('__new__'): 1})
before = N.w; E.w = 2
print('both bases taken away |', short(N.__mro__), short(E.__subclasses__()), '| N.w:', before, '; behind E.w = 2:', N.w)

# The key lies in the dict of the base. At its first asking it gives the base another base; in there the base asks it on its own account, and it raises: no instance of the base
# is made from then on. The new class had taken from its base what makes instances before that, and keeps it.
T = type('T', (), {}); Other = type('Other', (), {}); F = type('F', (T,), {Key('__new__'): 1})
log = []
def one():
    try: F.__bases__ = (Other,); log.append('assigned')
    except Exception as e: log.append('%s: %s' % (type(e).__name__, e))
def two(): raise KeyError('at the second asking')
Key.acts[:] = [one, two]
N = type('N', (F,), {})
Key.acts[:] = []
print(log, '| F():', attempt(F), '| N():', attempt(N), '| a class made afterwards:', attempt(type('N2', (F,), {})))
