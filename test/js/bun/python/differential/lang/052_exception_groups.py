def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def show(g, indent=0):
    if isinstance(g, BaseExceptionGroup):
        return "%s(%r, [%s])" % (type(g).__name__, g.message, ", ".join(show(e) for e in g.exceptions))
    return repr(g)

g = ExceptionGroup("msg", [ValueError(1), TypeError(2)])
print(repr(g), "|", str(g), "|", g.message, g.exceptions, g.args, type(g), isinstance(g, Exception), isinstance(g, BaseExceptionGroup), ExceptionGroup.__mro__, len(g.exceptions), type(g.exceptions))
print(str(ExceptionGroup("one", [ValueError()])), "|", str(ExceptionGroup("", [ValueError(), KeyError(), TypeError()])), "|", repr(ExceptionGroup("n", [ExceptionGroup("i", [ValueError(1)])])), "|", repr(BaseExceptionGroup("b", [KeyboardInterrupt()])), type(BaseExceptionGroup("b", [ValueError()])).__name__, type(BaseExceptionGroup("b", [KeyboardInterrupt()])).__name__, type(BaseExceptionGroup("b", [ValueError(), SystemExit()])).__name__, type(BaseExceptionGroup("b", (ValueError(),))).__name__, ExceptionGroup("t", (ValueError(1),)).exceptions, ExceptionGroup("t", iter([ValueError(1)])).exceptions if False else "")
t(lambda: ExceptionGroup()); t(lambda: ExceptionGroup("m")); t(lambda: ExceptionGroup("m", [])); t(lambda: ExceptionGroup("m", ())); t(lambda: ExceptionGroup("m", [1])); t(lambda: ExceptionGroup("m", [ValueError(), 1])); t(lambda: ExceptionGroup("m", [ValueError])); t(lambda: ExceptionGroup("m", ValueError())); t(lambda: ExceptionGroup("m", 1)); t(lambda: ExceptionGroup(1, [ValueError()])); t(lambda: ExceptionGroup(None, [ValueError()])); t(lambda: ExceptionGroup("m", [KeyboardInterrupt()])); t(lambda: ExceptionGroup("m", [ValueError(), SystemExit()])); t(lambda: ExceptionGroup("m", [BaseExceptionGroup("b", [KeyboardInterrupt()])])); t(lambda: ExceptionGroup("m", [ValueError()], 1)); t(lambda: ExceptionGroup("m", "ab")); t(lambda: ExceptionGroup("m", {ValueError()})); t(lambda: ExceptionGroup("m", None)); t(lambda: ExceptionGroup(message="m", exceptions=[ValueError()])); t(lambda: BaseExceptionGroup("m", []))
def s1(): g.message = "x"
def s2(): g.exceptions = ()
t(s1); t(s2)
l = [ValueError(1)]; gl = ExceptionGroup("l", l); l.append(TypeError(2)); print(gl.exceptions, gl.args)
# subgroup and split
n = ExceptionGroup("top", [ValueError("v1"), ExceptionGroup("mid", [TypeError("t1"), ValueError("v2"), ExceptionGroup("low", [KeyError("k1")])]), OSError("o1")])
print(show(n.subgroup(ValueError))); print(show(n.subgroup(TypeError))); print(show(n.subgroup(KeyError))); print(show(n.subgroup((ValueError, KeyError)))); print(n.subgroup(ZeroDivisionError)); print(n.subgroup(Exception) is n, n.subgroup(ExceptionGroup) is n, show(n.subgroup(LookupError)), show(n.subgroup(lambda e: isinstance(e, OSError))), n.subgroup(lambda e: False), n.subgroup(lambda e: True) is n, show(n.subgroup(lambda e: str(e).endswith("1") and not isinstance(e, BaseExceptionGroup))))
for cond in (ValueError, (TypeError, OSError), ZeroDivisionError, Exception, lambda e: isinstance(e, KeyError)):
    m, r = n.split(cond); print(show(m), "||", show(r))
seen = []; n.subgroup(lambda e: seen.append(type(e).__name__) or False); print(seen)
t(lambda: n.subgroup(1)); t(lambda: n.subgroup("a")); t(lambda: n.subgroup(int)); t(lambda: n.subgroup((ValueError, 1))); t(lambda: n.subgroup(())); t(lambda: n.subgroup([ValueError])); t(lambda: n.split(None)); t(lambda: n.subgroup()); t(lambda: n.split(ValueError, 1)); t(lambda: n.subgroup((int,))); t(lambda: n.subgroup(object))
# Metadata is copied to the parts.
try:
    try: raise KeyError("ctx")
    except KeyError: raise ExceptionGroup("meta", [ValueError(1), TypeError(2)]) from OSError("cause")
