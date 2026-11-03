# Every function of one float, over special values and the edges of their domains.
import math

inf = float('inf')
nan = float('nan')
VALUES = [
    0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 2.0, -2.0, 3.0, -3.0, 0.1, -0.1, 0.25, 0.75, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5,
    5e-324, -5e-324, 1e-323, 2.2250738585072014e-308, 2.225073858507201e-308, -2.2250738585072014e-308, 1e-300, -1e-300,
    1e-20, 9.9e-21, -1e-20, 1e-16, 1e-8, 1e-5, 0.9999999999999999, 1.0000000000000002, -0.9999999999999999, -1.0000000000000002,
    math.pi, -math.pi, math.pi / 2, math.pi / 4, math.e, math.tau, 10.0, 100.0, 1000.0, 1e5, 1e10, 1e15, 1e16, 1e17, 1e22, 1e100,
    1e300, -1e300, 1.7976931348623157e308, -1.7976931348623157e308, inf, -inf, nan,
    709.0, 709.782712893384, 709.7827128933841, 710.0, -708.0, -745.0, -745.1332191019411, -745.1332191019412, -746.0,
    1023.0, 1024.0, 1023.9999999999999, -1074.0, -1075.0, -1076.0, 88.0, 36.0, 37.0, 19.0, 22.0, 26.0, 27.0, 6.0, -6.0,
    4503599627370496.0, 4503599627370497.0, 9007199254740992.0, 9007199254740993.0, -9007199254740992.0, 4503599627370495.5,
    170.0, 171.0, 171.6, 171.7, 172.0, 23.0, 24.0, 143.0, 140.0, 139.5, 140.5, 199.5, 200.5, -170.5, -171.5, -180.5, -199.5, -200.5, -1000.5,
    8.0, 27.0, -27.0, 64.0, 1e-9, 123456789.0, 0.3, 0.7, 4.0, 16.0, 1e-154, 1e154, 1.3407807929942596e154,
]
NAMES = '''acos acosh asin asinh atan atanh ceil cos cosh degrees erf erfc exp exp2 expm1 fabs floor frexp gamma
isfinite isinf isnan isnormal issubnormal lgamma log log10 log1p log2 modf radians signbit sin sinh sqrt tan tanh trunc ulp'''.split()

for name in NAMES:
    f = getattr(math, name)
    for x in VALUES:
        try:
            r = repr(f(x))
        except Exception as e:
            r = '%s: %s' % (type(e).__name__, e)
        print(name, repr(x), r)
