def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class V:
    def __init__(self, x): self.x = x
    def __repr__(self): return "V(%r)" % (self.x,)
    def __add__(self, o): return V(("add", self.x, getattr(o, "x", o)))
    def __radd__(self, o): return V(("radd", self.x, o))
    def __iadd__(self, o): self.x = ("iadd", self.x, getattr(o, "x", o)); return self
    def __sub__(self, o): return V(("sub", self.x, getattr(o, "x", o)))
    def __rsub__(self, o): return V(("rsub", self.x, o))
    def __mul__(self, o): return V(("mul", self.x, getattr(o, "x", o)))
    def __rmul__(self, o): return V(("rmul", self.x, o))
    def __matmul__(self, o): return V(("matmul", self.x, getattr(o, "x", o)))
    def __rmatmul__(self, o): return V(("rmatmul", self.x, o))
    def __truediv__(self, o): return V(("truediv", self.x, getattr(o, "x", o)))
    def __rtruediv__(self, o): return V(("rtruediv", self.x, o))
    def __floordiv__(self, o): return V(("floordiv", self.x, getattr(o, "x", o)))
    def __rfloordiv__(self, o): return V(("rfloordiv", self.x, o))
    def __mod__(self, o): return V(("mod", self.x, getattr(o, "x", o)))
    def __rmod__(self, o): return V(("rmod", self.x, o))
    def __divmod__(self, o): return V(("divmod", self.x, getattr(o, "x", o)))
    def __rdivmod__(self, o): return V(("rdivmod", self.x, o))
    def __pow__(self, o, m=None): return V(("pow", self.x, getattr(o, "x", o), m))
    def __rpow__(self, o, m=None): return V(("rpow", self.x, o, m))
    def __lshift__(self, o): return V(("lshift", self.x, getattr(o, "x", o)))
    def __rlshift__(self, o): return V(("rlshift", self.x, o))
    def __rshift__(self, o): return V(("rshift", self.x, getattr(o, "x", o)))
    def __rrshift__(self, o): return V(("rrshift", self.x, o))
    def __and__(self, o): return V(("and", self.x, getattr(o, "x", o)))
    def __rand__(self, o): return V(("rand", self.x, o))
    def __or__(self, o): return V(("or", self.x, getattr(o, "x", o)))
    def __ror__(self, o): return V(("ror", self.x, o))
    def __xor__(self, o): return V(("xor", self.x, getattr(o, "x", o)))
    def __rxor__(self, o): return V(("rxor", self.x, o))
    def __neg__(self): return V(("neg", self.x))
    def __pos__(self): return V(("pos", self.x))
    def __abs__(self): return V(("abs", self.x))
    def __invert__(self): return V(("invert", self.x))
