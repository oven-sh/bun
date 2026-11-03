import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def here(): return sys._getframe()
f = here()
print(type(f).__name__, f.f_code is here.__code__, f.f_code.co_name, f.f_globals is globals(), f.f_builtins is sys.modules["builtins"].__dict__, f.f_back.f_code.co_name, f.f_lineno == here.__code__.co_firstlineno, f.f_locals, type(f.f_lasti).__name__, f.f_trace, f.f_trace_lines, f.f_trace_opcodes, f.f_generator, repr(f)[:12], "file" in repr(f), "line" in repr(f), "code here" in repr(f))
m = sys._getframe(); print(m.f_code.co_name, m.f_back, m.f_locals is globals(), m.f_globals is globals(), m.f_code.co_filename.rsplit("/", 1)[-1], m.f_code.co_firstlineno)
def names(depth=0):
    fr = sys._getframe(depth); out = []
    while fr: out.append(fr.f_code.co_name); fr = fr.f_back
    return out
def a(): return b()
def b(): return c()
def c(): return names()
print(a(), names(), names(1))
def caller(): return sys._getframe(1).f_code.co_name, sys._getframe(1).f_globals["__name__"], sys._getframe(2).f_code.co_name
def calls_caller(): return caller()
print(calls_caller())
t(lambda: sys._getframe(100)); t(lambda: sys._getframe(-1).f_code.co_name); t(lambda: sys._getframe("a")); t(lambda: sys._getframe(1, 2)); t(lambda: sys._getframe(2 ** 70))
print((lambda: sys._getframe().f_code.co_name)(), [sys._getframe().f_code.co_name for _ in range(1)], list(sys._getframe().f_code.co_name for _ in range(1)), type("K", (), {"n": sys._getframe().f_code.co_name}).n)
class Body:
    fr = sys._getframe()
    name = fr.f_code.co_name; back = fr.f_back.f_code.co_name; loc = "name" in fr.f_locals or sorted(k for k in fr.f_locals if not k.startswith("__"))
    del fr
print(Body.name, Body.back, Body.loc)
def through_builtins(): return list(map(lambda _: names(), [0]))[0], sorted([0], key=lambda _: out.extend(names()) or 0)
out = []; print(through_builtins()[0], out)
class M:
    def meth(s): return names()
    def __len__(s): out.extend(names()); return 0
    @property
    def p(s): return names()
    def __call__(s): return names()
    def __getattr__(s, n): return names()
    def __enter__(s): return names()
    def __exit__(s, *a): pass
    def __iter__(s): out.extend(names()); return iter(())
    def __init__(s): s.made = names()
    def __eq__(s, o): out.extend(names()); return True
    __hash__ = None
mm = M(); out = []; len(mm); print(mm.meth(), out, mm.p, mm(), mm.missing, mm.made)
with mm as w: print(w)
out = []; list(mm); print(out); out = []; mm == 1; print(out)
def gen(): yield names()
def drive(): return next(gen())
print(drive(), list(gen()))
def gen_back():
    yield sys._getframe().f_back.f_code.co_name
    yield sys._getframe().f_back.f_code.co_name
g = gen_back()
def first(): return next(g)
def second(): return next(g)
print(first(), second(), g.gi_frame.f_back)
async def co(): return names()
def drive_co():
    try: co().send(None)
    except StopIteration as e: return e.value
print(drive_co())
print(eval("names()"), eval("sys._getframe().f_code.co_name"), eval("sys._getframe().f_code.co_filename")); exec("print(names(), sys._getframe().f_code.co_name, sys._getframe().f_lineno)"); exec("\n\nprint(sys._getframe().f_lineno)")
# f_lineno follows execution.
def lines():
    base = sys._getframe().f_lineno
    x = sys._getframe().f_lineno - base
    y = (sys._getframe().f_lineno
         - base)
    z = [
        sys._getframe().f_lineno - base,
        sys._getframe().f_lineno - base,
    ]
    return x, y, z
print(lines())
def caller_line(): return sys._getframe(1).f_lineno
base = sys._getframe().f_lineno
print(caller_line() - base, (caller_line()
      - base), [caller_line() - base,
 caller_line() - base])
# f_locals
def loc(p, q=2):
    r = 3
    fr = sys._getframe()
    snap = dict(fr.f_locals); snap.pop("fr")
    return snap, type(fr.f_locals).__name__, "r" in fr.f_locals, fr.f_locals["p"], len(fr.f_locals), sorted(fr.f_locals), fr.f_locals.get("zz", "dflt")
print(loc(1))
def write_through():
    x = 1
    fr = sys._getframe()
    fr.f_locals["x"] = 2
    fr.f_locals["extra"] = 3
    return x, fr.f_locals["extra"], "extra" in fr.f_locals, "extra" in locals(), sorted(fr.f_locals)
print(write_through())
def other_frame_write():
    v = "original"
    def change(): sys._getframe(1).f_locals["v"] = "changed by the callee"
    change()
    return v
print(other_frame_write())
def cells():
    c = "cell"
    def inner(): return c, sorted(sys._getframe().f_locals), sys._getframe().f_locals["c"]
    return inner(), sys._getframe().f_locals["c"]
