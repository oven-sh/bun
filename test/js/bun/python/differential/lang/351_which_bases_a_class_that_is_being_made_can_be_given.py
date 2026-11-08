# The mro() of a metaclass gets the class before it has been made, and assigns to its __bases__: which bases are let through, and what comes of it.
import warnings, weakref; warnings.simplefilter('ignore')
def short(cs): return [c.__name__ for c in cs]
class Early(type):
    act = None
    def mro(cls):
        act, Early.act = Early.act, None
        if act: act(cls)
        return type.mro(cls)
def attempt(f):
    try: return f()
    except Exception as e: return '%s: %s' % (type(e).__name__, str(e)[:70])
def assign(t, b):
    def do(): t.__bases__ = b; return 'assigned'
    return attempt(do)
KINDS = {'object': None, 'plain': {}, 'slots ()': {'__slots__': ()}, 'slots a': {'__slots__': ('a',)}, 'slots dict': {'__slots__': ('__dict__',)}, 'slots weakref': {'__slots__': ('__weakref__',)},
         'slots both': {'__slots__': ('__dict__', '__weakref__')}}
def make(name, ns): return object if ns is None else Early(name, (), dict(ns))
def has(o):
    def ref(): weakref.ref(o); return True
    def write(): o.zz = 1; return True
    return [hasattr(o, '__dict__'), attempt(ref) is True, attempt(write) is True]
def state(N, *others):
    return (short(N.__bases__), short(N.__mro__), N.__base__.__name__, [c.__name__ for c in others if c is not object and N in c.__subclasses__()], attempt(lambda: has(N())),
            N.__dictoffset__ != 0, N.__weakrefoffset__ != 0, N.__basicsize__ - object.__basicsize__, '__dict__' in N.__dict__, '__weakref__' in N.__dict__)

def row(label, first, given, namespace, *others):
    # Not where the class adds no __dict__ and is given bases with and without one: CPython lets some of that through, and dies when an instance is looked at.
    adds = '__dict__' in namespace.get('__slots__', ()) or '__slots__' not in namespace and not any(b.__dictoffset__ for b in first)
    if not adds and len({b.__dictoffset__ != 0 for b in given}) == 2: return
    out = []
    Early.act = lambda cls: out.append(assign(cls, given))
    N = attempt(lambda: Early('N', first, dict(namespace)))
    Early.act = None
    print(label, out, N if isinstance(N, str) else state(N, *others))

print('--- one base in place of another: the base that the class began with, the base that it is given, its own namespace')
for xk, xn in KINDS.items():
    for yk, yn in KINDS.items():
        for nk, nn in KINDS.items():
            if nn is None: continue
            X = make('X', xn); Y = make('Y', yn)
            row('%-13s %-13s %-13s' % (xk, yk, nk), () if X is object else (X,), (Y,), nn, X, Y)

print('--- the same base again, two bases, a base twice')
for xk, xn in KINDS.items():
    for yk, yn in KINDS.items():
        if xn is None or yn is None: continue
        for nk in ('plain', 'slots ()', 'slots weakref'):
            for what in ('same', 'Y X', 'X Y', 'Y Y', 'X object'):
                X = make('X', xn); Y = make('Y', yn)
                row('%-13s %-13s %-13s %-8s' % (xk, yk, nk, what), (X,), {'same': (X,), 'Y X': (Y, X), 'X Y': (X, Y), 'Y Y': (Y, Y), 'X object': (X, object)}[what], KINDS[nk], X, Y)

print('--- a class with two bases is given one, or the two the other way round')
for xk in ('plain', 'slots ()', 'slots weakref'):
    for yk in ('plain', 'slots ()', 'slots a', 'slots dict'):
        for nk in ('plain', 'slots ()'):
            for what in ('X', 'Y', 'Y X'):
                X = make('X', KINDS[xk]); Y = make('Y', KINDS[yk])
                row('%-13s %-13s %-13s %-4s' % (xk, yk, nk, what), (X, Y), {'X': (X,), 'Y': (Y,), 'Y X': (Y, X)}[what], KINDS[nk], X, Y)

