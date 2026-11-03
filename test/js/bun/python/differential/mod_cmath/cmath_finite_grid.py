# Every function over finite arguments of many magnitudes, where the formulas change.
import cmath

state = 4242
def rnd():
    global state
    state = (state * 6364136223846793005 + 1442695040888963407) % 2**64
    return (state >> 11) / 2**53

NAMES = 'acos acosh asin asinh atan atanh cos cosh exp log log10 sin sinh sqrt tan tanh phase polar'.split()

def show(name, *args):
    try:
        r = repr(getattr(cmath, name)(*args))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, r)

EDGES = [1.0, 0.9999999999999999, 1.0000000000000002, 0.71, 0.7099999999999999, 1.73, 1.7300000000000002, 0.5, 2.0,
         4.4942328371557893e+307, 4.49423283715579e+307, 6.703903964971298e+153, 6.703903964971299e+153, 708.3964185322641, 708.3964185322642, 709.0, 710.0, 711.0,
         1.4916681462400413e-154, 1.491668146240041e-154, 2.2250738585072014e-308, 2.225073858507201e-308, 1e-310, 5e-324, 1.7976931348623157e308, 1e-200, 1e200, 1e-17, 1e17, 0.0]
Z = []
for a in EDGES:
    for b in (0.0, 1.0, 1e-300, 1e300, 5e-324, a):
        Z.append(complex(a, b))
        Z.append(complex(-a, b))
        Z.append(complex(b, -a))
        Z.append(complex(-b, a))
for scale in (1e-310, 1e-160, 1e-20, 1e-3, 0.5, 1.0, 3.0, 30.0, 500.0, 1e10, 1e100, 1e160, 1e300):
    for i in range(3):
        Z.append(complex((rnd() - 0.5) * scale, (rnd() - 0.5) * scale))
        Z.append(complex((rnd() - 0.5) * scale, (rnd() - 0.5)))
        Z.append(complex((rnd() - 0.5), (rnd() - 0.5) * scale))
# On and near the unit circle, where log() takes care.
for i in range(24):
    t = i * 0.2617993877991494
    z = cmath.rect(1.0, t)
    Z.append(z)
    Z.append(z * 1.0000001)
    Z.append(z * 0.72)
for name in NAMES:
    for z in Z:
        show(name, z)
for r in (0.0, -0.0, 1.0, -1.0, 2.5, 1e308, 1e-308, 5e-324, 1.7976931348623157e308):
    for phi in (0.0, -0.0, 1.0, -1.0, 3.141592653589793, 1.5707963267948966, 0.7853981633974483, 100.0, 1e22, 1e-300, 1e308):
        show('rect', r, phi)