print(cells())
def unbound_local():
    fr = sys._getframe()
    before = "later" in fr.f_locals
    later = 1
    after = "later" in fr.f_locals
    del later
    return before, after, "later" in fr.f_locals
print(unbound_local())
def proxy_errors():
    fl = sys._getframe().f_locals
    r = []
    for op in (lambda: fl["nope"], lambda: fl.pop("fl"), lambda: fl.clear(), lambda: fl.__delitem__("fl"), lambda: fl.__setitem__(1, 2), lambda: hash(fl), lambda: fl.popitem()):
        try: op(); r.append("ok")
        except Exception as e: r.append(type(e).__name__ + ": " + str(e))
    return r
print(proxy_errors())
def kept():
    secret = 42
    return sys._getframe()
k = kept(); print(k.f_locals["secret"], k.f_back and k.f_back.f_code.co_name, k.f_code.co_name, dict(k.f_locals))
def s1(): f.f_code = None
def s2(): f.f_back = None
def s3(): f.x = 1
def s4(): f.f_lineno = 1
def s5(): f.f_locals = {}
def s6(): del f.f_trace
for s in (s1, s2, s3, s4, s5): t(s)
t(lambda: type(f)()); t(lambda: f.clear()); t(lambda: sys._getframe().clear()); t(lambda: f == f); t(lambda: hash(f) == hash(f)); t(lambda: type("X", (type(f),), {}))
# Tracebacks.
def boom(): raise ValueError("boom")
def mid(): boom()
def top():
    try: mid()
    except ValueError as e: return e.__traceback__
tb = top()
def walk(tb):
    out = []
    while tb: out.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno, type(tb.tb_lasti).__name__)); tb = tb.tb_next
    return out
print(type(tb).__name__, walk(tb), tb.tb_frame.f_code.co_name, tb.tb_next.tb_next.tb_next, repr(tb)[:17])
TB = type(tb); new = TB(None, tb.tb_frame, tb.tb_lasti, 99); print(new.tb_lineno, new.tb_next, new.tb_frame is tb.tb_frame); new2 = TB(new, tb.tb_frame, 0, 1); print(new2.tb_next is new)
t(lambda: TB()); t(lambda: TB(1, tb.tb_frame, 0, 1)); t(lambda: TB(None, 1, 0, 1)); t(lambda: TB(None, tb.tb_frame, "a", 1)); t(lambda: type("X", (TB,), {}))
new.tb_next = tb; print(new.tb_next is tb); new.tb_next = None; print(new.tb_next)
def n1(): new.tb_next = 1
def n2(): new.tb_next = new
def n3(): new.tb_frame = None
def n4(): new.tb_lineno = 1
def n5(): del new.tb_next
def n6():
    x = TB(None, tb.tb_frame, 0, 1); y = TB(x, tb.tb_frame, 0, 1); x.tb_next = y
for n in (n1, n2, n3, n4, n5, n6): t(n)
def multi_line_raise():
    try:
        raise ValueError(
            "spread over"
            " lines")
    except ValueError as e: return e.__traceback__.tb_lineno - multi_line_raise.__code__.co_firstlineno
def multi_line_call():
    try:
        int(
            "x"
        )
    except ValueError as e: return e.__traceback__.tb_lineno - multi_line_call.__code__.co_firstlineno
def multi_line_expr():
    try:
        x = (1 +
             2 /
             0 +
             3)
    except ZeroDivisionError as e: return e.__traceback__.tb_lineno - multi_line_expr.__code__.co_firstlineno
def in_for_header():
    try:
        for x in (
            5
        ): pass
    except TypeError as e: return e.__traceback__.tb_lineno - in_for_header.__code__.co_firstlineno
def in_with_exit():
    class CM:
        def __enter__(s): pass
        def __exit__(s, *a): raise KeyError("exit")
    try:
        with CM():
            pass
            pass
    except KeyError as e: return e.__traceback__.tb_lineno - in_with_exit.__code__.co_firstlineno
def reraised():
    try:
        try:
            1 / 0
        except ZeroDivisionError:
            raise
    except ZeroDivisionError as e: return walk(e.__traceback__)
def raised_again():
    try:
        try:
            1 / 0
        except ZeroDivisionError as z:
            raise z
    except ZeroDivisionError as e: return walk(e.__traceback__)
def from_finally():
    try:
        try:
            1 / 0
        finally:
            pass
    except ZeroDivisionError as e: return walk(e.__traceback__)
print(multi_line_raise(), multi_line_call(), multi_line_expr(), in_for_header(), in_with_exit(), reraised(), raised_again(), from_finally())
def frames_alive():
    def inner(): local_value = "kept alive by the traceback"; raise ValueError
    try: inner()
    except ValueError as e: return e.__traceback__.tb_next.tb_frame.f_locals["local_value"]
print(frames_alive())
e1 = ValueError("no traceback until raised"); print(e1.__traceback__)
try: raise e1
except ValueError: pass
print(walk(e1.__traceback__))
try: raise e1
except ValueError: pass
print(walk(e1.__traceback__), "raising again prepends nothing at the same level but appends an entry")
