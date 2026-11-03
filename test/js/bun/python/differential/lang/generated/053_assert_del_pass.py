try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e, e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try: assert True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert True')
try: assert 1, "not shown"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert 1, "not shown"')
try: assert "non-empty"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert "non-empty"')
try: assert [0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert [0]')
try:
    def a1(): assert False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a1(): assert False')
try:
    def a2(): assert False, "message"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a2(): assert False, "message"')
try:
    def a3(): assert 0, ("tuple", "message")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a3(): assert 0, ("tuple", "message")')
try:
    def a4(): assert None, 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a4(): assert None, 42')
try:
    def a5(): assert [], None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a5(): assert [], None')
try:
    def a6(): assert "", ValueError("an exception as message")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a6(): assert "", ValueError("an exception as message")')
try:
    def a7(): assert 1 == 2, "%d != %d" % (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a7(): assert 1 == 2, "%d != %d" % (1, 2)')
try:
    def a8(): assert not True, f"{'f-string'}"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a8(): assert not True, f"{\'f-string\'}"')
try:
    def a9(): assert False, undefined_in_message
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a9(): assert False, undefined_in_message')
try:
    def a10(): assert undefined_condition, "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a10(): assert undefined_condition, "x"')
try:
    def a11():
        def msg(): print("message evaluated", end="; "); return "m"
        assert True, msg()
        assert False, msg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a11():')
try:
    def a12(): assert (False, "a non-empty tuple is true")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a12(): assert (False, "a non-empty tuple is true")')
try:
    def a13(): assert False, ""
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a13(): assert False, ""')
try:
    def a14(): assert 1 < 0 or 2 < 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a14(): assert 1 < 0 or 2 < 1')
try:
    def a15(): assert all([]) and not any([]), "fine"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a15(): assert all([]) and not any([]), "fine"')
try:
    for f in (a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a13, a14, a15): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a13, a14, a15...')
try: print(__debug__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __debug__')
try:
    try: assert False, "caught"
    except AssertionError as e: print(type(e), e, e.args, isinstance(e, Exception))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: assert False, "caught"')
try: AssertionErrorBackup = AssertionError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AssertionErrorBackup = AssertionError')
try:
    def shadowed():
        AssertionError = ValueError
        assert False, "the builtin is used regardless"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shadowed():')
try: print('shadowed() =>', end=" "); t(shadowed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(shadowed)')
try:
    for src in ("assert", "assert ,", "assert x,", "assert x, y, z", "assert x y", "assert (x, 'm')", "assert x = 1", "assert x := 1", "assert (x := 1)", "assert x, (y := 1)", "assert *x", "assert x if y else z, m", "assert lambda: 1", "assert not x", "assert x;", "assert(x)", "assert x, 'a' 'b'", "assert yield", "__debug__ = 1", "del __debug__", "def f(__debug__): pass", "x.__debug__ = 1", "(__debug__ := 1)", "for __debug__ in x: pass", "import __debug__", "import a as __debug__", "with a as __debug__: pass", "class __debug__: pass", "def __debug__(): pass", "lambda __debug__: 1", "f(__debug__=1)", "x = __debug__", "global __debug__" , "[__debug__ for __debug__ in x]", "match x:\n case __debug__: pass", "None = 1", "True = 1", "False = 1", "... = 1", "del None", "del True", "None += 1", "x.None = 1", "def None(): pass", "class True: pass", "import None", "for None in x: pass", "(None := 1)", "f(None=1)", "lambda None: 1", "def f(None): pass", "Ellipsis = 1", "NotImplemented = 1"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("assert", "assert ,", "assert x,", "assert x, y, z", "ass...')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec(compile("assert False, 'removed'\nr = __debug__\ndef f():\n    'doc'\n    assert 0\n    return 1\nif __debug__: s = 'debug'\nelse: s = 'optimized'", "<s>", "exec", optimize=1), ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(compile("assert False, \'removed\'\\nr = __debug__\\ndef f():\\n \'doc...')
try: print('ns["r"] =>', ns["r"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["r"]')
try: print('ns["f"]() =>', ns["f"]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["f"]()')
try: print('ns["f"].__doc__ =>', ns["f"].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["f"].__doc__')
try: print('ns["s"] =>', ns["s"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["s"]')
try: exec(compile("assert False\ndef f():\n    'doc'\nclass C:\n    'cdoc'\nr = __debug__", "<s>", "exec", optimize=2), ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(compile("assert False\\ndef f():\\n \'doc\'\\nclass C:\\n \'cdoc\'\\nr = ...')
try: print('ns["r"] =>', ns["r"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["r"]')
try: print('ns["f"].__doc__ =>', ns["f"].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["f"].__doc__')
try: print('ns["C"].__doc__ =>', ns["C"].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["C"].__doc__')
try: print('exec(compile("assert False, \'kept\'", "<s>", "exec", optimize=0)) =>', end=" "); t(lambda: exec(compile("assert False, 'kept'", "<s>", "exec", optimize=0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec(compile("assert False, \'kept\'", "<s>", "exec", optimiz...')
# del
try: x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 1')
try: del x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del x')
try: print('x =>', end=" "); t(lambda: x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: x)')
try: a = b = c = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = b = c = 1')
try: del a, b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a, b')
try: print('a =>', end=" "); t(lambda: a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a)')
try: print('b =>', end=" "); t(lambda: b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: b)')
try: print(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: a = b = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = b = 1')
try: del (a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del (a, b)')
try: print('a =>', end=" "); t(lambda: a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a)')
try: a = b = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = b = 1')
try: del [a, b]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del [a, b]')
try: print('b =>', end=" "); t(lambda: b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: b)')
try: a = b = c = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = b = c = 1')
try: del a, (b, [c])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a, (b, [c])')
try: print('c =>', end=" "); t(lambda: c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c)')
try: a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = 1')
try: del (a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del (a)')
try: print('a =>', end=" "); t(lambda: a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a)')
try: a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = 1')
try: del ((a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ((a))')
try: print('a =>', end=" "); t(lambda: a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a)')
try: del ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ()')
try: del []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del []')
try: l = [1, 2, 3, 4, 5]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1, 2, 3, 4, 5]')
try: del l[0], l[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del l[0], l[0]')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: del l[-1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del l[-1]')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: del l[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del l[:]')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: l = [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1, 2, 3]')
try: i = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = 0')
try: del l[i], l[i]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del l[i], l[i]')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: d = {"a": 1, "b": 2, "c": 3}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {"a": 1, "b": 2, "c": 3}')
try: del d["a"], d["b"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d["a"], d["b"]')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try:
    class O: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O: pass')
try: o = O()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = O()')
try: o.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a = 1')
try: o.b = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.b = 2')
try: del o.a, o.b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.a, o.b')
try: print(o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try: o.l = [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.l = [1, 2]')
try: o.d = {"k": [1, 2, 3]}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.d = {"k": [1, 2, 3]}')
try: del o.l[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.l[0]')
try: del o.d["k"][1:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.d["k"][1:]')
try: print(o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try:
    def d1(): del undefined_global
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d1(): del undefined_global')
try:
    def d2():
        loc = 1; del loc; del loc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d2():')
try:
    def d3():
        del never_assigned
        never_assigned = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d3():')
try:
    def d4(): del o.nope
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d4(): del o.nope')
try:
    def d5(): del d["nope"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d5(): del d["nope"]')
try:
    def d6(): del l[5]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d6(): del l[5]')
try:
    def d7(): del (1).real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d7(): del (1).real')
try:
    def d8(): del "abc"[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d8(): del "abc"[0]')
try:
    def d9(): del (1, 2)[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d9(): del (1, 2)[0]')
try:
    def d10(): del len.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d10(): del len.__name__')
try:
    def d11():
        v = 1
        def inner(): return v
        del v
        return inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d11():')
try:
    def d12(p): del p; return p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d12(p): del p; return p')
try:
    def d13():
        for i in range(2): del i
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d13():')
try:
    def d14():
        v = 1
        if False: del v
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d14():')
try:
    def d15():
        v = 1
        for _ in range(2):
            print(v, end="; "); del v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d15():')
try:
    for f in (d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, lambda: d12(1), d13, d14, d15): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, lambda: d12(1...')
try:
    def redef():
        v = 1; del v; v = 2; return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def redef():')
try: print(redef())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: redef()')
try:
    def del_then_global():
        global gg
        gg = 1; del gg
        return "gg" in globals()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_then_global():')
try: print(del_then_global())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del_then_global()')
try: order = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: order = []')
try:
    class Tr:
        def __init__(s, n): s.n = n
        def __delitem__(s, k): order.append(("delitem", s.n, k))
        def __delattr__(s, k): order.append(("delattr", s.n, k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Tr:')
try:
    def ev(n): order.append(("ev", n)); return Tr(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ev(n): order.append(("ev", n)); return Tr(n)')
try:
    def k(n): order.append(("key", n)); return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def k(n): order.append(("key", n)); return n')
try: del ev(1)[k("a")], ev(2).attr, ev(3)[k("b"):k("c")]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ev(1)[k("a")], ev(2).attr, ev(3)[k("b"):k("c")]')
try: print(order)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: order')
try:
    for src in ("del", "del 1", "del 'a'", "del f()", "del a + b", "del -a", "del a, 1", "del (a, 1)", "del [a, f()]", "del a.b()", "del a if b else c", "del lambda: 1", "del a and b", "del (a for a in b)", "del [a for a in b]", "del {a}", "del {a: b}", "del *a", "del a, *b", "del (*a,)", "del a,", "del (a,)", "del a.b, c[d], e", "del a = 1", "del a; del b", "del a[1:2, ::3]", "del a[...]", "del a()[0]", "del a().b", "del (yield)", "del await x", "del f'{a}'", "del a := 1", "del (a := 1)", "del not a", "del a < b", "del ...", "del a.b.c[d].e"):
        try: compile(src, "<s>", "exec"); print("ok:", src)
        except SyntaxError as e: print("SyntaxError:", e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("del", "del 1", "del \'a\'", "del f()", "del a + b", "del -...')
# pass and the ellipsis as bodies; expression statements.
try:
    def p1(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p1(): pass')
try:
    def p2(): ...
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p2(): ...')
try:
    def p3(): "doc only"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p3(): "doc only"')
try:
    def p4(): 1; "two"; None; ...; (1, 2); [3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p4(): 1; "two"; None; ...; (1, 2); [3]')
try: print('p1() =>', p1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p1()')
try: print('p2() =>', p2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p2()')
try: print('p3() =>', p3())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p3()')
try: print('p4() =>', p4())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p4()')
try: print('p3.__doc__ =>', p3.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p3.__doc__')
try: print('p4.__doc__ =>', p4.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p4.__doc__')
1
"string statement"
None
...
try: 1 + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 + 1')
try: [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [1, 2]')
try: {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {}')
try: (lambda: 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0)')
try: x = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 5')
try: x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x.real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.real')
try: -x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -x')
try: x == 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x == 5')
try:
    if True: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if True: pass')
try:
    for _ in (): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in (): pass')
try:
    while False: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while False: pass')
try:
    class E: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E: pass')
try:
    with open(__file__) if False else __import__("sys").modules["__main__"].__class__ and type("CM", (), {"__enter__": lambda s: s, "__exit__": lambda s, *a: None})(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with open(__file__) if False else __import__("sys").modules["__main__...')
try:
    try: pass
    finally: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: pass')
pass
pass
pass
try: print("end")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "end"')
