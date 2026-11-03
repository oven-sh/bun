def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

x = 10
x += 5; print(x); x -= 3; print(x); x *= 2; print(x); x /= 4; print(x); x //= 2; print(x); x **= 3; print(x); x %= 5; print(x)
x = 12; x &= 10; print(x); x |= 5; print(x); x ^= 6; print(x); x <<= 3; print(x); x >>= 2; print(x)
x = 7; x //= 2; print(x); x = -7; x //= 2; print(x); x = 7; x %= -3; print(x); x = 2; x **= -1; print(x); x = 2; x **= 100; print(x); x = 2 ** 62; x += 2 ** 62; print(x); x = 2 ** 63; x -= 1; print(x); x = 10 ** 20; x //= 10 ** 19; print(x, type(x))
s = "a"; s += "b"; print(s); s *= 3; print(s); s %= (); print(s); s = "%d"; s %= 5; print(s)
f = 1.5; f += 1; print(f); f *= 2; print(f); f //= 2; print(f); f **= 2; print(f); f %= 3; print(f)
b = True; b += 1; print(b, type(b)); b = True; b &= False; print(b, type(b)); b = True; b |= 2; print(b, type(b))
c = 1j; c *= 1j; print(c); c += 1; print(c)
# Mutable objects are changed in place; immutable ones are rebound.
l = [1]; a = l; l += [2]; print(l, a, l is a); l = l + [3]; print(l, a, l is a)
l = [1]; a = l; l *= 2; print(l, a, l is a)
tp = (1,); a = tp; tp += (2,); print(tp, a, tp is a); tp *= 2; print(tp)
st = {1}; a = st; st |= {2}; print(st, a is st); st &= {2}; print(st, a is st); st ^= {3}; print(st, a is st); st -= {2}; print(st, a is st)
fs = frozenset({1}); a = fs; fs |= {2}; print(fs, a, a is fs)
d = {1: 1}; a = d; d |= {2: 2}; print(d, a is d)
ba = bytearray(b"a"); a = ba; ba += b"b"; print(ba, a is ba); ba *= 2; print(ba, a is ba)
by = b"a"; a = by; by += b"b"; print(by, a)
s = "a"; a = s; s += "b"; print(s, a)
# list += accepts any iterable, list + does not.
l = []; l += "ab"; l += (1, 2); l += {3: 4}; l += range(2); l += (x for x in [9]); print(l)
def f1():
    l = []; l += 5
def f2():
    l = []; l = l + "ab"
def f3():
    l = []; l += None
def f4():
    tp = (); tp += [1]
def f5():
    s = ""; s += 1
def f6():
    x = 1; x += "a"
def f7():
    x = None; x += 1
def f8():
    d = {}; d += {}
def f9():
    d = {}; d |= [1]
def f10():
    d = {}; d |= [(1, 2)]; return d
def f11():
    st = set(); st |= [1]
def f12():
    st = set(); st += {1}
def f13():
    l = [1]; l *= "a"
def f14():
    l = [1]; l -= [1]
def f15():
    x = 1; x /= 0
def f16():
    x = 1; x @= 2
def f17():
    x = 1.5; x <<= 1
def f18():
    x = "a"; x -= "a"
def f19():
    undefined_aug += 1
def f20():
    loc += 1; loc = 0
def f21():
    x = 1; x **= "a"
def f22():
    x = [1]; x //= 2
def f23():
    x = 5; x >>= -1
def f24():
    x = object(); x += 1
def f25():
    x = 1; x %= 0
for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25): t(f)
# Targets.
l = [1, 2, 3]; l[0] += 10; l[-1] *= 2; print(l); l[1:2] += [7, 8]; print(l); l[:] *= 2; print(l); l[::2] = [0] * len(l[::2]); print(l)
d = {"a": 1}; d["a"] += 1; print(d); t(lambda: exec("d['zz'] += 1", {"d": d})); d["l"] = []; d["l"] += [1]; d["l"].append(2); print(d)
class O: pass
o = O(); o.x = 1; o.x += 1; print(o.x); t(lambda: exec("o.nope += 1", {"o": o}))
class CA: n = 0
c1 = CA(); c1.n += 1; print(c1.n, CA.n, c1.__dict__); CA.n += 5; print(c1.n, CA.n, CA().n)
class CL: l = []
c2 = CL(); c2.l += [1]; print(c2.l, CL.l, c2.__dict__, c2.l is CL.l)
nested = {"a": [{"b": 1}]}; nested["a"][0]["b"] += 1; print(nested)
m = [[0] * 2 for _ in range(2)]; m[0][1] += 5; m[1][0] -= 5; print(m)
# A tuple holding a list: the in-place operation succeeds, then the store fails.
tp = ([1],)
try: tp[0] += [2]
except TypeError as e: print("TypeError:", e, tp)
tp = ([1],); tp[0].extend([2]); print(tp)
# __iadd__ and friends.
class I:
    def __init__(s, v): s.v = v
    def __iadd__(s, o): s.v += o; return s
    def __isub__(s, o): return I(s.v - o)
    def __imul__(s, o): return "replaced by a string"
    def __itruediv__(s, o): return None
    def __ifloordiv__(s, o): return NotImplemented
    def __floordiv__(s, o): return "fell back to __floordiv__"
    def __imod__(s, o): return NotImplemented
    def __ipow__(s, o): return ("ipow", o)
    def __imatmul__(s, o): return ("imatmul", o)
    def __ilshift__(s, o): return ("ilshift", o)
    def __irshift__(s, o): return ("irshift", o)
    def __iand__(s, o): return ("iand", o)
    def __ior__(s, o): return ("ior", o)
    def __ixor__(s, o): return ("ixor", o)
    def __repr__(s): return "I(%r)" % s.v
