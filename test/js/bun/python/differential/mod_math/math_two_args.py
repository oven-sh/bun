# The functions of two or three floats.
import math

inf = float('inf')
nan = float('nan')
V = [0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 2.0, -2.0, 3.0, -3.0, 2.5, -2.5, 1e-300, 5e-324, -5e-324, 1e300, -1e300, 1.7976931348623157e308,
     inf, -inf, nan, 1e16, 7.0, 0.1, -0.1, 1024.0, 1e-5]

def show(name, *args, **kw):
    try:
        r = repr(getattr(math, name)(*args, **kw))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)

for name in 'atan2 copysign fmod pow remainder fmax fmin nextafter hypot isclose log'.split():
    for x in V:
        for y in V:
            show(name, x, y)

for x in (1.0, -1.5, 0.0, -0.0, inf, nan, 5e-324, 1.7976931348623157e308, 0.75, 3):
    for i in (0, 1, -1, 10, -10, 1023, 1024, 1025, -1022, -1074, -1075, -1076, 2000, -2000, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**63, -2**63 - 1, 10**30, -10**30, True):
        show('ldexp', x, i)

W = [0.0, -0.0, 1.0, -1.0, 3.0, 1e308, -1e308, 1e-308, inf, -inf, nan, 0.1, 1e16]
for x in W:
    for y in W:
        for z in (0.0, -0.0, 1.0, -1e308, inf, -inf, nan, -0.30000000000000004):
            show('fma', x, y, z)
show('fma', 0.1, 10.0, -1.0)
show('fma', 1e-300, 1e-300, 5e-324)
show('fma', 2, 3, 4)

for x in (0.0, -0.0, 1.0, -1.0, 5e-324, -5e-324, inf, -inf, nan, 1.7976931348623157e308, 1e-310):
    for y in (0.0, -0.0, 1.0, -1.0, inf, -inf, nan, 5e-324, -5e-324):
        for steps in (0, 1, 2, 3, 10, 2**52, 2**62, 2**63, 2**63 + 5, 2**64 - 1, 2**64, 10**30, True, None):
            show('nextafter', x, y, steps=steps)

for a, b in ((1.0, 1.0000000001), (1.0, 1.00000001), (1e10, 1e10 + 1), (0.0, 1e-10), (inf, inf), (inf, -inf), (nan, nan), (1, 2), (1e308, -1e308)):
    for kw in ({}, {'rel_tol': 1e-5}, {'abs_tol': 1e-9}, {'rel_tol': 0.0}, {'rel_tol': 0.0, 'abs_tol': 2.0}, {'rel_tol': inf}, {'abs_tol': inf}, {'rel_tol': nan}, {'rel_tol': -1e-9}, {'abs_tol': -0.5}, {'rel_tol': 1}):
        show('isclose', a, b, **kw)
