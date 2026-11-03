# Every function of one float, over pseudo-random arguments of many magnitudes.
import math

state = 12345
def rnd():
    global state
    state = (state * 6364136223846793005 + 1442695040888963407) % 2**64
    return (state >> 11) / 2**53

VALUES = []
for scale in (1e-300, 1e-100, 1e-10, 1e-3, 0.1, 1.0, 2.0, 10.0, 50.0, 300.0, 700.0, 1e5, 1e10, 1e20, 1e100, 1e300):
    for i in range(5):
        x = rnd() * scale
        VALUES.append(x)
        VALUES.append(-x)
NAMES = '''acos acosh asin asinh atan atanh ceil cos cosh degrees erf erfc exp exp2 expm1 fabs floor frexp gamma
lgamma log log10 log1p log2 modf radians sin sinh sqrt tan tanh trunc ulp'''.split()

for name in NAMES:
    f = getattr(math, name)
    for x in VALUES:
        try:
            r = repr(f(x))
        except Exception as e:
            r = '%s: %s' % (type(e).__name__, e)
        print(name, repr(x), r)
