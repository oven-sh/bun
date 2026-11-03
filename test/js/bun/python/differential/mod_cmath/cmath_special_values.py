# Every function, for every combination of the kinds of real and imaginary part that Annex G of C99 tells apart.
import cmath

inf = float('inf')
nan = float('nan')
PARTS = [-inf, -2.3, -1.0, -0.0, 0.0, 1.0, 2.3, inf, nan, -1e308, 1e308, 5e-324, -5e-324, 0.5, 710.0, -710.0, 3.0, -4.0]
NAMES = 'acos acosh asin asinh atan atanh cos cosh exp log log10 sin sinh sqrt tan tanh phase polar isfinite isinf isnan'.split()

def show(name, *args):
    try:
        r = repr(getattr(cmath, name)(*args))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, r)

for name in NAMES:
    for re in PARTS:
        for im in PARTS:
            show(name, complex(re, im))
for r in PARTS:
    for phi in PARTS:
        show('rect', r, phi)
