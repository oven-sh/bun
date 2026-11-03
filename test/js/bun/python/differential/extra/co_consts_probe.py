def show(src, mode="exec"):
    c = compile(src, "f", mode)
    def r(k): return "<code %s>" % k.co_name if hasattr(k, "co_name") else repr(k)
    print(repr(src), "->", [r(k) for k in c.co_consts], c.co_names)
    for k in c.co_consts:
        if hasattr(k, "co_name"): print("    ", k.co_name, [r(x) for x in k.co_consts], k.co_names, k.co_varnames)
for s in ["pass", "x = 1", "x = 300", "x = 'a'", "x = None", "x = (1, 2)", "x = (1, 'a')", "x = -1", "x = -300", "x = 1.5; y = 1.5; z = -1.5", "x = 'a' 'b'", "x = 'a' + 'b'", "x = 300 + 1", "'doc'", "'doc'\nx = 1", "def f(): pass", "def f():\n 'doc'", "def f():\n 'doc'\n return 1", "def f(): return 300", "def f(a=1, b='x', *, c=300): pass",
          "def f():\n def g(): pass\n return g", "class C: pass", "class C:\n 'doc'\n x = 300", "lambda: 300", "f(a=1, b=2)", "f(x, a=1)", "import a", "import a.b as c", "from a import b, c", "from . import b", "x = [1, 2, 3]", "x = [1000, 2000, 3000]", "x = {1000, 2000, 3000}", "x in [1000, 2000]", "x in {1000, 2000}", "for i in [1000, 2000]: pass",
          "x = f'a{b}c'", "x = f'{b!r:>10}'", "x = b'ab'", "x = ...", "x = True; y = False", "x = 1j", "x = 1 + 2j", "x: int = 300", "def f(x: int) -> str: pass", "assert x, 'msg'", "x = [i for i in y]", "x = (i for i in y)", "def g():\n yield 300\n yield 'a'", "async def h():\n await x\n return 'r'", "try: pass\nexcept E as e: pass", "with a as b: pass", "x = a if b else 'c'", "x = a[1:2]", "x = a[1000:2000]", "x = a['k']", "print('a', 'a', 'b')", "x = 10**3", "x = 2**100", "del x", "global g1\ng1 = 'v'", "while True: break", "x = not 1", "x = 1 < 2", "match x:\n case 300: pass\n case 'a': pass\n case None: pass", "x = 'a' if 1 else 'b'", "if 0: x = 'dead'", "x = ('a', ('b', 300))", "x = 0; y = 255; z = 256; w = -1", "type X = int", "def f[T](): pass", "x = t'a{b}'", "lazy import a"]:
    try: show(s)
    except SyntaxError as e: print(repr(s), "SyntaxError", e)
show("1 + 2", "eval"); show("'a'", "eval"); show("None", "eval"); show("x", "eval"); show("300", "single"); show("x = 1", "single")
