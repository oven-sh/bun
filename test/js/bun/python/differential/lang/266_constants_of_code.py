# co_consts and co_names as CPython's compiler leaves them: constants of the same type and value are one (and one object), what is worked out from
# constants takes their place, what is dropped is no constant, the first stays whatever becomes of it.
def show(src, run=False):
    code = compile(src, "x", "exec")
    def walk(c, d=0):
        print("  " * d, c.co_name, [k if not hasattr(k, "co_code") else "<code>" for k in c.co_consts], c.co_names)
        for k in c.co_consts:
            if hasattr(k, "co_code"):
                walk(k, d + 1)
    print(repr(src)); walk(code)
    if run:
        ns = {}
        exec(code, ns)
        print("   r =", ns["r"])


for a, b in [("(1, 2)", "(1, 2)"), ("(1, 2)", "(1.0, 2)"), ("(1, 2)", "(True, 2)"), ("b'ab'", "b'ab'"), ("'ab'", "b'ab'"), ("1j", "1j"), ("0j", "-0j"), ("1.5", "1.5"), ("1.0", "1.0"), ("1.0", "1"),
             ("0.0", "-0.0"), ("10**30", "10**30"), ("1000", "1000"), ("2**70", "1180591620717411303424"), ("(1, (2, 3))", "(1, (2, 3))"), ("((), ())", "((), ())"), ("()", "()"),
             ("(0.0,)", "(-0.0,)"), ("('a', b'a')", "('a', b'a')"), ("(None, ...)", "(None, ...)"), ("'a' 'b'", "'ab'"), ("'a' + 'b'", "'ab'"), ("(1,) + (2,)", "(1, 2)"), ("1e400", "1e400"), ("(1e400 - 1e400,)", "(1e400 - 1e400,)"),
             ("-1", "-1"), ("-1000", "-1000"), ("-1.5", "-1.5"), ("1 + 2j", "1 + 2j"), ("b'a' * 3", "b'aaa'"), ("(1, 2)[:1]", "(1,)")]:
    show("a = %s\nb = %s\nr = a is b" % (a, b), True)
    show("def f():\n a = %s\n b = %s\n return a is b\nr = f()" % (a, b), True)
show("def f(x):\n return x in {1, 2, 3}, x in {3, 2, 1}, x in {1, 2, 3}\n")
show("def f(x):\n return x in {1, 2, 3}, x in {1.0, 2, 3}\n")
show("def f(x):\n return x in [1, 2, 3], x in (1, 2, 3)\n")
show("x = {1000, 2000, 3000, 4000}\ny = {1000, 2000, 3000, 4000}")
show("def f():\n for x in (1, 2): pass\n for y in [1, 2]: pass\n")
show("def f(**k): pass\nf(a=1, b=2)\nf(a=3, b=4)\n")
show("t = ('a', 'b')\nu = ('a', 'b')")
for p in ["(1, 2)", "[a, b]", "[a, *b]", "[a, *_]", "[a, *_, b]", "[*_, a, b]", "[*_]", "[*a]", "[]", "[_, _]", "[1000, *_, 2000]", "{}", "{'k': v}", "{'k': 1, 'j': 2}", "{'k': v, **r}", "{**r}", "{K.a: 1}", "{1000: a, 2000: b}",
          "C()", "C(a)", "C(a, b)", "C(x=a)", "C(a, x=b, y=c)", "C(x=1000)", "None", "True", "False", "1000", "'s'", "-1000", "1 + 2j", "K.a", "a", "_", "1000 | 2000", "(1000 | 2000) as z", "[a, [b, c]]", "[1000, [2000, *_, 3000]]", "b'x'", "1.5", "-1.5", "{-1: a}", "{1 + 2j: a}", "{None: a, True: b}"]:
    show("match x:\n case %s: pass\n" % p)
    show("def f(x):\n match x:\n  case %s: return 5000\n" % p)
    show("def f(x):\n match x:\n  case %s if g(): return 5000\n  case _: return 6000\n" % p)