a, b = V(1), V(2)
print(a + b, a + 5, 5 + a, a - b, 5 - a, a * b, 5 * a, a @ b, 5 @ a, a / b, 5 / a, a // b, 5 // a, a % b, 5 % a, divmod(a, b), divmod(5, a), a ** b, 5 ** a, pow(a, b), pow(a, b, 7), pow(5, a), a << b, 5 << a, a >> b, 5 >> a, a & b, 5 & a, a | b, 5 | a, a ^ b, 5 ^ a, -a, +a, abs(a), ~a)
t(lambda: "s" % a)
print("s" + a, "s" * a, [1] + a, [1] * a, (1,) + a, 1.5 + a, 1j * a, None + a, {} | a, {1} & a, {1} - a, b"x" + a, b"%s" % a if False else "", True + a, "%s" % a, range(1) + a if False else "")
c = V(1); d = c; c += 5; print(c, d, c is d)
c = V(1); d = c; c -= 5; print(c, d, c is d); c *= 2; c @= 2; c /= 2; c //= 2; c %= 2; c **= 2; c <<= 2; c >>= 2; c &= 2; c |= 2; c ^= 2; print(c)
t(lambda: pow(5, a, 7)); t(lambda: pow(5, 6, a))
class N: pass
n = N()
for op in ("n + 1", "1 + n", "n + n", "n - 1", "n * 1", "n @ 1", "n / 1", "n // 1", "n % 1", "divmod(n, 1)", "n ** 1", "pow(n, 1, 2)", "n << 1", "n >> 1", "n & 1", "n | 1", "n ^ 1", "-n", "+n", "~n", "abs(n)", "1 @ 2", "'a' @ 'b'", "[] @ []", "n + None", "None + n", "n + 'a'", "'a' + n", "[1] + n", "n + [1]", "(1,) + n", "'a' * n", "n * 'a'", "[1] * n", "1.5 + n", "n < n", "n <= 1", "1 > n", "n >= 'a'", "None < n", "divmod(1, n)", "1 ** n", "pow(1, n)", "pow(1, 2, n)", "1 // n", "1 % n", "'%s' % n and 0", "1 << n", "1 | n", "{} | n", "set() | n", "set() - n", "1 & n", "1 ^ n", "b'a' + n", "b'a' * n", "1j + n", "True + n", "n + N", "N + n", "N + N", "N | n", "len + n", "n + len"):
    t(lambda: eval(op))
def aug(op):
    def f():
        x = N(); exec("x %s 1" % op, {"x": x})
    return f
for op in ("+=", "-=", "*=", "@=", "/=", "//=", "%=", "**=", "<<=", ">>=", "&=", "|=", "^="): t(aug(op))
# NotImplemented makes the other operand's method be tried.
log = []
class L:
    def __init__(s, n, r): s.n = n; s.r = r
    def __add__(s, o): log.append(s.n + ".add"); return s.r
    def __radd__(s, o): log.append(s.n + ".radd"); return s.r
    def __iadd__(s, o): log.append(s.n + ".iadd"); return s.r
    def __eq__(s, o): log.append(s.n + ".eq"); return s.r
    def __ne__(s, o): log.append(s.n + ".ne"); return s.r
    def __lt__(s, o): log.append(s.n + ".lt"); return s.r
    def __gt__(s, o): log.append(s.n + ".gt"); return s.r
    def __le__(s, o): log.append(s.n + ".le"); return s.r
    def __ge__(s, o): log.append(s.n + ".ge"); return s.r
    __hash__ = None
def run(expr, **env):
    log.clear()
    try: r = eval(expr, env)
    except TypeError as e: r = "TypeError: " + str(e)
    print(expr, "->", r, log)
NI = NotImplemented
run("x + y", x=L("x", 1), y=L("y", 2)); run("x + y", x=L("x", NI), y=L("y", 2)); run("x + y", x=L("x", NI), y=L("y", NI)); run("x + 1", x=L("x", NI)); run("1 + x", x=L("x", 5)); run("1 + x", x=L("x", NI))
run("x == y", x=L("x", NI), y=L("y", "yes")); run("x == y", x=L("x", NI), y=L("y", NI)); run("x != y", x=L("x", NI), y=L("y", NI)); run("x == x", x=L("x", NI)); run("x != x", x=L("x", NI)); run("x < y", x=L("x", NI), y=L("y", "gt result")); run("x < y", x=L("x", NI), y=L("y", NI)); run("x <= y", x=L("x", NI), y=L("y", "ge result")); run("x > y", x=L("x", NI), y=L("y", "lt result")); run("x >= y", x=L("x", NI), y=L("y", "le result")); run("x == 1", x=L("x", NI)); run("1 == x", x=L("x", "r")); run("1 < x", x=L("x", "r")); run("x < 1", x=L("x", NI)); run("None == x", x=L("x", "r")); run("'a' != x", x=L("x", "r"))
def iadd_case(r):
    log.clear(); x = L("x", r); y = L("y", "y.radd result")
    try: x += y
    except TypeError as e: x = "TypeError: " + str(e)
    print(x, log)
iadd_case("iadd result"); iadd_case(NI)
# A subclass on the right goes first, if it overrides the reflected method.
class Base:
    def __add__(s, o): return "Base.add"
    def __radd__(s, o): return "Base.radd"
    def __lt__(s, o): return "Base.lt"
    def __gt__(s, o): return "Base.gt"
    def __eq__(s, o): return "Base.eq"
    __hash__ = None
class Sub(Base):
    def __radd__(s, o): return "Sub.radd"
    def __gt__(s, o): return "Sub.gt"
    def __eq__(s, o): return "Sub.eq"
class SubNo(Base): pass
print(Base() + Sub(), Sub() + Base(), Base() + SubNo(), Base() < Sub(), Sub() < Base(), Base() == Sub(), Sub() == Base(), Base() < SubNo(), Base() == SubNo(), Base() + Base())
class IntSub(int):
    def __radd__(s, o): return "IntSub.radd"
    def __rsub__(s, o): return "IntSub.rsub"
    def __rmul__(s, o): return "IntSub.rmul"
    def __eq__(s, o): return "IntSub.eq"
    def __gt__(s, o): return "IntSub.gt"
    __hash__ = int.__hash__
print(1 + IntSub(2), 1 - IntSub(2), 2 * IntSub(2), IntSub(2) + 1, 1 == IntSub(1), 1 < IntSub(2), IntSub(1) == 1, 1.5 + IntSub(2), 1 / IntSub(2), [1] * IntSub(2), "a" * IntSub(2))
class SameType:
    def __add__(s, o): return NotImplemented
    def __radd__(s, o): return "radd of the same type is not tried"
t(lambda: SameType() + SameType())
# Unusual return values.
class Odd:
    def __eq__(s, o): return "not a bool"
    def __lt__(s, o): return [1, 2]
    def __contains__(s, v): return "truthy"
    def __neg__(s): return None
    def __bool__(s): return True
    __hash__ = None
o = Odd(); print(o == 1, o != 1, o < 1, 1 in o, 1 not in o, -o, not o, o == o, (o == 1) is not True, [o] == [o], o in [o], [o].index(o), [o].count(1))
class NeFromEq:
    def __init__(s, r): s.r = r
    def __eq__(s, o): return s.r
    __hash__ = None
print(NeFromEq(True) != 1, NeFromEq(False) != 1, NeFromEq(NotImplemented) != 1, NeFromEq("x") != 1, NeFromEq("") != 1, NeFromEq(0) != 1)
class OnlyNe:
    def __ne__(s, o): return "ne"
print(OnlyNe() != 1, OnlyNe() == 1, OnlyNe() == OnlyNe())
# None as a method blocks the operation.
class Blocked:
    __add__ = None; __radd__ = None; __eq__ = None; __lt__ = None; __neg__ = None; __iter__ = None; __contains__ = None; __len__ = None; __hash__ = None; __call__ = None; __getitem__ = None; __bool__ = None; __int__ = None; __index__ = None; __iadd__ = None; __enter__ = None; __reversed__ = None; __format__ = None; __repr__ = None; __str__ = None
bl = Blocked()
for e in ("bl + 1", "1 + bl", "bl == 1", "1 == bl", "bl < 1", "-bl", "iter(bl)", "1 in bl", "len(bl)", "hash(bl)", "bl()", "bl[0]", "bool(bl)", "int(bl)", "[1][bl]", "reversed(bl)", "format(bl)", "repr(bl)", "str(bl)", "list(bl)", "bl != 1", "V(1) + bl"):
    t(lambda: eval(e))
def blocked_iadd():
    x = Blocked(); x += 1
t(blocked_iadd)
# Operators use the type, not the instance.
inst = N(); inst.__add__ = lambda o: "instance attribute"; inst.__len__ = lambda: 5; inst.__call__ = lambda: "called"; inst.__repr__ = lambda: "inst repr"; inst.__eq__ = lambda o: True; inst.__iter__ = lambda: iter([1]); inst.__bool__ = lambda: False; inst.__getitem__ = lambda k: k
t(lambda: inst + 1); t(lambda: len(inst)); t(lambda: inst()); print(repr(inst)[:12], inst == 1, bool(inst), inst.__add__(1), inst.__len__()); t(lambda: iter(inst)); t(lambda: inst[0])
N.__add__ = lambda s, o: "added to the class later"; print(n + 1, inst + 1); del N.__add__; t(lambda: n + 1)
# Evaluation order and chaining.
print(V(1) + V(2) * V(3), (V(1) + V(2)) * V(3), -V(1) ** 2, (-V(1)) ** 2, V(1) - V(2) - V(3), V(2) ** V(3) ** V(4), ~V(1) + 1, V(1) | V(2) & V(3) ^ V(4), V(1) << 1 + 1, not V(1), V(1) + 1 if V(0) else 0, V(1) < V(2) if False else "")
class Mat:
    def __init__(s, r): s.r = r
    def __matmul__(s, o): return Mat([[sum(a * b for a, b in zip(row, col)) for col in zip(*o.r)] for row in s.r])
    def __imatmul__(s, o): s.r = (s @ o).r; return s
    def __repr__(s): return "Mat(%r)" % s.r
m = Mat([[1, 2], [3, 4]]); print(m @ m, m @ Mat([[1, 0], [0, 1]])); m @= m; print(m)
