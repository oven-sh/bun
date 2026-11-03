# Arguments that are not plain floats: special methods, subclasses, huge ints; and the wording of the complaints.
import math

def show(name, *args, **kw):
    try:
        r = getattr(math, name)(*args, **kw)
        r = '%s %r' % (type(r).__name__, r)
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)

class Fl:
    def __init__(self, v): self.v = v
    def __float__(self): return self.v
    def __repr__(self): return 'Fl(%r)' % (self.v,)
class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%r)' % (self.v if self.v < 10**30 else 'huge',)
class Both:
    def __float__(self): return 2.5
    def __index__(self): return 7
    def __repr__(self): return 'Both()'
class F(float):
    pass
class F2(float):
    def __float__(self): return 100.0
    def __ceil__(self): return 'ceil'
    def __floor__(self): return 'floor'
    def __trunc__(self): return 'trunc'
class I(int):
    pass
class I2(int):
    def __ceil__(self): return 'ceil'
    def __floor__(self): return 'floor'
    def __trunc__(self): return 'trunc'
class R:
    def __ceil__(self): return 'c'
    def __floor__(self): return ['f']
    def __trunc__(self): return None
    def __repr__(self): return 'R()'
class Raises:
    def __ceil__(self): raise KeyError('ceil')
    def __floor__(self): raise KeyError('floor')
    def __trunc__(self): raise KeyError('trunc')
    def __float__(self): raise KeyError('float')
    def __repr__(self): return 'Raises()'
class NoneMethods:
    __ceil__ = None
    __floor__ = None
    __trunc__ = None
    def __float__(self): return 1.5
    def __repr__(self): return 'NoneMethods()'
class Inst:
    def __repr__(self): return 'Inst()'
inst = Inst()
inst.__ceil__ = lambda: 1
inst.__floor__ = lambda: 1
inst.__trunc__ = lambda: 1
inst.__float__ = lambda: 1.0

OBJECTS = [1, -1, 0, True, False, 2**53 + 1, 10**30, -10**30, 10**400, -10**400, 1.5, -1.5, F(2.5), F2(2.5), I(3), I2(3), Fl(2.5), Fl(-0.0), Fl(1), Fl('a'), Fl(F(1.25)), Idx(3), Idx(10**400), Both(), R(), Raises(),
           NoneMethods(), inst, 'a', b'a', None, [], (), 1j, object, float('inf'), float('-inf'), float('nan'), 1e300, -1e300, 4.0, -4.0, -0.0, 0.5, -0.5]
for name in ('ceil', 'floor', 'trunc', 'sqrt', 'fabs', 'log', 'log2', 'log10', 'isnan', 'exp', 'frexp', 'modf', 'ulp', 'degrees'):
    for x in OBJECTS:
        show(name, x)

# Logarithms of ints.
for n in (1, 2, 3, 10, 1000, 2**10, 2**52, 2**53, 2**53 + 1, 2**63, 2**64, 10**15, 10**16, 10**22, 10**23, 10**100, 10**308, 10**309, 2**1023, 2**1024 - 2**970, 2**1024 - 2**970 - 1, 2**1024 - 1, 2**1024, 2**1024 + 1, 2**1025, 3**700, 10**400, 10**1000, 2**10000, 2**10000 - 1,
          2**10000 + 2**9947, 2**10000 + 2**9947 + 1, 2**10000 + 2**9946, 2**10000 + 3 * 2**9947, 7**5000, 0, -1, -10**400):
    for name in ('log', 'log2', 'log10'):
        try:
            r = repr(getattr(math, name)(n))
        except Exception as e:
            r = '%s: %s' % (type(e).__name__, e)
        print(name, 'int of %d bits' % n.bit_length(), n % 1000003, r)
for x, b in ((8, 2), (1000, 10), (10**400, 10), (10**400, 10**200), (2**2000, 2), (2**2000, 2**1000), (2.0, 10**400), (10, 1), (10, 1.0), (10, 0), (10, 0.0), (10, -1), (0, 10), (10, float('inf')), (float('inf'), 10), (float('inf'), float('inf')),
             (10, float('nan')), (1, 1), (1, 2), (10, None), (None, 10), (10, 'a'), ('a', 10), (Idx(10**400), Idx(10**200)), (Fl(8.0), Fl(2.0)), (True, 2), (2, True), (0.5, 0.25), (math.e, math.e), (100, 0.1)):
    show('log', x, b)

# The number of arguments, and keywords.
for name in sorted(n for n in dir(math) if not n.startswith('_') and callable(getattr(math, n))):
    for args in ((), (1,), (1, 1), (1, 1, 1), (1, 1, 1, 1), (1, 1, 1, 1, 1)):
        try:
            getattr(math, name)(*args)
        except TypeError as e:
            print(name, len(args), 'TypeError:', e)
        except Exception as e:
            pass
    for kw in ({'x': 1}, {'zzz': 1}):
        try:
            getattr(math, name)(**kw)
        except TypeError as e:
            print(name, kw, 'TypeError:', e)
        except Exception as e:
            pass
    try:
        getattr(math, name)(1, zzz=1)
    except TypeError as e:
        print(name, '1, zzz', 'TypeError:', e)
    except Exception as e:
        pass
show('isclose', 1, b=1)
show('isclose', a=1, b=1)
show('isclose', b=1)
show('isclose', 1, 1, rel_tol='a')
show('isclose', 1, 1, abs_tol=None)
show('isclose', 'a', 1)
show('isclose', 1, 1, 1e-9)
show('isclose', 1, 1, rel_tol=1, abs_tol=1, x=1)
show('isclose', 1, 1, a=1)
show('nextafter', 1, 2, 3)
show('nextafter', 1, 2, steps='a')
show('nextafter', 1, 2, steps=1.5)
show('nextafter', 1, 2, steps=Idx(2))
show('nextafter', 1, 2, steps=-1)
show('nextafter', 1, 2, step=1)
show('nextafter', x=1, y=2)
show('prod', [1], 2)
show('prod', [1], start=2, x=1)
show('prod', iterable=[1])
show('prod', [2], start=None)
show('ldexp', 1.0, 1.0)
show('ldexp', 1.0, Idx(1))
show('ldexp', 1.0, I(3))
show('ldexp', 'a', 1)
show('ldexp', 'a', 'b')
show('ldexp', 1.0, None)
show('hypot', x=1)
show('hypot', 1, x=1)
show('fsum', seq=[1])
show('dist', p=[1], q=[2])
show('sumprod', p=[1], q=[2])
show('fma', 1, 2, 'a')
show('fma', 'a', 'b', 'c')
show('pow', 'a', 1)
show('pow', 1, 'a')
show('atan2', 'a', 'b')
show('atan2', 1, None)
show('fmod', None, 'b')
show('copysign', Fl(2.0), Idx(-3))
show('remainder', F(5.5), I(2))
