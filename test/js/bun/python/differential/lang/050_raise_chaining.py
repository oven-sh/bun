import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def chain(e):
    out = []
    while e is not None:
        out.append((type(e).__name__, str(e), "cause" if e.__cause__ is not None else "ctx" if e.__context__ is not None else "end", e.__suppress_context__))
        e = e.__cause__ or e.__context__
    return out
def catch(f):
    try: f()
    except BaseException as e: return e

def r1(): raise ValueError
def r2(): raise ValueError()
def r3(): raise ValueError("msg")
def r4(): raise ValueError("a", "b")
def r5(): raise ValueError("x") from None
def r6(): raise ValueError("x") from KeyError("cause")
def r7(): raise ValueError("x") from KeyError
def r8(): raise ValueError from KeyError
for f in (r1, r2, r3, r4, r5, r6, r7, r8):
    e = catch(f); print(repr(e), e.args, repr(e.__cause__), repr(e.__context__), e.__suppress_context__)
t(lambda: exec("raise"))
t(lambda: exec("raise 1"))
t(lambda: exec("raise 'string'"))
t(lambda: exec("raise None"))
t(lambda: exec("raise int"))
t(lambda: exec("raise object()"))
t(lambda: exec("raise [ValueError]"))
t(lambda: exec("raise (ValueError,)"))
t(lambda: exec("raise ValueError from 1"))
t(lambda: exec("raise ValueError from 'x'"))
t(lambda: exec("raise ValueError from int"))
t(lambda: exec("raise ValueError from object()"))
t(lambda: exec("raise 1 from ValueError"))
t(lambda: exec("raise NotImplemented"))
t(lambda: exec("raise undefined"))
t(lambda: exec("raise ValueError from undefined"))
t(lambda: exec("raise type"))
class BadInit(Exception):
    def __init__(self): raise RuntimeError("init failed")
class NeedsArg(Exception):
    def __init__(self, a): super().__init__(a)
class NewOther(Exception):
    def __new__(cls): return 5
t(lambda: exec("raise BadInit", {"BadInit": BadInit})); t(lambda: exec("raise NeedsArg", {"NeedsArg": NeedsArg})); t(lambda: exec("raise NewOther", {"NewOther": NewOther})); t(lambda: exec("raise ValueError from BadInit", {"BadInit": BadInit}))
# Implicit chaining.
def c1():
    try: raise KeyError("first")
    except KeyError: raise ValueError("second")
def c2():
    try: raise KeyError("first")
    except KeyError as k: raise ValueError("second") from k
def c3():
    try: raise KeyError("first")
    except KeyError: raise ValueError("second") from None
def c4():
    try: raise KeyError("first")
    except KeyError: raise ValueError("second") from TypeError("explicit")
def c5():
    try:
        try: raise KeyError("1")
        except KeyError: raise ValueError("2")
    except ValueError: raise TypeError("3")
def c6():
    try: raise KeyError("first")
    finally: raise ValueError("in finally")
def c7():
    try: raise KeyError("first")
    except KeyError: 1 / 0
def c8():
    try: raise KeyError("first")
    except KeyError: pass
    raise ValueError("after the handler: no context")
def c9():
    try: raise KeyError("first")
    except KeyError:
        try: raise ValueError("inner")
        except ValueError: pass
        raise TypeError("context is the KeyError")
def c10():
    try: raise KeyError("first")
    except KeyError as k:
        raise k
def c11():
    e = ValueError("reused")
    try: raise e
    except ValueError:
        try: raise KeyError("k")
        except KeyError: raise e
def c12():
    def helper(): raise ValueError("raised in a function called from the handler")
    try: raise KeyError("first")
    except KeyError: helper()
def c13():
    try: raise KeyError("first")
    except KeyError:
        return [1 / 0 for _ in range(1)]
def c14():
    class CM:
        def __enter__(s): return s
        def __exit__(s, *a): raise ValueError("from __exit__")
    with CM(): raise KeyError("in with")
for f in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14): print(f.__name__, chain(catch(f)))
# Cycles are avoided.
def cy1():
    a = ValueError("a"); b = KeyError("b")
    try:
        try: raise a
        except ValueError:
            try: raise b
            except KeyError: raise a
    except ValueError as e: return repr(e.__context__), repr(b.__context__), e is a
print(cy1())
def cy2():
    e = ValueError("self")
    try:
        try: raise e
        except ValueError: raise e
    except ValueError as x: return x.__context__
