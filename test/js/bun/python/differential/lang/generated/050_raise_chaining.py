try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def chain(e):
        out = []
        while e is not None:
            out.append((type(e).__name__, str(e), "cause" if e.__cause__ is not None else "ctx" if e.__context__ is not None else "end", e.__suppress_context__))
            e = e.__cause__ or e.__context__
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chain(e):')
try:
    def catch(f):
        try: f()
        except BaseException as e: return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catch(f):')

try:
    def r1(): raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r1(): raise ValueError')
try:
    def r2(): raise ValueError()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r2(): raise ValueError()')
try:
    def r3(): raise ValueError("msg")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r3(): raise ValueError("msg")')
try:
    def r4(): raise ValueError("a", "b")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r4(): raise ValueError("a", "b")')
try:
    def r5(): raise ValueError("x") from None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r5(): raise ValueError("x") from None')
try:
    def r6(): raise ValueError("x") from KeyError("cause")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r6(): raise ValueError("x") from KeyError("cause")')
try:
    def r7(): raise ValueError("x") from KeyError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r7(): raise ValueError("x") from KeyError')
try:
    def r8(): raise ValueError from KeyError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r8(): raise ValueError from KeyError')
try:
    for f in (r1, r2, r3, r4, r5, r6, r7, r8):
        try: e = catch(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = catch(f)')
        try: print('repr(e) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e)')
        try: print('e.args [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', e.args)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.args')
        try: print('repr(e.__cause__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e.__cause__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e.__cause__)')
        try: print('repr(e.__context__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e.__context__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e.__context__)')
        try: print('e.__suppress_context__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', e.__suppress_context__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (r1, r2, r3, r4, r5, r6, r7, r8):')
try: print('exec("raise") =>', end=" "); t(lambda: exec("raise"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise"))')
try: print('exec("raise 1") =>', end=" "); t(lambda: exec("raise 1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise 1"))')
try: print('exec("raise \'string\'") =>', end=" "); t(lambda: exec("raise 'string'"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise \'string\'"))')
try: print('exec("raise None") =>', end=" "); t(lambda: exec("raise None"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise None"))')
try: print('exec("raise int") =>', end=" "); t(lambda: exec("raise int"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise int"))')
try: print('exec("raise object()") =>', end=" "); t(lambda: exec("raise object()"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise object()"))')
try: print('exec("raise [ValueError]") =>', end=" "); t(lambda: exec("raise [ValueError]"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise [ValueError]"))')
try: print('exec("raise (ValueError,)") =>', end=" "); t(lambda: exec("raise (ValueError,)"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise (ValueError,)"))')
try: print('exec("raise ValueError from 1") =>', end=" "); t(lambda: exec("raise ValueError from 1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from 1"))')
try: print('exec("raise ValueError from \'x\'") =>', end=" "); t(lambda: exec("raise ValueError from 'x'"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from \'x\'"))')
try: print('exec("raise ValueError from int") =>', end=" "); t(lambda: exec("raise ValueError from int"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from int"))')
try: print('exec("raise ValueError from object()") =>', end=" "); t(lambda: exec("raise ValueError from object()"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from object()"))')
try: print('exec("raise 1 from ValueError") =>', end=" "); t(lambda: exec("raise 1 from ValueError"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise 1 from ValueError"))')
try: print('exec("raise NotImplemented") =>', end=" "); t(lambda: exec("raise NotImplemented"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise NotImplemented"))')
try: print('exec("raise undefined") =>', end=" "); t(lambda: exec("raise undefined"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise undefined"))')
try: print('exec("raise ValueError from undefined") =>', end=" "); t(lambda: exec("raise ValueError from undefined"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from undefined"))')
try: print('exec("raise type") =>', end=" "); t(lambda: exec("raise type"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise type"))')
try:
    class BadInit(Exception):
        def __init__(self): raise RuntimeError("init failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadInit(Exception):')
try:
    class NeedsArg(Exception):
        def __init__(self, a): super().__init__(a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NeedsArg(Exception):')
try:
    class NewOther(Exception):
        def __new__(cls): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NewOther(Exception):')
try: print('exec("raise BadInit", {"BadInit": BadInit}) =>', end=" "); t(lambda: exec("raise BadInit", {"BadInit": BadInit}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise BadInit", {"BadInit": BadInit}))')
try: print('exec("raise NeedsArg", {"NeedsArg": NeedsArg}) =>', end=" "); t(lambda: exec("raise NeedsArg", {"NeedsArg": NeedsArg}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise NeedsArg", {"NeedsArg": NeedsArg}))')
try: print('exec("raise NewOther", {"NewOther": NewOther}) =>', end=" "); t(lambda: exec("raise NewOther", {"NewOther": NewOther}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise NewOther", {"NewOther": NewOther}))')
try: print('exec("raise ValueError from BadInit", {"BadInit": BadInit}) =>', end=" "); t(lambda: exec("raise ValueError from BadInit", {"BadInit": BadInit}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("raise ValueError from BadInit", {"BadInit": BadInit}))')
# Implicit chaining.
try:
    def c1():
        try: raise KeyError("first")
        except KeyError: raise ValueError("second")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1():')
try:
    def c2():
        try: raise KeyError("first")
        except KeyError as k: raise ValueError("second") from k
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2():')
try:
    def c3():
        try: raise KeyError("first")
        except KeyError: raise ValueError("second") from None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3():')
try:
    def c4():
        try: raise KeyError("first")
        except KeyError: raise ValueError("second") from TypeError("explicit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4():')
try:
    def c5():
        try:
            try: raise KeyError("1")
            except KeyError: raise ValueError("2")
        except ValueError: raise TypeError("3")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c5():')
try:
    def c6():
        try: raise KeyError("first")
        finally: raise ValueError("in finally")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c6():')
try:
    def c7():
        try: raise KeyError("first")
        except KeyError: 1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c7():')
try:
    def c8():
        try: raise KeyError("first")
        except KeyError: pass
        raise ValueError("after the handler: no context")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c8():')
try:
    def c9():
        try: raise KeyError("first")
        except KeyError:
            try: raise ValueError("inner")
            except ValueError: pass
            raise TypeError("context is the KeyError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c9():')
try:
    def c10():
        try: raise KeyError("first")
        except KeyError as k:
            raise k
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c10():')
try:
    def c11():
        e = ValueError("reused")
        try: raise e
        except ValueError:
            try: raise KeyError("k")
            except KeyError: raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c11():')
try:
    def c12():
        def helper(): raise ValueError("raised in a function called from the handler")
        try: raise KeyError("first")
        except KeyError: helper()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c12():')
try:
    def c13():
        try: raise KeyError("first")
        except KeyError:
            return [1 / 0 for _ in range(1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c13():')
try:
    def c14():
        class CM:
            def __enter__(s): return s
            def __exit__(s, *a): raise ValueError("from __exit__")
        with CM(): raise KeyError("in with")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c14():')
try:
    for f in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14): print(f.__name__, chain(catch(f)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14...')
# Cycles are avoided.
try:
    def cy1():
        a = ValueError("a"); b = KeyError("b")
        try:
            try: raise a
            except ValueError:
                try: raise b
                except KeyError: raise a
        except ValueError as e: return repr(e.__context__), repr(b.__context__), e is a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cy1():')
try: print(cy1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cy1()')
try:
    def cy2():
        e = ValueError("self")
        try:
            try: raise e
            except ValueError: raise e
        except ValueError as x: return x.__context__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cy2():')
try: print(cy2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cy2()')
# The attributes can be set.
try: e = ValueError("e")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = ValueError("e")')
try: print('e.__cause__ =>', e.__cause__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__cause__')
try: print('e.__context__ =>', e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__context__')
try: print('e.__suppress_context__ =>', e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
try: print('e.__traceback__ =>', e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__traceback__')
try: e.__cause__ = KeyError("k")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__cause__ = KeyError("k")')
try: print('repr(e.__cause__) =>', repr(e.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e.__cause__)')
try: print('e.__suppress_context__ =>', e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
try: e.__cause__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__cause__ = None')
try: print('e.__cause__ =>', e.__cause__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__cause__')
try: print('e.__suppress_context__ =>', e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
try: e.__context__ = TypeError("t")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__context__ = TypeError("t")')
try: print(repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e.__context__)')
try: e.__suppress_context__ = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__ = False')
try: print(e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
try: e.__suppress_context__ = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__ = True')
try: print(e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__suppress_context__')
try: e.__context__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__context__ = None')
try:
    def s1(): e.__cause__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): e.__cause__ = 1')
try:
    def s2(): e.__context__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): e.__context__ = "x"')
try:
    def s3(): e.__traceback__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): e.__traceback__ = 1')
try:
    def s4(): del e.__cause__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): del e.__cause__')
try:
    def s5(): del e.__context__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): del e.__context__')
try:
    def s6(): del e.__traceback__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): del e.__traceback__')
try:
    def s7(): e.__cause__ = ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s7(): e.__cause__ = ValueError')
try:
    def s8(): del e.__suppress_context__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s8(): del e.__suppress_context__')
try:
    def s9(): e.__suppress_context__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s9(): e.__suppress_context__ = "x"')
try:
    def s10(): e.__suppress_context__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s10(): e.__suppress_context__ = 1')
try:
    for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10): t(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10): t(s)')
# with_traceback, __traceback__
try: x = catch(r3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = catch(r3)')
try: tb = x.__traceback__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb = x.__traceback__')
try: print('type(tb).__name__ =>', type(tb).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(tb).__name__')
try: print('tb.tb_frame.f_code.co_name =>', tb.tb_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_frame.f_code.co_name')
try: print('tb.tb_next.tb_frame.f_code.co_name =>', tb.tb_next.tb_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_next.tb_frame.f_code.co_name')
try: print('tb.tb_next.tb_next =>', tb.tb_next.tb_next)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_next.tb_next')
try: print('type(tb.tb_lineno).__name__ =>', type(tb.tb_lineno).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(tb.tb_lineno).__name__')
try: print('tb.tb_next.tb_lineno == r3.__code__.co_firstlineno =>', tb.tb_next.tb_lineno == r3.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_next.tb_lineno == r3.__code__.co_firstlineno')
try: print('x.with_traceback(None) is x =>', x.with_traceback(None) is x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.with_traceback(None) is x')
try: print('x.__traceback__ =>', x.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__traceback__')
try: print('x.with_traceback(tb).__traceback__ is tb =>', x.with_traceback(tb).__traceback__ is tb)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.with_traceback(tb).__traceback__ is tb')
try: print('x.with_traceback(1) =>', end=" "); t(lambda: x.with_traceback(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: x.with_traceback(1))')
try: print('x.with_traceback() =>', end=" "); t(lambda: x.with_traceback())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: x.with_traceback())')
try:
    def depth(tb):
        n = []
        while tb: n.append(tb.tb_frame.f_code.co_name); tb = tb.tb_next
        return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def depth(tb):')
try:
    def lvl3(): raise ValueError("deep")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lvl3(): raise ValueError("deep")')
try:
    def lvl2(): lvl3()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lvl2(): lvl3()')
try:
    def lvl1(): lvl2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lvl1(): lvl2()')
try: print(depth(catch(lvl1).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(catch(lvl1).__traceback__)')
try:
    def reraise():
        try: lvl2()
        except ValueError: raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraise():')
try: print(depth(catch(reraise).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(catch(reraise).__traceback__)')
try:
    def reraise_as():
        try: lvl2()
        except ValueError as e: raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraise_as():')
try: print(depth(catch(reraise_as).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(catch(reraise_as).__traceback__)')
try:
    def raise_saved():
        saved = catch(lvl3)
        raise saved
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_saved():')
try: print(depth(catch(raise_saved).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(catch(raise_saved).__traceback__)')
try:
    def fin():
        try: lvl3()
        finally: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fin():')
try: print(depth(catch(fin).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(catch(fin).__traceback__)')
try:
    def native(): return [1, 2].index(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def native(): return [1, 2].index(5)')
try:
    def via_map(): return list(map(lambda v: 1 / v, [0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_map(): return list(map(lambda v: 1 / v, [0]))')
try:
    def via_sort(): return sorted([1, 2], key=lambda v: lvl3())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_sort(): return sorted([1, 2], key=lambda v: lvl3())')
try:
    def via_comp(): return [lvl3() for _ in range(1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_comp(): return [lvl3() for _ in range(1)]')
try:
    def via_gen(): return list(lvl3() for _ in range(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_gen(): return list(lvl3() for _ in range(1))')
try:
    def via_cls():
        class K:
            def __init__(s): lvl3()
        K()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_cls():')
try:
    def via_prop():
        class K:
            p = property(lambda s: lvl3())
        K().p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_prop():')
try:
    def via_op():
        class K:
            def __add__(s, o): lvl3()
        K() + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_op():')
try:
    def bad_call(): lvl3(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bad_call(): lvl3(1)')
try:
    for f in (native, via_map, via_sort, via_comp, via_gen, via_cls, via_prop, via_op, bad_call): print(f.__name__, depth(catch(f).__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (native, via_map, via_sort, via_comp, via_gen, via_cls, via_...')
# sys.exception(), sys.exc_info()
try: print('sys.exception() =>', sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try: print('sys.exc_info() =>', sys.exc_info())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exc_info()')
try:
    try: raise ValueError("cur")
    except ValueError as e:
        print('sys.exception() is e =>', sys.exception() is e)
        print('sys.exc_info()[0].__name__ =>', sys.exc_info()[0].__name__)
        print('sys.exc_info()[1] is e =>', sys.exc_info()[1] is e)
        print('sys.exc_info()[2] is e.__traceback__ =>', sys.exc_info()[2] is e.__traceback__)
        try: raise KeyError("nested")
        except KeyError as k: print(repr(sys.exception()))
        print(repr(sys.exception()))
        def inner(): return repr(sys.exception())
        print(inner())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise ValueError("cur")')
try: print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    def in_finally():
        try: raise ValueError("f")
        finally: print("finally sees", repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_finally():')
try: catch(in_finally)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: catch(in_finally)')
try: print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    def fin_no_exc():
        try: pass
        finally: return sys.exception()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fin_no_exc():')
try: print(fin_no_exc())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fin_no_exc()')
try:
    def handler_return():
        try: raise ValueError("r")
        except ValueError: return repr(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handler_return():')
try: print('handler_return() =>', handler_return())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: handler_return()')
try: print('sys.exception() =>', sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    def loop_handlers():
        out = []
        for i in range(2):
            try: raise ValueError(i)
            except ValueError:
                out.append(repr(sys.exception()))
                if i == 0: continue
                break
        out.append(sys.exception()); return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_handlers():')
try: print(loop_handlers())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_handlers()')
try:
    def gen_exc():
        yield repr(sys.exception())
        try: raise KeyError("in gen")
        except KeyError:
            yield repr(sys.exception())
            yield repr(sys.exception())
        yield repr(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_exc():')
try: g = gen_exc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen_exc()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('sys.exception() =>', sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    try: raise ValueError("outside")
    except ValueError: print(next(g), repr(sys.exception()), next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise ValueError("outside")')
try: print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    def bare_raise_in_func(): raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bare_raise_in_func(): raise')
try:
    def use_bare():
        try: raise ValueError("active")
        except ValueError: bare_raise_in_func()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def use_bare():')
try: print('repr(catch(use_bare)) =>', repr(catch(use_bare)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(catch(use_bare))')
try: print('repr(catch(bare_raise_in_func)) =>', repr(catch(bare_raise_in_func)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(catch(bare_raise_in_func))')
try:
    def bare_after():
        try: raise ValueError("gone")
        except ValueError: pass
        raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bare_after():')
try: print(repr(catch(bare_after)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(catch(bare_after))')
try:
    def bare_in_finally():
        try: raise ValueError("fin")
        finally:
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bare_in_finally():')
try: print('repr(catch(bare_in_finally)) =>', repr(catch(bare_in_finally)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(catch(bare_in_finally))')
try: print('chain(catch(bare_in_finally)) =>', chain(catch(bare_in_finally)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chain(catch(bare_in_finally))')
try:
    for src in ("raise from x", "raise x from", "raise x, y", "raise x from y from z", "raise x y", "raise *x", "raise x if y else z", "raise (yield)", "raise\nfrom x", "raise x from None", "raise lambda: 1", "raise x := 1"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as ex: print("SyntaxError:", ex.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("raise from x", "raise x from", "raise x, y", "raise x fr...')
