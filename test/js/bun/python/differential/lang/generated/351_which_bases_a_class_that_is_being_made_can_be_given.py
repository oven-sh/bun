# The mro() of a metaclass gets the class before it has been made, and assigns to its __bases__: which bases are let through, and what comes of it.
try: import warnings, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings, weakref')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def short(cs): return [c.__name__ for c in cs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(cs): return [c.__name__ for c in cs]')
try:
    class Early(type):
        act = None
        def mro(cls):
            act, Early.act = Early.act, None
            if act: act(cls)
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Early(type):')
try:
    def attempt(f):
        try: return f()
        except Exception as e: return '%s: %s' % (type(e).__name__, str(e)[:70])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(f):')
try:
    def assign(t, b):
        def do(): t.__bases__ = b; return 'assigned'
        return attempt(do)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign(t, b):')
try: KINDS = {'object': None, 'plain': {}, 'slots ()': {'__slots__': ()}, 'slots a': {'__slots__': ('a',)}, 'slots dict': {'__slots__': ('__dict__',)}, 'slots weakref': {'__slots__': ('__weakref__',)},
         'slots both': {'__slots__': ('__dict__', '__weakref__')}}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: KINDS = {'object': None, 'plain': {}, 'slots ()': {'__slots__': ()}, ...")
try:
    def make(name, ns): return object if ns is None else Early(name, (), dict(ns))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(name, ns): return object if ns is None else Early(name, (), ...')
try:
    def has(o):
        def ref(): weakref.ref(o); return True
        def write(): o.zz = 1; return True
        return [hasattr(o, '__dict__'), attempt(ref) is True, attempt(write) is True]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def has(o):')
try:
    def state(N, *others):
        return (short(N.__bases__), short(N.__mro__), N.__base__.__name__, [c.__name__ for c in others if c is not object and N in c.__subclasses__()], attempt(lambda: has(N())),
                N.__dictoffset__ != 0, N.__weakrefoffset__ != 0, N.__basicsize__ - object.__basicsize__, '__dict__' in N.__dict__, '__weakref__' in N.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def state(N, *others):')

try:
    def row(label, first, given, namespace, *others):
        # Not where the class adds no __dict__ and is given bases with and without one: CPython lets some of that through, and dies when an instance is looked at.
        adds = '__dict__' in namespace.get('__slots__', ()) or '__slots__' not in namespace and not any(b.__dictoffset__ for b in first)
        if not adds and len({b.__dictoffset__ != 0 for b in given}) == 2: return
        out = []
        Early.act = lambda cls: out.append(assign(cls, given))
        N = attempt(lambda: Early('N', first, dict(namespace)))
        Early.act = None
        print(label, out, N if isinstance(N, str) else state(N, *others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def row(label, first, given, namespace, *others):')

try: print('--- one base in place of another: the base that the class began with, the base that it is given, its own namespace')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- one base in place of another: the base that the class began with...")
try:
    for xk, xn in KINDS.items():
        for yk, yn in KINDS.items():
            for nk, nn in KINDS.items():
                if nn is None: continue
                try: X = make('X', xn)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: X = make('X', xn)")
                try: Y = make('Y', yn)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Y = make('Y', yn)")
                try: row('%-13s %-13s %-13s' % (xk, yk, nk), () if X is object else (X,), (Y,), nn, X, Y)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row('%-13s %-13s %-13s' % (xk, yk, nk), () if X is object else (X,), ...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for xk, xn in KINDS.items():')

try: print('--- the same base again, two bases, a base twice')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the same base again, two bases, a base twice'")
try:
    for xk, xn in KINDS.items():
        for yk, yn in KINDS.items():
            if xn is None or yn is None: continue
            for nk in ('plain', 'slots ()', 'slots weakref'):
                for what in ('same', 'Y X', 'X Y', 'Y Y', 'X object'):
                    try: X = make('X', xn)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: X = make('X', xn)")
                    try: Y = make('Y', yn)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Y = make('Y', yn)")
                    try: row('%-13s %-13s %-13s %-8s' % (xk, yk, nk, what), (X,), {'same': (X,), 'Y X': (Y, X), 'X Y': (X, Y), 'Y Y': (Y, Y), 'X object': (X, object)}[what], KINDS[nk], X, Y)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row('%-13s %-13s %-13s %-8s' % (xk, yk, nk, what), (X,), {'same': (X,...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for xk, xn in KINDS.items():')

try: print('--- a class with two bases is given one, or the two the other way round')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a class with two bases is given one, or the two the other way ro...")
try:
    for xk in ('plain', 'slots ()', 'slots weakref'):
        for yk in ('plain', 'slots ()', 'slots a', 'slots dict'):
            for nk in ('plain', 'slots ()'):
                for what in ('X', 'Y', 'Y X'):
                    try: X = make('X', KINDS[xk])
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: X = make('X', KINDS[xk])")
                    try: Y = make('Y', KINDS[yk])
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Y = make('Y', KINDS[yk])")
                    try: row('%-13s %-13s %-13s %-4s' % (xk, yk, nk, what), (X, Y), {'X': (X,), 'Y': (Y,), 'Y X': (Y, X)}[what], KINDS[nk], X, Y)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row('%-13s %-13s %-13s %-4s' % (xk, yk, nk, what), (X, Y), {'X': (X,)...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for xk in ('plain', 'slots ()', 'slots weakref'):")

try: print('--- what the class says of itself meanwhile')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what the class says of itself meanwhile'")
try:
    for xk, xn in KINDS.items():
        for nk, nn in KINDS.items():
            if nn is None: continue
            try: X = make('X', xn)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: X = make('X', xn)")
            try: out = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
            try: Early.act = lambda cls: out.extend([cls.__dictoffset__ != 0, cls.__weakrefoffset__ != 0, cls.__basicsize__ - object.__basicsize__, cls.__base__.__name__, cls.__mro__, attempt(cls), attempt(lambda: object.__new__(cls))])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Early.act = lambda cls: out.extend([cls.__dictoffset__ != 0, cls.__we...')
            try: N = attempt(lambda: Early('N', () if X is object else (X,), dict(nn)))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = attempt(lambda: Early('N', () if X is object else (X,), dict(nn)))")
            try: Early.act = None
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Early.act = None')
            try: print("'%-13s %-13s' % (xk, nk) [" + 'xk=' + (repr(xk) if type(xk) in (str, int, float, bytes, bool, type(None)) or (type(xk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xk)) else xk.__name__ if type(xk) is type else type(xk).__name__) + ", " + 'xn=' + (repr(xn) if type(xn) in (str, int, float, bytes, bool, type(None)) or (type(xn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xn)) else xn.__name__ if type(xn) is type else type(xn).__name__) + ", " + 'nk=' + (repr(nk) if type(nk) in (str, int, float, bytes, bool, type(None)) or (type(nk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nk)) else nk.__name__ if type(nk) is type else type(nk).__name__) + ", " + 'nn=' + (repr(nn) if type(nn) in (str, int, float, bytes, bool, type(None)) or (type(nn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nn)) else nn.__name__ if type(nn) is type else type(nn).__name__) + '] =>', '%-13s %-13s' % (xk, nk))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%-13s %-13s' % (xk, nk)")
            try: print('out [' + 'xk=' + (repr(xk) if type(xk) in (str, int, float, bytes, bool, type(None)) or (type(xk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xk)) else xk.__name__ if type(xk) is type else type(xk).__name__) + ", " + 'xn=' + (repr(xn) if type(xn) in (str, int, float, bytes, bool, type(None)) or (type(xn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xn)) else xn.__name__ if type(xn) is type else type(xn).__name__) + ", " + 'nk=' + (repr(nk) if type(nk) in (str, int, float, bytes, bool, type(None)) or (type(nk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nk)) else nk.__name__ if type(nk) is type else type(nk).__name__) + ", " + 'nn=' + (repr(nn) if type(nn) in (str, int, float, bytes, bool, type(None)) or (type(nn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nn)) else nn.__name__ if type(nn) is type else type(nn).__name__) + '] =>', out)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
            try: print('N if isinstance(N, str) else state(N, X) [' + 'xk=' + (repr(xk) if type(xk) in (str, int, float, bytes, bool, type(None)) or (type(xk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xk)) else xk.__name__ if type(xk) is type else type(xk).__name__) + ", " + 'xn=' + (repr(xn) if type(xn) in (str, int, float, bytes, bool, type(None)) or (type(xn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in xn)) else xn.__name__ if type(xn) is type else type(xn).__name__) + ", " + 'nk=' + (repr(nk) if type(nk) in (str, int, float, bytes, bool, type(None)) or (type(nk) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nk)) else nk.__name__ if type(nk) is type else type(nk).__name__) + ", " + 'nn=' + (repr(nn) if type(nn) in (str, int, float, bytes, bool, type(None)) or (type(nn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in nn)) else nn.__name__ if type(nn) is type else type(nn).__name__) + '] =>', N if isinstance(N, str) else state(N, X))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N if isinstance(N, str) else state(N, X)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for xk, xn in KINDS.items():')

try: print('--- behind the assignment, still in mro(): instances, objects that are given the class, another assignment')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- behind the assignment, still in mro(): instances, objects that a...")
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def row2(label, X, Y, Z, namespace):')
try: Plain = make('Plain', {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Plain = make('Plain', {})")
try: Empty = make('Empty', {'__slots__': ()})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Empty = make('Empty', {'__slots__': ()})")
try:
    for xk in ('object', 'plain', 'slots ()', 'slots a', 'slots dict'):
        for yk in ('object', 'slots ()', 'slots a', 'slots weakref'):
            for zk in KINDS:
                for nk in ('plain', 'slots ()', 'slots dict', 'slots weakref'):
                    try: row2('%-10s %-13s %-13s %-13s' % (xk, yk, zk, nk), make('X', KINDS[xk]), make('Y', KINDS[yk]), make('Z', KINDS[zk]), KINDS[nk])
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row2('%-10s %-13s %-13s %-13s' % (xk, yk, zk, nk), make('X', KINDS[xk...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for xk in ('object', 'plain', 'slots ()', 'slots a', 'slots dict'):")

try: print('--- a base that the class is given has a __new__ of the program\'s: instances are made in mro()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a base that the class is given has a __new__ of the program\\'s: ...")
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def row3(label, X, namespace):')
try:
    for xk in KINDS:
        for nk in ('plain', 'slots ()'):
            # (Only where the class adds nothing itself: CPython's instances of the window have no room for that, and it dies when they go.)
            if nk == 'slots ()' or xk in ('plain', 'slots both'): row3('%-13s %-13s' % (xk, nk), make('X', KINDS[xk]), KINDS[nk])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for xk in KINDS:')

try: print('--- cls.__bases__ += ()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- cls.__bases__ += ()'")
try:
    class Same(type):
        busy = False
        def mro(cls):
            if cls.__mro__ is None and not Same.busy:
                Same.busy = True
                try: cls.__bases__ += ()
                finally: Same.busy = False
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Same(type):')
try: A = Same('A', (), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: A = Same('A', (), {})")
try: S = Same('S', (), {'__slots__': ()})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: S = Same('S', (), {'__slots__': ()})")
try:
    for first, namespace in (((), {}), ((A,), {}), ((A,), {'__slots__': ()}), ((S,), {}), ((S,), {'__slots__': ()}), ((S,), {'__slots__': ('a',)}), ((S, A), {}), ((int,), {}), ((dict,), {}), ((Exception,), {}), ((type,), {})):
        try: N = attempt(lambda: Same('N', first, dict(namespace)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: N = attempt(lambda: Same('N', first, dict(namespace)))")
        try: print('short(first) [' + 'first=' + (repr(first) if type(first) in (str, int, float, bytes, bool, type(None)) or (type(first) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in first)) else first.__name__ if type(first) is type else type(first).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', short(first))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(first)')
        try: print('namespace [' + 'first=' + (repr(first) if type(first) in (str, int, float, bytes, bool, type(None)) or (type(first) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in first)) else first.__name__ if type(first) is type else type(first).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace')
        try: print('N if isinstance(N, str) else state(N, *first) [' + 'first=' + (repr(first) if type(first) in (str, int, float, bytes, bool, type(None)) or (type(first) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in first)) else first.__name__ if type(first) is type else type(first).__name__) + ", " + 'namespace=' + (repr(namespace) if type(namespace) in (str, int, float, bytes, bool, type(None)) or (type(namespace) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in namespace)) else namespace.__name__ if type(namespace) is type else type(namespace).__name__) + '] =>', N if isinstance(N, str) else state(N, *first))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N if isinstance(N, str) else state(N, *first)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for first, namespace in (((), {}), ((A,), {}), ((A,), {'__slots__': (...")