print('--- what the class says of itself meanwhile')
for xk, xn in KINDS.items():
    for nk, nn in KINDS.items():
        if nn is None: continue
        X = make('X', xn)
        out = []
        Early.act = lambda cls: out.extend([cls.__dictoffset__ != 0, cls.__weakrefoffset__ != 0, cls.__basicsize__ - object.__basicsize__, cls.__base__.__name__, cls.__mro__, attempt(cls), attempt(lambda: object.__new__(cls))])
        N = attempt(lambda: Early('N', () if X is object else (X,), dict(nn)))
        Early.act = None
        print('%-13s %-13s' % (xk, nk), out, N if isinstance(N, str) else state(N, X))

print('--- behind the assignment, still in mro(): instances, objects that are given the class, another assignment')
def row2(label, X, Y, Z, namespace):
    out = []; kept = []
    def give(o, cls):
        def do(): o.__class__ = cls; kept.append(o); return 'given'
        return attempt(do)
    def act(cls):
        out.append(assign(cls, (Y,)))
        out.append(cls.__mro__ and short(cls.__mro__))
        out.append(attempt(cls)); out.append(attempt(lambda: object.__new__(cls)))
        # (Not while it has no MRO: CPython lets that through, and may die of it.)
        if cls.__mro__: out.append([give(K(), cls) for K in (Y, Z, Plain, Empty) if K is not object])
        out.append(assign(cls, (Z,)))
        out.append([cls.__dictoffset__ != 0, cls.__weakrefoffset__ != 0])
    Early.act = act
    N = attempt(lambda: Early('N', () if X is object else (X,), dict(namespace)))
    Early.act = None
    print(label, out, N if isinstance(N, str) else state(N, X, Y, Z), [(type(o).__name__, has(o)) for o in kept])
Plain = make('Plain', {}); Empty = make('Empty', {'__slots__': ()})
for xk in ('object', 'plain', 'slots ()', 'slots a', 'slots dict'):
    for yk in ('object', 'slots ()', 'slots a', 'slots weakref'):
        for zk in KINDS:
            for nk in ('plain', 'slots ()', 'slots dict', 'slots weakref'):
                row2('%-10s %-13s %-13s %-13s' % (xk, yk, zk, nk), make('X', KINDS[xk]), make('Y', KINDS[yk]), make('Z', KINDS[zk]), KINDS[nk])

print('--- a base that the class is given has a __new__ of the program\'s: instances are made in mro()')
def row3(label, X, namespace):
    Y = Early('Y', (), {'__slots__': (), '__new__': lambda cls, *a: object.__new__(cls)})
    out = []; kept = []
    def act(cls):
        out.append(assign(cls, (Y,)))
        for f in (cls, lambda: object.__new__(cls), lambda: Y.__new__(cls), lambda: type.__call__(cls)):
            r = attempt(f)
            if isinstance(r, str): out.append(r)
            else: kept.append(r)
    Early.act = act
    N = attempt(lambda: Early('N', () if X is object else (X,), dict(namespace)))
    Early.act = None
    # (Not what N() gives afterwards: in CPython "N.__new__(N) is not safe, use object.__new__()".)
    print(label, out, N if isinstance(N, str) else state(N, X, Y)[:4] + state(N, X, Y)[5:], [(type(o).__name__, has(o)) for o in kept])
for xk in KINDS:
    for nk in ('plain', 'slots ()'):
        # (Only where the class adds nothing itself: CPython's instances of the window have no room for that, and it dies when they go.)
        if nk == 'slots ()' or xk in ('plain', 'slots both'): row3('%-13s %-13s' % (xk, nk), make('X', KINDS[xk]), KINDS[nk])

print('--- cls.__bases__ += ()')
class Same(type):
    busy = False
    def mro(cls):
        if cls.__mro__ is None and not Same.busy:
            Same.busy = True
            try: cls.__bases__ += ()
            finally: Same.busy = False
        return type.mro(cls)
A = Same('A', (), {}); S = Same('S', (), {'__slots__': ()})
for first, namespace in (((), {}), ((A,), {}), ((A,), {'__slots__': ()}), ((S,), {}), ((S,), {'__slots__': ()}), ((S,), {'__slots__': ('a',)}), ((S, A), {}), ((int,), {}), ((dict,), {}), ((Exception,), {}), ((type,), {})):
    N = attempt(lambda: Same('N', first, dict(namespace)))
    print(short(first), namespace, N if isinstance(N, str) else state(N, *first))
