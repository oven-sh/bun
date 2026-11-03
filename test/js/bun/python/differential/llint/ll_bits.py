I = [0, 1, -1, 2, -2, 3, 5, 7, -7, 8, 15, 16, 30, 31, 32, 33, 62, 63, 64, 65, 100, 255, 65535, 2**30, -2**30, 2**31 - 1, 2**31, -2**31, -2**31 - 1,
     2**32, 2**52, 2**53 - 1, 2**53, -2**53, 2**64, -2**64, 10**20]
def band(a, b): return a & b
def bor(a, b): return a | b
def bxor(a, b): return a ^ b
def shl(a, b): return a << b
def shr(a, b): return a >> b
def iband(a, b):
    a &= b
    return a
def ibor(a, b):
    a |= b
    return a
def ibxor(a, b):
    a ^= b
    return a
def ishl(a, b):
    a <<= b
    return a
def ishr(a, b):
    a >>= b
    return a
def power(a, b): return a ** b
def neg(a, b): return -a
def pos(a, b): return +a
def inv(a, b): return ~a
def no(a, b): return not a
out = []
for op in [band, bor, bxor, shl, shr, iband, ibor, ibxor, ishl, ishr, neg, pos, inv, no]:
    for a in I + [True, False, 1.5, -0.0, 0.0, 2.0, float("inf"), float("nan"), None, "", "x", [], [0], (), (0,), {}, {1: 1}]:
        for b in (I + [True, False, 1.5] if op not in (neg, pos, inv, no) else [0]):
            if op in (shl, ishl) and isinstance(b, int) and b > 1000: continue
            try:
                r = op(a, b)
                r = type(r).__name__ + ":" + repr(r)
            except Exception as e:
                r = type(e).__name__ + ":" + str(e)
            out.append("%s %r %r -> %s" % (op.__name__, a, b, r))
for a in [0, 1, -1, 2, -2, 3, 10, 2**16, 2**31, 1.5, -1.5, 0.0]:
    for b in [0, 1, -1, 2, 3, 31, 32, 62, 63, 64, 0.5, -0.5]:
        try:
            r = power(a, b)
            r = type(r).__name__ + ":" + repr(r)
        except Exception as e:
            r = type(e).__name__ + ":" + str(e)
        out.append("pow %r %r -> %s" % (a, b, r))
import hashlib, sys
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
if len(sys.argv) > 1:
    print("\n".join(out))
