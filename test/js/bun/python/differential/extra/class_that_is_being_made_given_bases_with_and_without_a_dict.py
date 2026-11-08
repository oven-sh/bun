# The mro() of a metaclass gives the class that is being made two bases, of which one has a __dict__ and the one that decides the layout has none, and the class adds none itself.
# CPython lets it through, its class says that it has a __dict__, and it mostly dies when an instance is looked at. Here it is let through as well, and the instances have a __dict__.
import gc, warnings, weakref; warnings.simplefilter('ignore')
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
KINDS = {'plain': {}, 'slots ()': {'__slots__': ()}, 'slots a': {'__slots__': ('a',)}, 'slots dict': {'__slots__': ('__dict__',)}, 'slots weakref': {'__slots__': ('__weakref__',)}, 'slots both': {'__slots__': ('__dict__', '__weakref__')}}
def look(o):
    def write(): o.zz = 1; return o.zz
    return [attempt(lambda: o.__dict__), attempt(lambda: vars(o)), attempt(write), attempt(lambda: weakref.ref(o)() is o), attempt(lambda: type(o.__weakref__).__name__), attempt(lambda: sorted(n for n in dir(o) if not n.startswith('__'))),
            attempt(lambda: o.__reduce_ex__(4)[2]), attempt(lambda: [type(r).__name__ for r in gc.get_referents(o)])]
for xk, xn in KINDS.items():
    for yk, yn in KINDS.items():
        for nk in ('plain', 'slots ()', 'slots weakref'):
            for first, given in (('X', 'Y X'), ('X', 'X Y'), ('X Y', 'Y X')):
                X = Early('X', (), dict(xn)); Y = Early('Y', (), dict(yn))
                pick = lambda names: tuple({'X': X, 'Y': Y}[n] for n in names.split())
                adds = '__slots__' not in KINDS[nk] and not any(b.__dictoffset__ for b in pick(first))
                if adds or len({b.__dictoffset__ != 0 for b in pick(given)}) != 2: continue
                out = []
                Early.act = lambda cls: out.append(assign(cls, pick(given)))
                N = attempt(lambda: Early('N', pick(first), dict(KINDS[nk])))
                Early.act = None
                if isinstance(N, str) or out != ['assigned']: continue
                class D(N): pass
                print('%-13s %-13s %-13s %-4s %-4s' % (xk, yk, nk, first, given), short(N.__mro__), N.__base__.__name__, N.__dictoffset__ != 0, N.__weakrefoffset__ != 0, look(N()), '| derived:', D.__dictoffset__ != 0, look(D())[:3])
gc.collect()
print('end')
