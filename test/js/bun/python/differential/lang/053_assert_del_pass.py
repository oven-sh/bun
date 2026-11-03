def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e, e.args)

assert True
assert 1, "not shown"
assert "non-empty"
assert [0]
def a1(): assert False
def a2(): assert False, "message"
def a3(): assert 0, ("tuple", "message")
def a4(): assert None, 42
def a5(): assert [], None
def a6(): assert "", ValueError("an exception as message")
def a7(): assert 1 == 2, "%d != %d" % (1, 2)
def a8(): assert not True, f"{'f-string'}"
def a9(): assert False, undefined_in_message
def a10(): assert undefined_condition, "x"
def a11():
    def msg(): print("message evaluated", end="; "); return "m"
    assert True, msg()
    assert False, msg()
def a12(): assert (False, "a non-empty tuple is true")
def a13(): assert False, ""
def a14(): assert 1 < 0 or 2 < 1
def a15(): assert all([]) and not any([]), "fine"
for f in (a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a13, a14, a15): t(f)
print(__debug__)
try: assert False, "caught"
except AssertionError as e: print(type(e), e, e.args, isinstance(e, Exception))
AssertionErrorBackup = AssertionError
def shadowed():
    AssertionError = ValueError
    assert False, "the builtin is used regardless"
t(shadowed)
for src in ("assert", "assert ,", "assert x,", "assert x, y, z", "assert x y", "assert (x, 'm')", "assert x = 1", "assert x := 1", "assert (x := 1)", "assert x, (y := 1)", "assert *x", "assert x if y else z, m", "assert lambda: 1", "assert not x", "assert x;", "assert(x)", "assert x, 'a' 'b'", "assert yield", "__debug__ = 1", "del __debug__", "def f(__debug__): pass", "x.__debug__ = 1", "(__debug__ := 1)", "for __debug__ in x: pass", "import __debug__", "import a as __debug__", "with a as __debug__: pass", "class __debug__: pass", "def __debug__(): pass", "lambda __debug__: 1", "f(__debug__=1)", "x = __debug__", "global __debug__" , "[__debug__ for __debug__ in x]", "match x:\n case __debug__: pass", "None = 1", "True = 1", "False = 1", "... = 1", "del None", "del True", "None += 1", "x.None = 1", "def None(): pass", "class True: pass", "import None", "for None in x: pass", "(None := 1)", "f(None=1)", "lambda None: 1", "def f(None): pass", "Ellipsis = 1", "NotImplemented = 1"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg)
ns = {}
exec(compile("assert False, 'removed'\nr = __debug__\ndef f():\n    'doc'\n    assert 0\n    return 1\nif __debug__: s = 'debug'\nelse: s = 'optimized'", "<s>", "exec", optimize=1), ns); print(ns["r"], ns["f"](), ns["f"].__doc__, ns["s"])
exec(compile("assert False\ndef f():\n    'doc'\nclass C:\n    'cdoc'\nr = __debug__", "<s>", "exec", optimize=2), ns); print(ns["r"], ns["f"].__doc__, ns["C"].__doc__)
t(lambda: exec(compile("assert False, 'kept'", "<s>", "exec", optimize=0)))
# del
x = 1; del x; t(lambda: x)
a = b = c = 1; del a, b; t(lambda: a); t(lambda: b); print(c)
a = b = 1; del (a, b); t(lambda: a)
a = b = 1; del [a, b]; t(lambda: b)
a = b = c = 1; del a, (b, [c]); t(lambda: c)
a = 1; del (a); t(lambda: a)
a = 1; del ((a)); t(lambda: a)
del (); del []
l = [1, 2, 3, 4, 5]; del l[0], l[0]; print(l); del l[-1]; print(l); del l[:]; print(l)
l = [1, 2, 3]; i = 0; del l[i], l[i]; print(l)
d = {"a": 1, "b": 2, "c": 3}; del d["a"], d["b"]; print(d)
class O: pass
o = O(); o.a = 1; o.b = 2; del o.a, o.b; print(o.__dict__)
o.l = [1, 2]; o.d = {"k": [1, 2, 3]}; del o.l[0]; del o.d["k"][1:]; print(o.__dict__)
def d1(): del undefined_global
def d2():
    loc = 1; del loc; del loc
def d3():
    del never_assigned
    never_assigned = 1
def d4(): del o.nope
def d5(): del d["nope"]
def d6(): del l[5]
def d7(): del (1).real
def d8(): del "abc"[0]
def d9(): del (1, 2)[0]
def d10(): del len.__name__
def d11():
    v = 1
    def inner(): return v
    del v
    return inner()
def d12(p): del p; return p
def d13():
    for i in range(2): del i
    return i
def d14():
    v = 1
    if False: del v
    return v
def d15():
    v = 1
    for _ in range(2):
        print(v, end="; "); del v
for f in (d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, lambda: d12(1), d13, d14, d15): t(f)
def redef():
    v = 1; del v; v = 2; return v
print(redef())
def del_then_global():
    global gg
    gg = 1; del gg
    return "gg" in globals()
print(del_then_global())
order = []
class Tr:
    def __init__(s, n): s.n = n
    def __delitem__(s, k): order.append(("delitem", s.n, k))
    def __delattr__(s, k): order.append(("delattr", s.n, k))
def ev(n): order.append(("ev", n)); return Tr(n)
def k(n): order.append(("key", n)); return n
del ev(1)[k("a")], ev(2).attr, ev(3)[k("b"):k("c")]; print(order)
for src in ("del", "del 1", "del 'a'", "del f()", "del a + b", "del -a", "del a, 1", "del (a, 1)", "del [a, f()]", "del a.b()", "del a if b else c", "del lambda: 1", "del a and b", "del (a for a in b)", "del [a for a in b]", "del {a}", "del {a: b}", "del *a", "del a, *b", "del (*a,)", "del a,", "del (a,)", "del a.b, c[d], e", "del a = 1", "del a; del b", "del a[1:2, ::3]", "del a[...]", "del a()[0]", "del a().b", "del (yield)", "del await x", "del f'{a}'", "del a := 1", "del (a := 1)", "del not a", "del a < b", "del ...", "del a.b.c[d].e"):
    try: compile(src, "<s>", "exec"); print("ok:", src)
    except SyntaxError as e: print("SyntaxError:", e.msg)
# pass and the ellipsis as bodies; expression statements.
def p1(): pass
def p2(): ...
def p3(): "doc only"
def p4(): 1; "two"; None; ...; (1, 2); [3]
print(p1(), p2(), p3(), p4(), p3.__doc__, p4.__doc__)
1; "string statement"; None; ...; 1 + 1; [1, 2]; {}; (lambda: 0); x = 5; x; x.real; -x; x == 5
if True: pass
for _ in (): pass
while False: pass
class E: pass
with open(__file__) if False else __import__("sys").modules["__main__"].__class__ and type("CM", (), {"__enter__": lambda s: s, "__exit__": lambda s, *a: None})(): pass
try: pass
finally: pass
pass; pass; pass
print("end")
