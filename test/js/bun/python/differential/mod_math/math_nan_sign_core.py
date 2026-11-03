# The sign of a NaN: a matter of how the runtime keeps floats, not of the module math.
import math

nan = float('nan')
for x in (nan, -nan, math.nan, -math.nan, float('-nan'), math.copysign(nan, -1.0), abs(-nan), -(-nan), nan * -1.0):
    print(math.copysign(1.0, x), math.signbit(x), math.isnan(x), repr(x))
print(math.copysign(nan, -1.0), math.fabs(-nan), math.copysign(2.0, -nan))
