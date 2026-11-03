V = [0, 1, -1, 2, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**53 - 1, 2**53, 2**53 + 1, -2**53, 2**64, 10**30,
     0.0, -0.0, 0.5, 1.0, -1.0, 1.5, 2147483647.0, 2147483648.0, 2147483647.5, 9007199254740992.0, 9007199254740993.0, 1e300, float("inf"), float("-inf"), float("nan"),
     True, False, None, "", "a", "b", "ab", (), (1,), (1, 2), [], [1], [1, 2], b"a", {1}, {1: 2}]
class E:
    def __init__(self, v): self.v = v
    def __eq__(self, o): return "eq" if self.v else ""
    def __ne__(self, o): return [] if self.v else [0]
    def __lt__(self, o): return self.v
    def __le__(self, o): return 0.0
    def __gt__(self, o): return NotImplemented
    def __ge__(self, o): raise ValueError("ge")
    def __repr__(self): return "E(%r)" % self.v
    __hash__ = None
class T:
    def __bool__(self): raise RuntimeError("no truth")
    def __repr__(self): return "T()"
class R:
    def __lt__(self, o): return T()
    def __eq__(self, o): return T()
    def __repr__(self): return "R()"
    __hash__ = None
V += [E(0), E(1), R()]

def v_eq(a, b): return a == b
def v_ne(a, b): return a != b
def v_lt(a, b): return a < b
def v_le(a, b): return a <= b
def v_gt(a, b): return a > b
def v_ge(a, b): return a >= b
def j_eq(a, b):
    if a == b: return "T"
    return "F"
def j_ne(a, b):
    if a != b: return "T"
    return "F"
def j_lt(a, b):
    if a < b: return "T"
    return "F"
def j_le(a, b):
    if a <= b: return "T"
    return "F"
def j_gt(a, b):
    if a > b: return "T"
    return "F"
def j_ge(a, b):
    if a >= b: return "T"
    return "F"
def n_eq(a, b):
    if not a == b: return "T"
    return "F"
def n_ne(a, b):
    if not a != b: return "T"
    return "F"
def n_lt(a, b):
    if not a < b: return "T"
    return "F"
def n_le(a, b):
    if not a <= b: return "T"
    return "F"
def n_gt(a, b):
    if not a > b: return "T"
    return "F"
def n_ge(a, b):
    if not a >= b: return "T"
    return "F"
def w_lt(a, b):
    n = 0
    while a < b:
        n += 1
        if n > 2: break
    return n
def o_lt(a, b): return "T" if a < b or a > b else "F"
def a_lt(a, b): return "T" if a <= b and a >= b else "F"
def c_3(a, b): return "T" if a < b < a else "F"
def c_4(a, b): return a <= b <= b
def c_5(a, b): return "T" if a == b != a else "F"
def is_(a, b): return a is b
def isnot(a, b): return "T" if a is not b else "F"
out = []
for f in [v_eq, v_ne, v_lt, v_le, v_gt, v_ge, j_eq, j_ne, j_lt, j_le, j_gt, j_ge, n_eq, n_ne, n_lt, n_le, n_gt, n_ge, w_lt, o_lt, a_lt, c_3, c_4, c_5]:
    for a in V:
        for b in V:
            try:
                r = repr(f(a, b))
            except Exception as e:
                r = type(e).__name__ + ":" + str(e)
            out.append("%s %r %r -> %s" % (f.__name__, a, b, r))
def truth(a):
    r = []
    r.append("T" if a else "F")
    r.append("T" if not a else "F")
    n = 0
    while a:
        n += 1
        break
    r.append(n)
    r.append(a and 1)
    r.append(a or 2)
    r.append(not a)
    r.append([x for x in (1,) if a])
    return r
class L0:
    def __len__(self): return 0
class L1:
    def __len__(self): return 1
class B0:
    def __bool__(self): return False
class LS(list): pass
class LB(list):
    def __bool__(self): return True
class SS(str): pass
class TS(tuple): pass
for a in V[:-3] + [L0(), L1(), B0(), LS(), LS([1]), LB(), SS(), SS("x"), TS(), TS((1,)), "a" + "b" * 3, "".join(["", ""]), range(0), range(1), 1e-320, object]:
    try:
        r = repr(truth(a))[:80] if not isinstance(a, (L0, L1, B0)) and a is not object else repr(truth(a)[:3])
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("truth %s -> %s" % (type(a).__name__, r))
import hashlib, sys
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
if len(sys.argv) > 1:
    print("\n".join(out))
