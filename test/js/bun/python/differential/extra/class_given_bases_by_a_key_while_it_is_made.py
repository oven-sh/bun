# When a class has its MRO, the keys of its dict that are no strs are asked whether they are '__new__'; behind that the class is entered in the lists of its bases. The key assigns to the
# __bases__ of the class. (No oracle: CPython asks the keys at another moment, when the class has no MRO yet.)
import warnings
warnings.simplefilter('ignore')

made = []
class Meta(type):
    def mro(cls):
        made.append(cls)
        return type.mro(cls)


class Key:
    def __init__(self, act): self.act = act
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        act, self.act = self.act, None
        if act:
            act()
        return False


def names(classes):
    return [c.__name__ for c in classes]


def attempt(f):
    try:
        f()
        return 'ok'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def raising(cls):
    raise ValueError('no MRO')


for label, new in (('the same base', lambda C, A, B: (A,)), ('another', lambda C, A, B: (B,)), ('both', lambda C, A, B: (A, B)), ('both, the other way round', lambda C, A, B: (B, A)),
                   ('the tuple that it has', lambda C, A, B: C.__bases__), ('twice', None), ('refused', lambda C, A, B: (int,)), ('nothing', False)):
    class A(metaclass=Meta): pass
    class B(metaclass=Meta): pass
    log = []
    def act():
        C = made[-1]
        if new is None:
            log.append(attempt(lambda: setattr(C, '__bases__', (B,))))
            log.append(attempt(lambda: setattr(C, '__bases__', (A,))))
        elif new:
            log.append(attempt(lambda: setattr(C, '__bases__', new(C, A, B))))
    C = Meta('C', (A,), {Key(act): 1})
    print(label, '|', [entry.split(':')[0] for entry in log], '|', names(C.__bases__), names(C.__mro__), '| A:', names(A.__subclasses__()), '| B:', names(B.__subclasses__()))
    A.x = 1
    B.y = 2
    print('   ', getattr(C, 'x', None), getattr(C, 'y', None))
    class D(C): pass
    print('   ', names(D.__mro__), names(C.__subclasses__()))


print('--- the key brings about an assignment that fails, cannot give the old bases back, and leaves the class its MRO')
acts = {}
class Acting(type):
    def mro(cls):
        made.append(cls)
        act = acts.pop(cls.__name__, None)
        if act:
            act()
        return type.mro(cls)
class Base(metaclass=Acting): pass
class Old(Base): pass
class New(Base): pass
class P(Base): pass
log = []
def key_acts():
    T = made[-1]
    def in_mro_of_T():
        log.append('P.__bases__ = (T,): ' + attempt(lambda: setattr(P, '__bases__', (T,))))
        raise ValueError('the mro() of T')
    def in_mro_of_Old():
        acts['T'] = in_mro_of_T
        log.append('T.__bases__ = (New,): ' + attempt(lambda: setattr(T, '__bases__', (New,))))
        raise ValueError('the mro() of Old')
    acts['Old'] = in_mro_of_Old
    log.append('Old.__bases__ = (P,): ' + attempt(lambda: setattr(Old, '__bases__', (P,))))
T = Acting('T', (Old,), {Key(key_acts): 1})
print(log)
for c in (Base, Old, New, T, P):
    print('   ', c.__name__, names(c.__bases__), names(c.__mro__), names(c.__subclasses__()))

print('--- the mro() of the metaclass leaves the class out of its own MRO')
class OneKey:
    def __init__(self): self.act = None
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        act, self.act = self.act, None
        if act: act()
        return False
left_out = []
class Out(type):
    def mro(cls):
        left_out.append(cls)
        return [c for c in type.mro(cls) if c is not cls] if cls.__name__ == 'C' else type.mro(cls)
for what in ('nothing', 'C.__bases__ = (B,)', 'C.__bases__ = (A,)', 'A.w = 2'):
    key = OneKey(); A = Out('A', (), {'w': 1, key: 0}); B = Out('B', (), {'w': 'b'})
    def act():
        C = left_out[-1]
        if what == 'C.__bases__ = (B,)': C.__bases__ = (B,)
        elif what == 'C.__bases__ = (A,)': C.__bases__ = (A,)
        elif what == 'A.w = 2': A.w = 2
    key.act = act
    result = attempt(lambda: Out('C', (A,), {}) and 'made')
    C = left_out[-1]
    print(what, '|', result[:9], '|', names(C.__bases__), names(C.__mro__), '| A lists', names(A.__subclasses__()), '| B lists', names(B.__subclasses__()))