print(cy2())
# The attributes can be set.
e = ValueError("e"); print(e.__cause__, e.__context__, e.__suppress_context__, e.__traceback__)
e.__cause__ = KeyError("k"); print(repr(e.__cause__), e.__suppress_context__); e.__cause__ = None; print(e.__cause__, e.__suppress_context__); e.__context__ = TypeError("t"); print(repr(e.__context__)); e.__suppress_context__ = False; print(e.__suppress_context__); e.__suppress_context__ = True; print(e.__suppress_context__); e.__context__ = None
def s1(): e.__cause__ = 1
def s2(): e.__context__ = "x"
def s3(): e.__traceback__ = 1
def s4(): del e.__cause__
def s5(): del e.__context__
def s6(): del e.__traceback__
def s7(): e.__cause__ = ValueError
def s8(): del e.__suppress_context__
def s9(): e.__suppress_context__ = "x"
def s10(): e.__suppress_context__ = 1
for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10): t(s)
# with_traceback, __traceback__
x = catch(r3); tb = x.__traceback__
print(type(tb).__name__, tb.tb_frame.f_code.co_name, tb.tb_next.tb_frame.f_code.co_name, tb.tb_next.tb_next, type(tb.tb_lineno).__name__, tb.tb_next.tb_lineno == r3.__code__.co_firstlineno, x.with_traceback(None) is x, x.__traceback__, x.with_traceback(tb).__traceback__ is tb)
t(lambda: x.with_traceback(1)); t(lambda: x.with_traceback())
def depth(tb):
    n = []
    while tb: n.append(tb.tb_frame.f_code.co_name); tb = tb.tb_next
    return n
def lvl3(): raise ValueError("deep")
def lvl2(): lvl3()
def lvl1(): lvl2()
print(depth(catch(lvl1).__traceback__))
def reraise():
    try: lvl2()
    except ValueError: raise
print(depth(catch(reraise).__traceback__))
def reraise_as():
    try: lvl2()
    except ValueError as e: raise e
print(depth(catch(reraise_as).__traceback__))
def raise_saved():
    saved = catch(lvl3)
    raise saved
print(depth(catch(raise_saved).__traceback__))
def fin():
    try: lvl3()
    finally: pass
print(depth(catch(fin).__traceback__))
def native(): return [1, 2].index(5)
def via_map(): return list(map(lambda v: 1 / v, [0]))
def via_sort(): return sorted([1, 2], key=lambda v: lvl3())
def via_comp(): return [lvl3() for _ in range(1)]
def via_gen(): return list(lvl3() for _ in range(1))
def via_cls():
    class K:
        def __init__(s): lvl3()
    K()
def via_prop():
    class K:
        p = property(lambda s: lvl3())
    K().p
def via_op():
    class K:
        def __add__(s, o): lvl3()
    K() + 1
def bad_call(): lvl3(1)
for f in (native, via_map, via_sort, via_comp, via_gen, via_cls, via_prop, via_op, bad_call): print(f.__name__, depth(catch(f).__traceback__))
# sys.exception(), sys.exc_info()
print(sys.exception(), sys.exc_info())
try: raise ValueError("cur")
except ValueError as e:
    print(sys.exception() is e, sys.exc_info()[0].__name__, sys.exc_info()[1] is e, sys.exc_info()[2] is e.__traceback__)
    try: raise KeyError("nested")
    except KeyError as k: print(repr(sys.exception()))
    print(repr(sys.exception()))
    def inner(): return repr(sys.exception())
    print(inner())
print(sys.exception())
def in_finally():
    try: raise ValueError("f")
    finally: print("finally sees", repr(sys.exception()))
catch(in_finally); print(sys.exception())
def fin_no_exc():
    try: pass
    finally: return sys.exception()
print(fin_no_exc())
def handler_return():
    try: raise ValueError("r")
    except ValueError: return repr(sys.exception())
print(handler_return(), sys.exception())
def loop_handlers():
    out = []
    for i in range(2):
        try: raise ValueError(i)
        except ValueError:
            out.append(repr(sys.exception()))
            if i == 0: continue
            break
    out.append(sys.exception()); return out
print(loop_handlers())
def gen_exc():
    yield repr(sys.exception())
    try: raise KeyError("in gen")
    except KeyError:
        yield repr(sys.exception())
        yield repr(sys.exception())
    yield repr(sys.exception())
g = gen_exc(); print(next(g), next(g), sys.exception())
try: raise ValueError("outside")
except ValueError: print(next(g), repr(sys.exception()), next(g))
print(sys.exception())
def bare_raise_in_func(): raise
def use_bare():
    try: raise ValueError("active")
    except ValueError: bare_raise_in_func()
print(repr(catch(use_bare)), repr(catch(bare_raise_in_func)))
def bare_after():
    try: raise ValueError("gone")
    except ValueError: pass
    raise
print(repr(catch(bare_after)))
def bare_in_finally():
    try: raise ValueError("fin")
    finally:
        raise
print(repr(catch(bare_in_finally)), chain(catch(bare_in_finally)))
for src in ("raise from x", "raise x from", "raise x, y", "raise x from y from z", "raise x y", "raise *x", "raise x if y else z", "raise (yield)", "raise\nfrom x", "raise x from None", "raise lambda: 1", "raise x := 1"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as ex: print("SyntaxError:", ex.msg)