except ExceptionGroup as e: meta = e
meta.add_note("a note"); sub = meta.subgroup(ValueError)
print(sub.__traceback__ is meta.__traceback__, repr(sub.__cause__), repr(sub.__context__), sub.__notes__, sub.__notes__ is meta.__notes__, sub.message, sub.exceptions[0] is meta.exceptions[0], sub.__suppress_context__)
# derive
d = g.derive([KeyError("k")]); print(show(d), type(d).__name__, d.message, d.__traceback__, d.__cause__, hasattr(d, "__notes__"))
print(type(g.derive([KeyboardInterrupt()])).__name__, type(BaseExceptionGroup("b", [SystemExit()]).derive([ValueError()])).__name__)
class MyGroup(ExceptionGroup):
    def __new__(cls, msg, excs, code=0):
        o = super().__new__(cls, msg, excs); o.code = code; return o
    def derive(self, excs): return MyGroup(self.message, excs, self.code)
class NoDerive(ExceptionGroup): pass
mg = MyGroup("my", [ValueError(1), TypeError(2)], 42); a, b = mg.split(ValueError); print(type(a).__name__, a.code, type(b).__name__, b.code, show(a), repr(mg), mg.args)
nd = NoDerive("nd", [ValueError(1), TypeError(2)]); a, b = nd.split(ValueError); print(type(a).__name__, type(b).__name__, type(nd.subgroup(Exception)).__name__)
class BadDerive(ExceptionGroup):
    def derive(self, excs): return 5
t(lambda: BadDerive("b", [ValueError(1), TypeError(2)]).split(ValueError))
class BaseOnly(BaseExceptionGroup): pass
class ExcAndBase(BaseExceptionGroup, ValueError): pass
print(type(BaseOnly("b", [ValueError()])).__name__, type(BaseOnly("b", [KeyboardInterrupt()])).__name__, type(ExcAndBase("b", [ValueError()])).__name__); t(lambda: ExcAndBase("b", [KeyboardInterrupt()]))
print(ExceptionGroup[int], BaseExceptionGroup[int], g.__reduce__()[0].__name__ if hasattr(g, "__reduce__") else "", g == g, g != ExceptionGroup("msg", [ValueError(1), TypeError(2)]), bool(g))
# except*
def run(exc, *handlers):
    log = []
    src = "try:\n    raise exc\n" + "".join("except* %s as e:\n    log.append((%r, show(e)))\n" % (h, h) for h in handlers)
    try: exec(src, {"exc": exc, "log": log, "show": show})
    except BaseException as e: log.append(("escaped", show(e)))
    print(log)
run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError"); run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError", "TypeError"); run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "KeyError"); run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "Exception"); run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "(ValueError, TypeError)"); run(ExceptionGroup("g", [ValueError(1), ValueError(2), TypeError(3)]), "ValueError"); run(n, "ValueError", "KeyError"); run(n, "OSError", "Exception"); run(ValueError("naked"), "ValueError"); run(ValueError("naked"), "TypeError"); run(ValueError("naked"), "TypeError", "Exception"); run(KeyError("naked"), "LookupError", "KeyError"); run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "ValueError"); run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "BaseException"); run(KeyboardInterrupt(), "KeyboardInterrupt"); run(mg, "ValueError"); run(ExceptionGroup("o", [ExceptionGroup("i", [ValueError(1)])]), "ValueError")
def flow():
    out = []
    try: out.append("body")
    except* ValueError: out.append("no")
    else: out.append("else")
    finally: out.append("finally")
    return out
print(flow())
def raise_in_handler():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError: raise KeyError("new")
def raise_in_two():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError: raise KeyError("k")
    except* TypeError: raise OSError("o")
def reraise_bare():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError: raise
def reraise_e():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError as e: raise e
def reraise_all():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError: raise
    except* TypeError: raise
def raise_and_unhandled():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2), OSError(3)])
    except* ValueError: raise KeyError("k")
    except* TypeError: pass
def raise_group_in_handler():
    try: raise ExceptionGroup("g", [ValueError(1)])
    except* ValueError: raise ExceptionGroup("new", [KeyError("k")])
def naked_reraise():
    try: raise ValueError("naked")
    except* ValueError: raise
def nested_reraise():
    try: raise n
    except* ValueError: raise
    except* KeyError: pass
for f in (raise_in_handler, raise_in_two, reraise_bare, reraise_e, reraise_all, raise_and_unhandled, raise_group_in_handler, naked_reraise, nested_reraise):
    try: f()
    except BaseException as e: print(f.__name__, show(e), "| ctx:", show(e.__context__) if e.__context__ else None, "| inner ctx:", [show(x.__context__) if x.__context__ else None for x in getattr(e, "exceptions", [])])
