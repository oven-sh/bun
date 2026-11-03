# What the modules contain.
import math, sys

print(sorted(n for n in dir(math) if not n.startswith('__')))
for n in ('pi', 'e', 'tau', 'inf', 'nan'):
    v = getattr(math, n)
    print(n, type(v).__name__, repr(v), v.hex() if v == v and v != math.inf else '')
print(math.__name__, repr(math.__doc__))
print(math.copysign(1.0, math.nan))
print(type(math.sin).__name__, math.sin.__name__, math.sin.__qualname__, math.sin.__module__, repr(math.sin), math.sin.__self__ is math)
print(type(math.integer).__name__, math.integer.__name__, repr(math.integer.__doc__))
print(sorted(n for n in dir(math.integer) if not n.startswith('__')))
for n in ('comb', 'factorial', 'gcd', 'isqrt', 'lcm', 'perm'):
    f = getattr(math, n)
    print(n, f is getattr(math.integer, n), f.__module__, f.__name__, f.__qualname__, repr(f))
print(sys.modules['math.integer'] is math.integer, sys.modules['_math_integer'] is math.integer)
import math.integer
print(math.integer.gcd(12, 18))
from math.integer import gcd, lcm as L
print(gcd(4, 6), L(4, 6))
from math import integer as mi
print(mi is math.integer)
import _math_integer
print(_math_integer is math.integer, _math_integer.__name__)
try:
    import math.nothing
except ImportError as e:
    print(type(e).__name__, e)
try:
    from math import nothing
except ImportError as e:
    print(type(e).__name__, str(e).split(' (')[0])
try:
    math.nothing
except AttributeError as e:
    print(type(e).__name__, e)

import _statistics
print(sorted(n for n in dir(_statistics) if not n.startswith('__')), _statistics.__name__, repr(_statistics.__doc__))
f = _statistics._normal_dist_inv_cdf
print(f.__name__, f.__module__)
def show(*args, **kw):
    try:
        r = repr(f(*args, **kw))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(args, kw or '', r)
for i in range(1, 200):
    show(i / 200, 0.0, 1.0)
for p in (1e-300, 1e-100, 1e-20, 1e-10, 1e-5, 0.001, 0.01, 0.074, 0.075, 0.076, 0.924, 0.925, 0.926, 0.99, 0.999, 0.99999, 1 - 1e-10, 1 - 1e-16, 5e-324, 0.5, 1.3887943864964021e-11, 1.3887943864964e-11):
    show(p, 0.0, 1.0)
    show(p, 100.0, 15.0)
    show(p, -3, 2)
for args in ((0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (-0.5, 0.0, 1.0), (1.5, 0.0, 1.0), (float('nan'), 0.0, 1.0), (float('inf'), 0.0, 1.0), (0.5, float('nan'), 1.0), (0.25, 0.0, float('inf')), (0.25, 0.0, 0.0), (0.25, 0.0, -1.0),
             (0.5,), (0.5, 0.0), (0.5, 0.0, 1.0, 2.0), ('a', 0.0, 1.0), (0.5, 'a', 1.0), (0.5, 0.0, None), (True, 0, 1), ()):
    show(*args)
show(p=0.5, mu=0.0, sigma=1.0)
