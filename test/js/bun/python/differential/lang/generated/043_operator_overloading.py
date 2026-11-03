try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V:')
try: a, b = V(1), V(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = V(1), V(2)')
try: print('a + b =>', a + b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a + b')
try: print('a + 5 =>', a + 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a + 5')
try: print('5 + a =>', 5 + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 + a')
try: print('a - b =>', a - b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a - b')
try: print('5 - a =>', 5 - a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 - a')
try: print('a * b =>', a * b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a * b')
try: print('5 * a =>', 5 * a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 * a')
try: print('a @ b =>', a @ b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a @ b')
try: print('5 @ a =>', 5 @ a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 @ a')
try: print('a / b =>', a / b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a / b')
try: print('5 / a =>', 5 / a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 / a')
try: print('a // b =>', a // b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a // b')
try: print('5 // a =>', 5 // a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 // a')
try: print('a % b =>', a % b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a % b')
try: print('5 % a =>', 5 % a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 % a')
try: print('divmod(a, b) =>', divmod(a, b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: divmod(a, b)')
try: print('divmod(5, a) =>', divmod(5, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: divmod(5, a)')
try: print('a ** b =>', a ** b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a ** b')
try: print('5 ** a =>', 5 ** a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 ** a')
try: print('pow(a, b) =>', pow(a, b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pow(a, b)')
try: print('pow(a, b, 7) =>', pow(a, b, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pow(a, b, 7)')
try: print('pow(5, a) =>', pow(5, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pow(5, a)')
try: print('a << b =>', a << b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a << b')
try: print('5 << a =>', 5 << a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 << a')
try: print('a >> b =>', a >> b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a >> b')
try: print('5 >> a =>', 5 >> a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 >> a')
try: print('a & b =>', a & b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a & b')
try: print('5 & a =>', 5 & a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 & a')
try: print('a | b =>', a | b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a | b')
try: print('5 | a =>', 5 | a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 | a')
try: print('a ^ b =>', a ^ b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a ^ b')
try: print('5 ^ a =>', 5 ^ a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 ^ a')
try: print('-a =>', -a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -a')
try: print('+a =>', +a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: +a')
try: print('abs(a) =>', abs(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: abs(a)')
try: print('~a =>', ~a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ~a')
try: print('"s" % a =>', end=" "); t(lambda: "s" % a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: "s" % a)')
try: print('"s" + a =>', "s" + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "s" + a')
try: print('"s" * a =>', "s" * a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "s" * a')
try: print('[1] + a =>', [1] + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [1] + a')
try: print('[1] * a =>', [1] * a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [1] * a')
try: print('(1,) + a =>', (1,) + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (1,) + a')
try: print('1.5 + a =>', 1.5 + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1.5 + a')
try: print('1j * a =>', 1j * a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1j * a')
try: print('None + a =>', None + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: None + a')
try: print('{} | a =>', {} | a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {} | a')
try: print('{1} & a =>', {1} & a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {1} & a')
try: print('{1} - a =>', {1} - a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {1} - a')
try: print('b"x" + a =>', b"x" + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b"x" + a')
try: print('b"%s" % a if False else "" =>', b"%s" % a if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b"%s" % a if False else ""')
try: print('True + a =>', True + a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: True + a')
try: print('"%s" % a =>', "%s" % a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "%s" % a')
try: print('range(1) + a if False else "" =>', range(1) + a if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: range(1) + a if False else ""')
try: c = V(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = V(1)')
try: d = c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = c')
try: c += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c += 5')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: print('c is d =>', c is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c is d')
try: c = V(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = V(1)')
try: d = c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = c')
try: c -= 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c -= 5')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: print('c is d =>', c is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c is d')
try: c *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c *= 2')
try: c @= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c @= 2')
try: c /= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c /= 2')
try: c //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c //= 2')
try: c %= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c %= 2')
try: c **= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c **= 2')
try: c <<= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c <<= 2')
try: c >>= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c >>= 2')
try: c &= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c &= 2')
try: c |= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c |= 2')
try: c ^= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c ^= 2')
try: print(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('pow(5, a, 7) =>', end=" "); t(lambda: pow(5, a, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: pow(5, a, 7))')
try: print('pow(5, 6, a) =>', end=" "); t(lambda: pow(5, 6, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: pow(5, 6, a))')
try:
    class N: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N: pass')
try: n = N()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = N()')
try:
    for op in ("n + 1", "1 + n", "n + n", "n - 1", "n * 1", "n @ 1", "n / 1", "n // 1", "n % 1", "divmod(n, 1)", "n ** 1", "pow(n, 1, 2)", "n << 1", "n >> 1", "n & 1", "n | 1", "n ^ 1", "-n", "+n", "~n", "abs(n)", "1 @ 2", "'a' @ 'b'", "[] @ []", "n + None", "None + n", "n + 'a'", "'a' + n", "[1] + n", "n + [1]", "(1,) + n", "'a' * n", "n * 'a'", "[1] * n", "1.5 + n", "n < n", "n <= 1", "1 > n", "n >= 'a'", "None < n", "divmod(1, n)", "1 ** n", "pow(1, n)", "pow(1, 2, n)", "1 // n", "1 % n", "'%s' % n and 0", "1 << n", "1 | n", "{} | n", "set() | n", "set() - n", "1 & n", "1 ^ n", "b'a' + n", "b'a' * n", "1j + n", "True + n", "n + N", "N + n", "N + N", "N | n", "len + n", "n + len"):
        try: print('eval(op) [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', end=" "); t(lambda: eval(op))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: eval(op))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for op in ("n + 1", "1 + n", "n + n", "n - 1", "n * 1", "n @ 1", "n /...')
try:
    def aug(op):
        def f():
            x = N(); exec("x %s 1" % op, {"x": x})
        return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def aug(op):')
try:
    for op in ("+=", "-=", "*=", "@=", "/=", "//=", "%=", "**=", "<<=", ">>=", "&=", "|=", "^="): t(aug(op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for op in ("+=", "-=", "*=", "@=", "/=", "//=", "%=", "**=", "<<=", "...')
# NotImplemented makes the other operand's method be tried.
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L:')
try:
    def run(expr, **env):
        log.clear()
        try: r = eval(expr, env)
        except TypeError as e: r = "TypeError: " + str(e)
        print(expr, "->", r, log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(expr, **env):')
try: NI = NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NI = NotImplemented')
try: run("x + y", x=L("x", 1), y=L("y", 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x + y", x=L("x", 1), y=L("y", 2))')
try: run("x + y", x=L("x", NI), y=L("y", 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x + y", x=L("x", NI), y=L("y", 2))')
try: run("x + y", x=L("x", NI), y=L("y", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x + y", x=L("x", NI), y=L("y", NI))')
try: run("x + 1", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x + 1", x=L("x", NI))')
try: run("1 + x", x=L("x", 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("1 + x", x=L("x", 5))')
try: run("1 + x", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("1 + x", x=L("x", NI))')
try: run("x == y", x=L("x", NI), y=L("y", "yes"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x == y", x=L("x", NI), y=L("y", "yes"))')
try: run("x == y", x=L("x", NI), y=L("y", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x == y", x=L("x", NI), y=L("y", NI))')
try: run("x != y", x=L("x", NI), y=L("y", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x != y", x=L("x", NI), y=L("y", NI))')
try: run("x == x", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x == x", x=L("x", NI))')
try: run("x != x", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x != x", x=L("x", NI))')
try: run("x < y", x=L("x", NI), y=L("y", "gt result"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x < y", x=L("x", NI), y=L("y", "gt result"))')
try: run("x < y", x=L("x", NI), y=L("y", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x < y", x=L("x", NI), y=L("y", NI))')
try: run("x <= y", x=L("x", NI), y=L("y", "ge result"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x <= y", x=L("x", NI), y=L("y", "ge result"))')
try: run("x > y", x=L("x", NI), y=L("y", "lt result"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x > y", x=L("x", NI), y=L("y", "lt result"))')
try: run("x >= y", x=L("x", NI), y=L("y", "le result"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x >= y", x=L("x", NI), y=L("y", "le result"))')
try: run("x == 1", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x == 1", x=L("x", NI))')
try: run("1 == x", x=L("x", "r"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("1 == x", x=L("x", "r"))')
try: run("1 < x", x=L("x", "r"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("1 < x", x=L("x", "r"))')
try: run("x < 1", x=L("x", NI))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("x < 1", x=L("x", NI))')
try: run("None == x", x=L("x", "r"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("None == x", x=L("x", "r"))')
try: run("'a' != x", x=L("x", "r"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run("\'a\' != x", x=L("x", "r"))')
try:
    def iadd_case(r):
        log.clear(); x = L("x", r); y = L("y", "y.radd result")
        try: x += y
        except TypeError as e: x = "TypeError: " + str(e)
        print(x, log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iadd_case(r):')
try: iadd_case("iadd result")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iadd_case("iadd result")')
try: iadd_case(NI)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iadd_case(NI)')
# A subclass on the right goes first, if it overrides the reflected method.
try:
    class Base:
        def __add__(s, o): return "Base.add"
        def __radd__(s, o): return "Base.radd"
        def __lt__(s, o): return "Base.lt"
        def __gt__(s, o): return "Base.gt"
        def __eq__(s, o): return "Base.eq"
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')
try:
    class Sub(Base):
        def __radd__(s, o): return "Sub.radd"
        def __gt__(s, o): return "Sub.gt"
        def __eq__(s, o): return "Sub.eq"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sub(Base):')
try:
    class SubNo(Base): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubNo(Base): pass')
try: print('Base() + Sub() =>', Base() + Sub())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() + Sub()')
try: print('Sub() + Base() =>', Sub() + Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub() + Base()')
try: print('Base() + SubNo() =>', Base() + SubNo())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() + SubNo()')
try: print('Base() < Sub() =>', Base() < Sub())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() < Sub()')
try: print('Sub() < Base() =>', Sub() < Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub() < Base()')
try: print('Base() == Sub() =>', Base() == Sub())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() == Sub()')
try: print('Sub() == Base() =>', Sub() == Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub() == Base()')
try: print('Base() < SubNo() =>', Base() < SubNo())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() < SubNo()')
try: print('Base() == SubNo() =>', Base() == SubNo())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() == SubNo()')
try: print('Base() + Base() =>', Base() + Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base() + Base()')
try:
    class IntSub(int):
        def __radd__(s, o): return "IntSub.radd"
        def __rsub__(s, o): return "IntSub.rsub"
        def __rmul__(s, o): return "IntSub.rmul"
        def __eq__(s, o): return "IntSub.eq"
        def __gt__(s, o): return "IntSub.gt"
        __hash__ = int.__hash__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntSub(int):')
try: print('1 + IntSub(2) =>', 1 + IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 + IntSub(2)')
try: print('1 - IntSub(2) =>', 1 - IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 - IntSub(2)')
try: print('2 * IntSub(2) =>', 2 * IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 * IntSub(2)')
try: print('IntSub(2) + 1 =>', IntSub(2) + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: IntSub(2) + 1')
try: print('1 == IntSub(1) =>', 1 == IntSub(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 == IntSub(1)')
try: print('1 < IntSub(2) =>', 1 < IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 < IntSub(2)')
try: print('IntSub(1) == 1 =>', IntSub(1) == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: IntSub(1) == 1')
try: print('1.5 + IntSub(2) =>', 1.5 + IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1.5 + IntSub(2)')
try: print('1 / IntSub(2) =>', 1 / IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 / IntSub(2)')
try: print('[1] * IntSub(2) =>', [1] * IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [1] * IntSub(2)')
try: print('"a" * IntSub(2) =>', "a" * IntSub(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "a" * IntSub(2)')
try:
    class SameType:
        def __add__(s, o): return NotImplemented
        def __radd__(s, o): return "radd of the same type is not tried"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SameType:')
try: print('SameType() + SameType() =>', end=" "); t(lambda: SameType() + SameType())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: SameType() + SameType())')
# Unusual return values.
try:
    class Odd:
        def __eq__(s, o): return "not a bool"
        def __lt__(s, o): return [1, 2]
        def __contains__(s, v): return "truthy"
        def __neg__(s): return None
        def __bool__(s): return True
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: o = Odd()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Odd()')
try: print('o == 1 =>', o == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o == 1')
try: print('o != 1 =>', o != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o != 1')
try: print('o < 1 =>', o < 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o < 1')
try: print('1 in o =>', 1 in o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 in o')
try: print('1 not in o =>', 1 not in o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 not in o')
try: print('-o =>', -o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -o')
try: print('not o =>', not o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: not o')
try: print('o == o =>', o == o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o == o')
try: print('(o == 1) is not True =>', (o == 1) is not True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (o == 1) is not True')
try: print('[o] == [o] =>', [o] == [o])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [o] == [o]')
try: print('o in [o] =>', o in [o])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o in [o]')
try: print('[o].index(o) =>', [o].index(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [o].index(o)')
try: print('[o].count(1) =>', [o].count(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [o].count(1)')
try:
    class NeFromEq:
        def __init__(s, r): s.r = r
        def __eq__(s, o): return s.r
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NeFromEq:')
try: print('NeFromEq(True) != 1 =>', NeFromEq(True) != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq(True) != 1')
try: print('NeFromEq(False) != 1 =>', NeFromEq(False) != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq(False) != 1')
try: print('NeFromEq(NotImplemented) != 1 =>', NeFromEq(NotImplemented) != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq(NotImplemented) != 1')
try: print('NeFromEq("x") != 1 =>', NeFromEq("x") != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq("x") != 1')
try: print('NeFromEq("") != 1 =>', NeFromEq("") != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq("") != 1')
try: print('NeFromEq(0) != 1 =>', NeFromEq(0) != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NeFromEq(0) != 1')
try:
    class OnlyNe:
        def __ne__(s, o): return "ne"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyNe:')
try: print('OnlyNe() != 1 =>', OnlyNe() != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OnlyNe() != 1')
try: print('OnlyNe() == 1 =>', OnlyNe() == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OnlyNe() == 1')
try: print('OnlyNe() == OnlyNe() =>', OnlyNe() == OnlyNe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OnlyNe() == OnlyNe()')
# None as a method blocks the operation.
try:
    class Blocked:
        __add__ = None; __radd__ = None; __eq__ = None; __lt__ = None; __neg__ = None; __iter__ = None; __contains__ = None; __len__ = None; __hash__ = None; __call__ = None; __getitem__ = None; __bool__ = None; __int__ = None; __index__ = None; __iadd__ = None; __enter__ = None; __reversed__ = None; __format__ = None; __repr__ = None; __str__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Blocked:')
try: bl = Blocked()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bl = Blocked()')
try:
    for e in ("bl + 1", "1 + bl", "bl == 1", "1 == bl", "bl < 1", "-bl", "iter(bl)", "1 in bl", "len(bl)", "hash(bl)", "bl()", "bl[0]", "bool(bl)", "int(bl)", "[1][bl]", "reversed(bl)", "format(bl)", "repr(bl)", "str(bl)", "list(bl)", "bl != 1", "V(1) + bl"):
        try: print('eval(e) [' + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + '] =>', end=" "); t(lambda: eval(e))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: eval(e))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for e in ("bl + 1", "1 + bl", "bl == 1", "1 == bl", "bl < 1", "-bl", ...')
try:
    def blocked_iadd():
        x = Blocked(); x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def blocked_iadd():')
try: print('blocked_iadd() =>', end=" "); t(blocked_iadd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(blocked_iadd)')
# Operators use the type, not the instance.
try: inst = N()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst = N()')
try: inst.__add__ = lambda o: "instance attribute"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__add__ = lambda o: "instance attribute"')
try: inst.__len__ = lambda: 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__len__ = lambda: 5')
try: inst.__call__ = lambda: "called"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__call__ = lambda: "called"')
try: inst.__repr__ = lambda: "inst repr"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__repr__ = lambda: "inst repr"')
try: inst.__eq__ = lambda o: True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__eq__ = lambda o: True')
try: inst.__iter__ = lambda: iter([1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__iter__ = lambda: iter([1])')
try: inst.__bool__ = lambda: False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__bool__ = lambda: False')
try: inst.__getitem__ = lambda k: k
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__getitem__ = lambda k: k')
try: print('inst + 1 =>', end=" "); t(lambda: inst + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: inst + 1)')
try: print('len(inst) =>', end=" "); t(lambda: len(inst))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(inst))')
try: print('inst() =>', end=" "); t(lambda: inst())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: inst())')
try: print('repr(inst)[:12] =>', repr(inst)[:12])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(inst)[:12]')
try: print('inst == 1 =>', inst == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst == 1')
try: print('bool(inst) =>', bool(inst))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(inst)')
try: print('inst.__add__(1) =>', inst.__add__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__add__(1)')
try: print('inst.__len__() =>', inst.__len__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst.__len__()')
try: print('iter(inst) =>', end=" "); t(lambda: iter(inst))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(inst))')
try: print('inst[0] =>', end=" "); t(lambda: inst[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: inst[0])')
try: N.__add__ = lambda s, o: "added to the class later"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N.__add__ = lambda s, o: "added to the class later"')
try: print('n + 1 =>', n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n + 1')
try: print('inst + 1 =>', inst + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inst + 1')
try: del N.__add__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del N.__add__')
try: print('n + 1 =>', end=" "); t(lambda: n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n + 1)')
# Evaluation order and chaining.
try: print('V(1) + V(2) * V(3) =>', V(1) + V(2) * V(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) + V(2) * V(3)')
try: print('(V(1) + V(2)) * V(3) =>', (V(1) + V(2)) * V(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (V(1) + V(2)) * V(3)')
try: print('-V(1) ** 2 =>', -V(1) ** 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -V(1) ** 2')
try: print('(-V(1)) ** 2 =>', (-V(1)) ** 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (-V(1)) ** 2')
try: print('V(1) - V(2) - V(3) =>', V(1) - V(2) - V(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) - V(2) - V(3)')
try: print('V(2) ** V(3) ** V(4) =>', V(2) ** V(3) ** V(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(2) ** V(3) ** V(4)')
try: print('~V(1) + 1 =>', ~V(1) + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ~V(1) + 1')
try: print('V(1) | V(2) & V(3) ^ V(4) =>', V(1) | V(2) & V(3) ^ V(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) | V(2) & V(3) ^ V(4)')
try: print('V(1) << 1 + 1 =>', V(1) << 1 + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) << 1 + 1')
try: print('not V(1) =>', not V(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: not V(1)')
try: print('V(1) + 1 if V(0) else 0 =>', V(1) + 1 if V(0) else 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) + 1 if V(0) else 0')
try: print('V(1) < V(2) if False else "" =>', V(1) < V(2) if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: V(1) < V(2) if False else ""')
try:
    class Mat:
        def __init__(s, r): s.r = r
        def __matmul__(s, o): return Mat([[sum(a * b for a, b in zip(row, col)) for col in zip(*o.r)] for row in s.r])
        def __imatmul__(s, o): s.r = (s @ o).r; return s
        def __repr__(s): return "Mat(%r)" % s.r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mat:')
try: m = Mat([[1, 2], [3, 4]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = Mat([[1, 2], [3, 4]])')
try: print('m @ m =>', m @ m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m @ m')
try: print('m @ Mat([[1, 0], [0, 1]]) =>', m @ Mat([[1, 0], [0, 1]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m @ Mat([[1, 0], [0, 1]])')
try: m @= m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m @= m')
try: print(m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m')
