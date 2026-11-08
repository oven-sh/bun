# A key that is no str, in the dict of a base, is asked about '__new__' while class N is being made: N has its MRO and is in no list yet. What the key writes into a class of that MRO, N has afterwards.
import gc, warnings; warnings.simplefilter('ignore')
class Key:
    act = None
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        act, Key.act = Key.act, None
        if act: act()
        return False
calls = []
def new(cls, *a): calls.append(cls.__name__); return object.__new__(cls)
VALUES = {'w': 2, 'v': 3, '__new__': new} # (Not other special methods: CPython's class has them as attributes then, and does not act by all of them.)
for where in ('base', 'top'):
    for reads in (False, True):
        for into in ('T', 'F'):
            for what, value in VALUES.items():
                T = type('T', (), {'w': 1, Key(): 0} if where == 'top' else {'w': 1})
                F = type('F', (T,), {Key(): 0} if where == 'base' else {})
                seen = []
                def act():
                    found = [c for c in gc.get_objects() if isinstance(c, type) and c.__name__ == 'N' and F in c.__bases__]
                    seen.append((len(found), [c.__name__ for c in F.__subclasses__()]))
                    if reads:
                        for c in found: c.w, getattr(c, what, None), c.__new__
                    setattr({'T': T, 'F': F}[into], what, value)
                Key.act = act
                N = type('N', (F,), {})
                Key.act = None
                del calls[:]
                o = N()
                print(where, reads, into, what, seen, N.w, getattr(N, what) is getattr(F, what), N.__new__ is F.__new__, type(o).__name__,
                      # (A __new__ that is written into a class which the search has passed: CPython's N has it and is not made by it.)
                      calls if (where, into) != ('top', 'F') else None)
                del N, o, F, T, act
                gc.collect()
