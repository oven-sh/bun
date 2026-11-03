# What the interpreter prints for an exception nobody caught: sys.__excepthook__, sys.__unraisablehook__, threading.excepthook.
import io, sys, threading

def shown(call, *args):
    saved, sys.stderr = sys.stderr, io.StringIO()
    try:
        call(*args)
        text = sys.stderr.getvalue()
    finally:
        sys.stderr = saved
    print(text.replace(__file__, "FILE"), end="")
    print("----")

def display(function, *args):
    try:
        function(*args)
    except BaseException as e:
        e.__traceback__ = e.__traceback__.tb_next
        shown(sys.__excepthook__, type(e), e, e.__traceback__)

# Carets
def binary(a, b): return a + b * (a / b)
def attribute(x): return x.real.imag.nothing.more
def subscript(d): return d["a"]["b"]["c"]
def call(f): return f(1)(2)(
    3)
def multiline(a, b):
    return (a +
            b /
            0)
def unicode_before(d): return "äöü" + d["ключ"]["значение"] + "ß"
def wide(d): return "ｗｉｄｅ" + d["ｋ"]["ｖ"]
def whole_line(): raise ValueError("all of it")
display(binary, 1, 0)
display(attribute, 1)
display(subscript, {"a": {"b": None}})
display(call, lambda x: lambda y: None)
display(multiline, 1, 2)
display(unicode_before, {"ключ": {}})
display(wide, {"ｋ": {}})
display(whole_line)

# Suggestions
class Thing:
    def __init__(self): self.colour = 1; self._hidden = 2
def wrong_attribute(): Thing().color
def wrong_name():
    something = 1
    return somethin
def wrong_import(): from sys import exi
def missing_self():
    class C:
        def __init__(self): self.value = 1
        def m(self): return value
    C().m()
def stdlib_name(): return itertools.count()
def wrong_method(): [].add(1)
display(wrong_attribute)
display(wrong_name)
display(wrong_import)
display(missing_self)
display(stdlib_name)
display(wrong_method)

# Chains, notes, groups
def chained():
    try:
        1 / 0
    except ZeroDivisionError as e:
        raise ValueError("second") from e
def in_context():
    try:
        {}["k"]
    except KeyError:
        raise TypeError("while handling")
def suppressed():
    try:
        {}["k"]
    except KeyError:
        raise TypeError("alone") from None
def noted():
    e = RuntimeError("with notes")
    e.add_note("first note")
    e.add_note("second\nover two lines")
    raise e
def group():
    def fail(n): raise ValueError(n)
    errors = []
    for n in range(2):
        try: fail(n)
        except ValueError as e: errors.append(e)
    inner = ExceptionGroup("inner", [TypeError("t"), errors[1]])
    inner.add_note("a note on the inner group")
    raise ExceptionGroup("outer", [errors[0], inner, KeyError("k")])
def recursion(n=0): return recursion(n + 1) if n < 30 else 1 / 0
display(chained)
display(in_context)
display(suppressed)
display(noted)
display(group)
display(recursion)

# Syntax errors
for source in ["x = (1,\n     2 3)\n", "def f(:\n  pass\n", "if x\n  y\n", "  indented\n", "f(a for a in b, c)\n", "x = 'ä' 'ö' +* 1\n", "whille x:\n  pass\n",
               "a = 1\nfor x in y:\n  z\nelsee:\n  w\n", "print 'hello'\n", "'unterminated\n", "x = 1 +\n", "\tx\n        y\n", "def f():\n  x = [1, 2\n  return x\n"]:
    display(compile, source, "<source>", "exec")

# Objects that misbehave
class BadStr(Exception):
    def __str__(self): raise RuntimeError("no str")
class NoModule(Exception): pass
NoModule.__module__ = None
class Qualified(Exception): pass
Qualified.__module__ = "some.package"
def raises(e): raise e
display(raises, BadStr())
display(raises, NoModule("x"))
display(raises, Qualified("y"))
display(raises, KeyboardInterrupt())
display(raises, SystemExit(3))
display(raises, Exception())
display(raises, Exception(""))
display(raises, Exception("two\nlines"))
display(raises, OSError(2, "No such file", "name"))
display(raises, KeyError("quoted"))
display(raises, UnicodeDecodeError("utf-8", b"\xff", 0, 1, "bad"))

# Not an exception at all
shown(sys.__excepthook__, int, 3, None)
shown(sys.__excepthook__, None, None, None)

# Unraisable
import gc
class Dies:
    def __del__(self): raise ValueError("in __del__")
caught = []
sys.unraisablehook = caught.append
Dies()
gc.collect()
sys.unraisablehook = sys.__unraisablehook__
Args = type(caught[0])
import re
print(Args.__name__, Args.__module__, caught[0].exc_type.__name__, caught[0].exc_value, re.sub(r" at 0x[0-9a-f]+", "", caught[0].err_msg), caught[0].object)
def unraisable(err_msg, obj):
    try:
        1 / 0
    except ZeroDivisionError as e:
        shown(sys.__unraisablehook__, Args((type(e), e, e.__traceback__, err_msg, obj)))
try:
    sys.__unraisablehook__((ValueError, ValueError(), None, None, None))
except TypeError as e:
    print(e)
unraisable(None, None)
unraisable(None, 42)
unraisable("Exception ignored while doing things", None)
unraisable("Exception ignored while doing things", "an object")

# A thread
def in_thread():
    def work(): raise LookupError("in a thread")
    t = threading.Thread(target=work, name="worker")
    t.start(); t.join()
saved, sys.stderr = sys.stderr, io.StringIO()
in_thread()
text, sys.stderr = sys.stderr.getvalue(), saved
print(re.sub(r'File ".*threading\.py", line \d+', 'File "threading.py", line N', text.replace(__file__, "FILE")), end="")

# sys.stderr is None or gone: nothing, and no failure
saved, sys.stderr = sys.stderr, None
try:
    sys.__excepthook__(ValueError, ValueError("unseen"), None)
finally:
    sys.stderr = saved
print("done")
