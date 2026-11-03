# Arithmetic on every pair of interesting numbers, through variables (so nothing is folded), in functions and in place.
import math
I = [0, 1, -1, 2, -2, 3, -3, 7, -7, 10, 31, 32, 33, 63, 64, 100, 255, 256, 65535, 65536, 46340, 46341, -46341,
     2**30, -2**30, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**31 + 1, 2**32, -2**32, 2**32 + 5, 2**52, 2**52 + 1, -2**52,
     2**53 - 1, 2**53, 2**53 + 1, -(2**53 - 1), -2**53, -2**53 - 1, 2**62, 2**63, 2**64, -2**63, 10**18, 10**30, 3 * 2**51, 4503599627370497]
F = [0.0, -0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, 2.5, 3.0, 1e-300, -1e-300, 5e-324, 1e300, -1e300, 1.7976931348623157e308,
     float(2**31), float(2**31) - 0.5, float(-2**31), float(2**52), float(2**52) + 0.5, float(2**53), float(2**53) - 1.0, -float(2**53), float(2**53) + 2.0,
     9007199254740000.0, float("inf"), float("-inf"), float("nan"), 0.1, 0.2, 0.30000000000000004, 1e16, 123456789.125, 4294967296.0, 4294967295.5]
B = [True, False]

def show(v):
    if isinstance(v, float):
        return "f:" + repr(v)
    return type(v).__name__[0] + ":" + repr(v)

def add(a, b): return a + b
def sub(a, b): return a - b
def mul(a, b): return a * b
def div(a, b): return a / b
def fdiv(a, b): return a // b
def mod(a, b): return a % b
def iadd(a, b):
    a += b
    return a
def isub(a, b):
    a -= b
    return a
def imul(a, b):
    a *= b
    return a
def idiv(a, b):
    a /= b
    return a
def ifdiv(a, b):
    a //= b
    return a
def imod(a, b):
    a %= b
    return a
OPS = [add, sub, mul, div, fdiv, mod, iadd, isub, imul, idiv, ifdiv, imod]

def run(xs, ys, label):
    h = 0
    lines = []
    for op in OPS:
        for a in xs:
            for b in ys:
                try:
                    r = show(op(a, b))
                except Exception as e:
                    r = type(e).__name__ + ":" + str(e)
                lines.append("%s %s %r %r -> %s" % (label, op.__name__, a, b, r))
    return lines

out = []
out += run(I, I, "II")
out += run(I, F, "IF")
out += run(F, I, "FI")
out += run(F, F, "FF")
out += run(B, I[:12], "BI")
out += run(I[:12], B, "IB")
out += run(B, F[:10], "BF")
out += run(F[:10], B, "FB")
out += run(["a", [1], (1,), None], [2, 2.5, "b", [2], (2,)], "OX")
import hashlib
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
import sys
if len(sys.argv) > 1:
    print("\n".join(out))
