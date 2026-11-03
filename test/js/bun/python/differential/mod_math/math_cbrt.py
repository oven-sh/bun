# math.cbrt, apart from the other functions of one float: the C library's is off by one unit in the last place here and there,
# and not every C library, or every build of Bun, has the same one.
import math

inf = float('inf')
nan = float('nan')
VALUES = [
    0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 2.0, -2.0, 3.0, -3.0, 0.1, -0.1, 0.25, 0.75, 1.5, -1.5, 8.0, 27.0, -27.0, 64.0, 1000.0, 1e-9,
    5e-324, -5e-324, 2.2250738585072014e-308, 1e-300, -1e-300, 1e300, 1.7976931348623157e308, -1.7976931348623157e308, inf, -inf, nan,
    math.pi, math.e, 10.0, 100.0, 1e15, 1e100, 123456789.0, 0.3, 0.7,
]
state = 12345
for i in range(200):
    state = (state * 6364136223846793005 + 1442695040888963407) % 2 ** 64
    VALUES.append((state >> 11) / 2 ** 53 * 10.0 ** (state % 600 - 300))
for x in VALUES:
    print(repr(x), repr(math.cbrt(x)))
for x in ('a', None, 1j, 10 ** 400):
    try:
        print(math.cbrt(x))
    except Exception as e:
        print('%s: %s' % (type(e).__name__, e))
