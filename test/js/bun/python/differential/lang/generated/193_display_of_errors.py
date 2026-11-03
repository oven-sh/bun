# What the interpreter prints for an exception nobody caught: sys.__excepthook__, sys.__unraisablehook__, threading.excepthook.
try: import io, sys, threading
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import io, sys, threading')

try:
    def shown(call, *args):
        saved, sys.stderr = sys.stderr, io.StringIO()
        try:
            call(*args)
            text = sys.stderr.getvalue()
        finally:
            sys.stderr = saved
        print(text.replace(__file__, "FILE"), end="")
        print("----")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shown(call, *args):')

try:
    def display(function, *args):
        try:
            function(*args)
        except BaseException as e:
            e.__traceback__ = e.__traceback__.tb_next
            shown(sys.__excepthook__, type(e), e, e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def display(function, *args):')

# Carets
try:
    def binary(a, b): return a + b * (a / b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def binary(a, b): return a + b * (a / b)')
try:
    def attribute(x): return x.real.imag.nothing.more
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attribute(x): return x.real.imag.nothing.more')
try:
    def subscript(d): return d["a"]["b"]["c"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def subscript(d): return d["a"]["b"]["c"]')
try:
    def call(f): return f(1)(2)(
        3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call(f): return f(1)(2)(')
try:
    def multiline(a, b):
        return (a +
                b /
                0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def multiline(a, b):')
try:
    def unicode_before(d): return "äöü" + d["ключ"]["значение"] + "ß"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unicode_before(d): return "äöü" + d["ключ"]["значение"] + "ß"')
try:
    def wide(d): return "ｗｉｄｅ" + d["ｋ"]["ｖ"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wide(d): return "ｗｉｄｅ" + d["ｋ"]["ｖ"]')
try:
    def whole_line(): raise ValueError("all of it")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def whole_line(): raise ValueError("all of it")')
try: display(binary, 1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(binary, 1, 0)')
try: display(attribute, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(attribute, 1)')
try: display(subscript, {"a": {"b": None}})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(subscript, {"a": {"b": None}})')
try: display(call, lambda x: lambda y: None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(call, lambda x: lambda y: None)')
try: display(multiline, 1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(multiline, 1, 2)')
try: display(unicode_before, {"ключ": {}})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(unicode_before, {"ключ": {}})')
try: display(wide, {"ｋ": {}})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(wide, {"ｋ": {}})')
try: display(whole_line)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(whole_line)')

# Suggestions
try:
    class Thing:
        def __init__(self): self.colour = 1; self._hidden = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Thing:')
try:
    def wrong_attribute(): Thing().color
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrong_attribute(): Thing().color')
try:
    def wrong_name():
        something = 1
        return somethin
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrong_name():')
try:
    def wrong_import(): from sys import exi
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrong_import(): from sys import exi')
try:
    def missing_self():
        class C:
            def __init__(self): self.value = 1
            def m(self): return value
        C().m()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def missing_self():')
try:
    def stdlib_name(): return itertools.count()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stdlib_name(): return itertools.count()')
try:
    def wrong_method(): [].add(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrong_method(): [].add(1)')
try: display(wrong_attribute)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(wrong_attribute)')
try: display(wrong_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(wrong_name)')
try: display(wrong_import)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(wrong_import)')
try: display(missing_self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(missing_self)')
try: display(stdlib_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(stdlib_name)')
try: display(wrong_method)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(wrong_method)')

# Chains, notes, groups
try:
    def chained():
        try:
            1 / 0
        except ZeroDivisionError as e:
            raise ValueError("second") from e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chained():')
try:
    def in_context():
        try:
            {}["k"]
        except KeyError:
            raise TypeError("while handling")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_context():')
try:
    def suppressed():
        try:
            {}["k"]
        except KeyError:
            raise TypeError("alone") from None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def suppressed():')
try:
    def noted():
        e = RuntimeError("with notes")
        e.add_note("first note")
        e.add_note("second\nover two lines")
        raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def noted():')
try:
    def group():
        def fail(n): raise ValueError(n)
        errors = []
        for n in range(2):
            try: fail(n)
            except ValueError as e: errors.append(e)
        inner = ExceptionGroup("inner", [TypeError("t"), errors[1]])
        inner.add_note("a note on the inner group")
        raise ExceptionGroup("outer", [errors[0], inner, KeyError("k")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def group():')
try:
    def recursion(n=0): return recursion(n + 1) if n < 30 else 1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def recursion(n=0): return recursion(n + 1) if n < 30 else 1 / 0')
try: display(chained)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(chained)')
try: display(in_context)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(in_context)')
try: display(suppressed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(suppressed)')
try: display(noted)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(noted)')
try: display(group)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(group)')
try: display(recursion)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(recursion)')

# Syntax errors
try:
    for source in ["x = (1,\n     2 3)\n", "def f(:\n  pass\n", "if x\n  y\n", "  indented\n", "f(a for a in b, c)\n", "x = 'ä' 'ö' +* 1\n", "whille x:\n  pass\n",
                   "a = 1\nfor x in y:\n  z\nelsee:\n  w\n", "print 'hello'\n", "'unterminated\n", "x = 1 +\n", "\tx\n        y\n", "def f():\n  x = [1, 2\n  return x\n"]:
        try: display(compile, source, "<source>", "exec")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(compile, source, "<source>", "exec")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in ["x = (1,\\n 2 3)\\n", "def f(:\\n pass\\n", "if x\\n y\\n", ...')

# Objects that misbehave
try:
    class BadStr(Exception):
        def __str__(self): raise RuntimeError("no str")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadStr(Exception):')
try:
    class NoModule(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoModule(Exception): pass')
try: NoModule.__module__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NoModule.__module__ = None')
try:
    class Qualified(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Qualified(Exception): pass')
try: Qualified.__module__ = "some.package"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Qualified.__module__ = "some.package"')
try:
    def raises(e): raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(e): raise e')
try: display(raises, BadStr())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, BadStr())')
try: display(raises, NoModule("x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, NoModule("x"))')
try: display(raises, Qualified("y"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, Qualified("y"))')
try: display(raises, KeyboardInterrupt())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, KeyboardInterrupt())')
try: display(raises, SystemExit(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, SystemExit(3))')
try: display(raises, Exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, Exception())')
try: display(raises, Exception(""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, Exception(""))')
try: display(raises, Exception("two\nlines"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, Exception("two\\nlines"))')
try: display(raises, OSError(2, "No such file", "name"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, OSError(2, "No such file", "name"))')
try: display(raises, KeyError("quoted"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, KeyError("quoted"))')
try: display(raises, UnicodeDecodeError("utf-8", b"\xff", 0, 1, "bad"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: display(raises, UnicodeDecodeError("utf-8", b"\\xff", 0, 1, "bad"))')

# Not an exception at all
try: shown(sys.__excepthook__, int, 3, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shown(sys.__excepthook__, int, 3, None)')
try: shown(sys.__excepthook__, None, None, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shown(sys.__excepthook__, None, None, None)')

# Unraisable
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try:
    class Dies:
        def __del__(self): raise ValueError("in __del__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dies:')
try: caught = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caught = []')
try: sys.unraisablehook = caught.append
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = caught.append')
try: Dies()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Dies()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: sys.unraisablehook = sys.__unraisablehook__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = sys.__unraisablehook__')
try: Args = type(caught[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Args = type(caught[0])')
try: import re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import re')
try: print('Args.__name__ =>', Args.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Args.__name__')
try: print('Args.__module__ =>', Args.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Args.__module__')
try: print('caught[0].exc_type.__name__ =>', caught[0].exc_type.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caught[0].exc_type.__name__')
try: print('caught[0].exc_value =>', caught[0].exc_value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caught[0].exc_value')
try: print('re.sub(r" at 0x[0-9a-f]+", "", caught[0].err_msg) =>', re.sub(r" at 0x[0-9a-f]+", "", caught[0].err_msg))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: re.sub(r" at 0x[0-9a-f]+", "", caught[0].err_msg)')
try: print('caught[0].object =>', caught[0].object)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caught[0].object')
try:
    def unraisable(err_msg, obj):
        try:
            1 / 0
        except ZeroDivisionError as e:
            shown(sys.__unraisablehook__, Args((type(e), e, e.__traceback__, err_msg, obj)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unraisable(err_msg, obj):')
try:
    try:
        sys.__unraisablehook__((ValueError, ValueError(), None, None, None))
    except TypeError as e:
        print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: unraisable(None, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unraisable(None, None)')
try: unraisable(None, 42)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unraisable(None, 42)')
try: unraisable("Exception ignored while doing things", None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unraisable("Exception ignored while doing things", None)')
try: unraisable("Exception ignored while doing things", "an object")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unraisable("Exception ignored while doing things", "an object")')

# A thread
try:
    def in_thread():
        def work(): raise LookupError("in a thread")
        t = threading.Thread(target=work, name="worker")
        t.start(); t.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_thread():')
try: saved, sys.stderr = sys.stderr, io.StringIO()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: saved, sys.stderr = sys.stderr, io.StringIO()')
try: in_thread()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_thread()')
try: text, sys.stderr = sys.stderr.getvalue(), saved
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text, sys.stderr = sys.stderr.getvalue(), saved')
try: print(re.sub(r'File ".*threading\.py", line \d+', 'File "threading.py", line N', text.replace(__file__, "FILE")), end="")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(re.sub(r\'File ".*threading\\.py", line \\d+\', \'File "threading.py...')

# sys.stderr is None or gone: nothing, and no failure
try: saved, sys.stderr = sys.stderr, None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: saved, sys.stderr = sys.stderr, None')
try:
    try:
        sys.__excepthook__(ValueError, ValueError("unseen"), None)
    finally:
        sys.stderr = saved
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print("done")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "done"')
