# log with a base, isclose, conversions of the arguments, complaints, constants.
import cmath

inf = float('inf')
nan = float('nan')

def show(name, *args, **kw):
    try:
        r = getattr(cmath, name)(*args, **kw)
        r = '%s %r' % (type(r).__name__, r)
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)

print(sorted(n for n in dir(cmath) if not n.startswith('__')))
for n in ('pi', 'e', 'tau', 'inf', 'nan', 'infj', 'nanj'):
    print(n, type(getattr(cmath, n)).__name__, repr(getattr(cmath, n)))
print(cmath.__name__, repr(cmath.__doc__), cmath.sqrt.__module__, cmath.sqrt.__name__, repr(cmath.sqrt))

V = [0, 1, -1, 2, 10, 0.5, 1j, -1j, 1 + 1j, -2.5 + 3j, 0j, complex(-0.0, 0.0), complex(0.0, -0.0), complex(-0.0, -0.0), inf, -inf, nan, complex(inf, inf), complex(nan, inf), complex(0, inf), 1e308, 1e-308, complex(1e308, 1e308), 5e-324, cmath.e, 100]
for x in V:
    for b in V:
        show('log', x, b)

class Cx:
    def __init__(self, v): self.v = v
    def __complex__(self): return self.v
    def __repr__(self): return 'Cx(%r)' % (self.v,)
class Fl:
    def __init__(self, v): self.v = v
    def __float__(self): return self.v
    def __repr__(self): return 'Fl(%r)' % (self.v,)
class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%r)' % (self.v if self.v < 10**30 else 'huge',)
class All:
    def __complex__(self): return 4j
    def __float__(self): return 9.0
    def __index__(self): return 16
    def __repr__(self): return 'All()'
class C(complex):
    pass
class C2(complex):
    def __complex__(self): return 100j
class F(float):
    pass
class Raises:
    def __complex__(self): raise KeyError('complex')
    def __repr__(self): return 'Raises()'
class NoneMethod:
    __complex__ = None
    def __float__(self): return 4.0
    def __repr__(self): return 'NoneMethod()'
class Inst:
    def __repr__(self): return 'Inst()'
inst = Inst()
inst.__complex__ = lambda: 4j

OBJECTS = [4, -4, True, 4.0, -4.0, 4j, C(4j), C2(4j), F(4.0), Cx(4j), Cx(-4 + 0j), Cx(4), Cx(4.0), Cx('a'), Cx(None), Fl(4.0), Fl(4), Idx(4), Idx(10**400), All(), Raises(), NoneMethod(), inst,
           10**400, -10**400, 2**1023, 'a', b'a', None, [], (), object, '4', '4j']
for name in ('sqrt', 'exp', 'log', 'phase', 'polar', 'isnan', 'isfinite', 'isinf', 'acos', 'log10'):
    for x in OBJECTS:
        show(name, x)
for x in OBJECTS:
    show('rect', x, 0)
    show('rect', 1, x)
    show('log', 4, x)
    show('isclose', x, 4)
    show('isclose', 4, x)

for a, b in ((1, 1), (1, 1.0000000001), (1, 1.00000001), (1j, 1.0000000001j), (1 + 1j, 1 + 1.0000000001j), (0, 1e-10), (0j, 1e-10j), (inf, inf), (inf, -inf), (complex(inf, 1), complex(inf, 1)), (complex(inf, 1), complex(inf, 2)),
             (complex(0, inf), complex(0, inf)), (nan, nan), (complex(nan, 1), complex(nan, 1)), (1e308, -1e308), (complex(1e308, 1e308), complex(-1e308, -1e308)), (1, 2), (3 + 4j, 3 + 4j), (3 + 4j, 3.000001 + 4j)):
    for kw in ({}, {'rel_tol': 1e-5}, {'abs_tol': 1e-9}, {'rel_tol': 0.0}, {'rel_tol': 0.0, 'abs_tol': 2.0}, {'rel_tol': inf}, {'abs_tol': inf}, {'rel_tol': nan}, {'rel_tol': -1e-9}, {'abs_tol': -0.5}, {'rel_tol': 1}):
        show('isclose', a, b, **kw)
show('isclose', 1, 1, rel_tol=1j)
show('isclose', 1, 1, abs_tol='a')
show('isclose', 1, 1, 1e-9)
show('isclose', 1)
show('isclose')
show('isclose', a=1, b=1)
show('isclose', 1, b=1)
show('isclose', 1, 1, x=1)
show('isclose', 1, 1, a=1)

for name in sorted(n for n in dir(cmath) if not n.startswith('_') and callable(getattr(cmath, n))):
    for args in ((), (1,), (1, 2), (1, 2, 3), (1, 2, 3, 4)):
        try:
            getattr(cmath, name)(*args)
        except TypeError as e:
            print(name, len(args), 'TypeError:', e)
        except Exception:
            pass
    for kw in ({'z': 1}, {'zzz': 1}):
        try:
            getattr(cmath, name)(**kw)
        except TypeError as e:
            print(name, kw, 'TypeError:', e)
        except Exception:
            pass
    try:
        getattr(cmath, name)(1, zzz=1)
    except TypeError as e:
        print(name, '1, zzz', 'TypeError:', e)
    except Exception:
        pass

# phase() goes by errno.
for z in (complex(1e308, 5e-324), complex(1e308, 1e-300), complex(1.0, 5e-324), complex(1.0, 1e-308), complex(2.0, 2.2250738585072014e-308), complex(-1e308, 5e-324), complex(1e300, 1e-10), complex(1e308, -5e-324), complex(5e-324, 1e308)):
    show('phase', z)
    show('polar', z)
    show('log', z)