for s in ["()", "(1, 2)", "(1000, 2000)", "1 + 2", "1000 + 2000", "__debug__", "not 1000", "-1000", "'a' 'b'", "'a' + 'b'", "[]", "[1000]", "{1000}", "1000 if t() else 2000", "1000 and 2000", "1000 or 2000", "t() is None", "t() is not None",
          "None is None", "x = t() is None", "x = t() is not None", "x = None is t()", "return t() is None", "x = 1000 and t()", "x = 0 and t()", "x = 1000 or t()", "x = 0 or t()", "x = t() and 1000", "x = t() and 1000 and u()",
          "x = t() or 1000 and u()", "x = 1000 and 2000 and t()", "x = (1000 and 2000) or t()", "x = __debug__ and t()", "x = t() and __debug__ and u()", "x = not 1000 and t()", "x = () and t()", "x = (1000,) and t()",
          "x = 1000 if 2000 else 3000", "x = 1000 if t() else 3000", "x = t() if 1000 else 3000", "f(1000 and t())", "x = [1000 and t()]", "assert 1000 and t()", "assert t(), 1000", "assert 1000, 2000", "assert 0, 2000",
          "while 1000: t()", "while 1000 and t(): u()", "x = 1000 < 2000", "x = 1000 < 2000 < t()", "x = 1000 in (2000, 3000)", "x = t() in ()", "x = t() in []", "x = t() in {1000}", "x = t() in {1000, 2000}", "for q in (): pass", "for q in []: pass",
          "del x", "pass", "...", "1000", "'doc'", "x = ...", "x = f'{1000}'", "x = f'a{t()}b'", "x = f'a' 'b'", "x = f'{1000!r:>{2000}}'", "x = 1000,", "x, y = 1000, 2000", "x, y = y, x", "x = y = 1000", "x += 1000",
          "x = t()[1000]", "x = t()[1000:2000]", "x = t()[1000:2000:3000]", "x = t()[:]", "x = t()[None:None]", "x = t()[-1]", "t()[1000:2000] = y", "del t()[1000:2000]", "x = 'abc'[1]", "x = (1000, 2000)[0]", "x = 2 ** 10", "x = 2 ** 1000", "x = 1 << 100",
          "x = 'a' * 10", "x = 'a' * 10000", "x = (1000,) * 3", "x = 1000 // 0", "x = 10 % 3", "x = 'a%s' % 1000", "x = '%d %d' % (1000, 2000)", "x = ~1000", "x = +1000", "x = - - 1000", "x = not not t()", "x = not t() is None", "x = not t() in y",
          "raise E(1000)", "raise E from None", "return", "return None", "return 1000", "return (1000, 2000)", "return 1000, t()", "import m", "import m.n as o", "from m import a", "from m import a as b, c", "from . import a", "from .. import a", "from m import *" ,
          "global zz\n zz = 1000", "with t(): pass", "with t() as x: return 1000", "try: t()\n except E: u()", "try: t()\n except E as e: u()", "try: t()\n finally: u(1000)", "try: return 1000\n finally: u(2000)", "try: t()\n except* E: u()",
          "lambda: 1000", "lambda a=1000: a", "lambda *, a=1000: a", "def h(a=1000, *, b=2000) -> 3000: pass", "def h(a: 1000): pass", "class C: pass", "class C(B, m=1000): x = 2000", "class C:\n  'doc'\n  x = 1000", "class C:\n  def m(self): self.a = 1000",
          "[q for q in y]", "[q for q in y if 1000]", "{q: 1000 for q in y}", "(q for q in y)", "x = [*y, 1000]", "x = {**y, 'k': 1000}", "x = {'k': 1000, 'j': 2000}", "f(*y, 1000)", "f(k=1000)", "f(k=1000, j=2000)", "f(**y, k=1000)", "f(1000, *y, k=2000, **z)", "o.m(k=1000)",
          "type T = 1000", "def h[T](): pass", "class C[T]: pass", "x = yield_ = 1000", "await_ = 1000"]:
    if s == "from m import *":
        show(s)
        continue
    show("def g():\n %s\n" % s)
    if not s.startswith("return") and "return" not in s:
        show(s.replace("\n ", "\n"))