import sys
def exc_in_handler():
    try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError as e: print(show(sys.exception()), show(e), sys.exception() is e)
    except* TypeError as e: print(show(sys.exception()))
    print(sys.exception())
exc_in_handler()
def name_deleted():
    try: raise ExceptionGroup("g", [ValueError(1)])
    except* ValueError as e: pass
    return e
t(name_deleted)
t(lambda: exec("try: raise ValueError\nexcept* ExceptionGroup: pass")); t(lambda: exec("try: raise ValueError\nexcept* BaseExceptionGroup: pass")); t(lambda: exec("try: raise ValueError\nexcept* (ValueError, ExceptionGroup): pass")); t(lambda: exec("try: raise ValueError\nexcept* 1: pass")); t(lambda: exec("try: raise ValueError\nexcept* (ValueError, 1): pass")); t(lambda: exec("try: raise ValueError\nexcept* int: pass")); t(lambda: exec("try: raise ValueError\nexcept* (): pass")); t(lambda: exec("try: pass\nexcept* ExceptionGroup: pass\nprint('checked only when raised')")); t(lambda: exec("try: raise ValueError\nexcept* MyG: pass", {"MyG": MyGroup}))
for src in ("try: pass\nexcept*: pass", "try: pass\nexcept* ValueError: pass\nexcept TypeError: pass", "try: pass\nexcept ValueError: pass\nexcept* TypeError: pass", "try: pass\nexcept* ValueError: pass\nexcept: pass", "def f():\n try: pass\n except* ValueError: return", "for i in x:\n try: pass\n except* ValueError: break", "for i in x:\n try: pass\n except* ValueError: continue", "for i in x:\n try: pass\n except* ValueError:\n  for j in y: break", "def f():\n try: pass\n except* ValueError:\n  def g(): return", "try: pass\nexcept * ValueError: pass", "try: pass\nexcept *ValueError as e: pass", "try: pass\nexcept* ValueError, TypeError: pass", "try: pass\nexcept* ValueError, TypeError as e: pass", "try: pass\nexcept* (ValueError, TypeError) as e: pass", "try: pass\nexcept* ValueError as e.x: pass", "def f():\n try: return\n except* ValueError: pass", "def f():\n try: pass\n except* ValueError: pass\n else: return\n finally: return", "def g():\n try: yield\n except* ValueError: yield", "async def f():\n try: await x\n except* ValueError: await y"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg)
def gen_star():
    try: yield 1; raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError as e: yield show(e)
    except* TypeError as e: yield show(e)
    yield "end"
print(list(gen_star()))
def loop_star():
    out = []
    for i in range(3):
        try:
            if i == 1: raise ExceptionGroup("g", [ValueError(i)])
            out.append(i)
        except* ValueError as e: out.append(show(e))
    return out
print(loop_star())
def nested_star():
    try:
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2), KeyError(3)])
        except* ValueError as e: print("inner", show(e))
    except* TypeError as e: print("outer", show(e))
    except* KeyError as e: print("outer", show(e))
nested_star()

# The part that a clause caught stays the exception that is being handled until the next clause catches something: where that says what it catches.
def shown(e):
    return None if e is None else '%s(%s)' % (type(e).__name__, ', '.join(map(repr, e.args[:1])) + (': ' + ', '.join(shown(x) for x in e.exceptions) if isinstance(e, BaseExceptionGroup) else ''))
def between1():
    try:
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
        except* ValueError:
            pass
        except* 1 / 0:
            pass
    except BaseException as e:
        print('between 1', shown(e), '| context', shown(e.__context__))
def between2():
    try:
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
        except* KeyError:
            pass
        except* 1 / 0:
            pass
    except BaseException as e:
        print('between 2', shown(e), '| context', shown(e.__context__))
def between3():
    import sys
    def f():
        print('between 3 handled while the type is evaluated', shown(sys.exception()))
        return TypeError
    try:
        raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
    except* ValueError:
        print('between 3 in clause', shown(sys.exception()))
    except* f():
        print('between 3 in clause', shown(sys.exception()))
def between4():
    try:
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2), KeyError(3)])
        except* ValueError:
            pass
        except* TypeError:
            pass
        except* 1 / 0:
            pass
    except BaseException as e:
        print('between 4', shown(e), '| context', shown(e.__context__))
def between5():
    try:
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
        except* ValueError:
            raise OSError(5)
        except* 1 / 0:
            pass
    except BaseException as e:
        print('between 5', shown(e), '| context', shown(e.__context__))
for between in (between1, between2, between3, between4, between5): between()