i = I(1); a = i; i += 5; print(i, a is i); i -= 1; print(i, a is i, a); i *= 2; print(i)
i = I(1); i /= 2; print(i); i = I(1); i //= 2; print(i)
def imod():
    i = I(1); i %= 2
t(imod)
class RM:
    def __rmod__(s, o): return "right operand's __rmod__"
i = I(1); i %= RM(); print(i)
for op in ("**=", "@=", "<<=", ">>=", "&=", "|=", "^="):
    ns = {"i": I(1)}; exec("i %s 3" % op, ns); print(ns["i"], end=" ")
print()
class OnlyAdd:
    def __init__(s, v): s.v = v
    def __add__(s, o): return OnlyAdd(s.v + o)
    def __repr__(s): return "OnlyAdd(%r)" % s.v
x = OnlyAdd(1); a = x; x += 1; print(x, a, x is a)
class OnlyRadd:
    def __radd__(s, o): return ("radd", o)
x = 1; x += OnlyRadd(); print(x); x = [1]; x += OnlyRadd() if False else [2]; print(x)
def list_iadd_radd():
    x = [1]; x += OnlyRadd(); return x
t(list_iadd_radd)
class IRaises:
    def __iadd__(s, o): raise ValueError("iadd failed")
def ir():
    x = IRaises(); x += 1
t(ir)
# Properties and descriptors: get, then set.
class P:
    def __init__(s): s._v = 1
    @property
    def v(s): print("get", end="; "); return s._v
    @v.setter
    def v(s, x): print("set", x, end="; "); s._v = x
p = P(); p.v += 1; p.v *= 10; print(p._v)
class RO:
    @property
    def v(s): return [1]
def ro():
    r = RO(); r.v += [2]
t(ro)
class It:
    def __init__(s): s.d = {}
    def __getitem__(s, k): print("getitem", k, end="; "); return s.d.get(k, 0)
    def __setitem__(s, k, v): print("setitem", k, v, end="; "); s.d[k] = v
it = It(); it["a"] += 1; it["a"] += 1; it[1, 2] += 5; it[1:2] += 1; print(it.d)
# Scoping.
g = 1
def use_global():
    global g
    g += 1
use_global(); print(g)
def closure():
    n = 0
    def inc():
        nonlocal n
        n += 1
        return n
    return inc(), inc(), n
print(closure())
def no_nonlocal():
    n = 0
    def inc(): n += 1
    inc()
t(no_nonlocal)
class Body:
    v = 1; v += 1
    g += 100
print(Body.v, Body.g, g)
for i in range(3): i += 10
print(i)
acc = 0
for v in range(5): acc += v
print(acc)
r = [0]
[r.__setitem__(0, r[0] + v) for v in range(4)]; print(r)
w = 0
print([(w := w + v) for v in range(4)], w)
for src in ("x += 1", "x + = 1", "x =+ 1", "x += += 1", "x += y += 1", "x = y += 1", "x += y = 1", "(x) += 1", "((x)) += 1", "(x, y) += 1", "x, y += 1", "[x] += 1", "[x, y] += 1", "x() += 1", "x.y() += 1", "1 += 1", "'a' += 'b'", "None += 1", "x + y += 1", "-x += 1", "x[0] += 1", "x.y += 1", "x[0].y[1] += 1", "x[1:2] += y", "*x += 1", "x += *y", "x += *y, z", "x += y, z", "x += (yield)", "x += yield", "def f(): x += yield", "x += lambda: 1", "x += y if z else w", "x if y else z += 1", "x: int += 1", "x += 1: int", "(x := 1) += 1", "x += (y := 1)", "x += y := 1", "x ++", "x++", "++x", "x --", "--x", "x **= 2", "x //= 2", "x >>= 1", "x <<= 1", "x @= y", "x &&= y", "x ||= y", "x ??= y", "x ^= y", "x ~= y", "x != 1", "x %= y", "x >>>= 1", "x ***= 1", "x ///= 1", "f(x += 1)", "[x += 1]", "print(x += 1)", "if x += 1: pass", "lambda: x += 1", "x += 1; y -= 1", "x += 1,", "del x += 1", "for x += 1 in y: pass", "with x as y += 1: pass", "x.__debug__ += 1", "__debug__ += 1", "True += 1", "... += 1", "f'{x}' += 'a'", "{x} += 1", "{} += 1", "x < y += 1", "not x += 1", "await x += 1"):
    try: compile(src, "<s>", "exec"); print("ok:", src)
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src)
