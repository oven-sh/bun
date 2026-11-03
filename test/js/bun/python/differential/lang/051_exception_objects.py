def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

e = Exception(); print(repr(e), str(e), e.args, bool(e), type(e), e.__dict__, e.__traceback__, e.__cause__, e.__context__, e.__suppress_context__)
for args in ((), (1,), ("a",), ("a", "b"), (None,), ((1, 2),), ([1],), ("",), (1.5,), ("é",), (b"b",), ("a'b",), ("line\nbreak",)):
    x = Exception(*args); print(repr(x), "|", str(x), "|", x.args)
print(repr(ValueError("x")), str(ValueError("x")), repr(KeyError("k")), str(KeyError("k")), str(KeyError()), str(KeyError("a", "b")), str(KeyError(1)), str(KeyError(None)), str(KeyError("")), str(KeyError((1, 2))), repr(KeyError((1, 2))), str(IndexError("i")), str(KeyError("it's")), str(KeyError('q"q')))
e = ValueError("a"); e.args = (1, 2); print(e, repr(e)); e.args = "xy"; print(e.args); e.args = [3]; print(e.args, e); e.args = (); print(repr(e), str(e) == "")
def s1(): e.args = 1
def s2(): del e.args
def s3(): e.args = None
t(s1); t(s2); t(s3)
e.custom = 5; print(e.custom, e.__dict__); t(lambda: e.nope)
print(Exception("a") == Exception("a"), Exception("a") != Exception("a"), (x := Exception("a")) == x, isinstance(hash(x), int), {x: 1}[x])
t(lambda: Exception(a=1)); t(lambda: ValueError(x=1)); t(lambda: BaseException(k=1)); t(lambda: KeyError(k=1))
# The hierarchy.
def bases(c): return [k.__name__ for k in c.__mro__]
for c in (BaseException, Exception, ArithmeticError, ZeroDivisionError, OverflowError, FloatingPointError, LookupError, KeyError, IndexError, ValueError, UnicodeError, UnicodeDecodeError, UnicodeEncodeError, UnicodeTranslateError, TypeError, NameError, UnboundLocalError, AttributeError, OSError, FileNotFoundError, PermissionError, TimeoutError, ConnectionError, BrokenPipeError, ConnectionResetError, BlockingIOError, IsADirectoryError, RuntimeError, NotImplementedError, RecursionError, PythonFinalizationError, StopIteration, StopAsyncIteration, GeneratorExit, KeyboardInterrupt, SystemExit, ImportError, ModuleNotFoundError, ImportCycleError, SyntaxError, IndentationError, TabError, AssertionError, EOFError, MemoryError, BufferError, ReferenceError, SystemError, Warning, UserWarning, DeprecationWarning, PendingDeprecationWarning, SyntaxWarning, RuntimeWarning, FutureWarning, ImportWarning, UnicodeWarning, BytesWarning, ResourceWarning, EncodingWarning, BaseExceptionGroup, ExceptionGroup):
    print(bases(c)[:-1], c.__module__, repr(c))
print(IOError is OSError, EnvironmentError is OSError, sorted(c.__name__ for c in Exception.__subclasses__() if c.__module__ == "builtins"), sorted(c.__name__ for c in BaseException.__subclasses__()), sorted(c.__name__ for c in OSError.__subclasses__() if c.__module__ == "builtins"))
# StopIteration, SystemExit, and others with attributes.
print(StopIteration().value, StopIteration(1).value, StopIteration(1, 2).value, StopIteration((1, 2)).value, repr(StopIteration(1)), str(StopIteration(1)), StopAsyncIteration(1).args, hasattr(StopAsyncIteration(1), "value"))
s = StopIteration(1); s.value = 5; print(s.value, s.args)
print(SystemExit().code, SystemExit(1).code, SystemExit("m").code, SystemExit(1, 2).code, SystemExit(None).code, repr(SystemExit(2)), str(SystemExit(2)), str(SystemExit()))
n = NameError("msg", name="nm"); print(n, n.name, n.args, NameError("m").name, NameError().name, repr(n)); t(lambda: NameError("m", nope=1)); t(lambda: NameError("m", obj=1))
try: undefined_thing
except NameError as ne: print(ne.name, ne.args)
try:
    def ub():
        loc; loc = 1
    ub()
except UnboundLocalError as ue: print(ue.name, ue.args, isinstance(ue, NameError))
i = ImportError("msg", name="nm", path="pth"); print(i, i.name, i.path, i.msg, i.args, i.name_from, ImportError().msg, ImportError("a", "b").msg, ImportError("a", "b").args, repr(i), ImportError("m", name_from="nf").name_from, str(ImportError()), str(ImportError("a", "b")), ModuleNotFoundError("m", name="n").name); t(lambda: ImportError("m", nope=1))
try: import does_not_exist_module
except ImportError as ie: print(type(ie).__name__, ie, ie.name, ie.path, ie.msg)
try: from sys import does_not_exist_name
except ImportError as ie: print(type(ie).__name__, ie, ie.name, ie.name_from)
# OSError
o = OSError(); print(repr(o), str(o), o.args, o.errno, o.strerror, o.filename, o.filename2)
o = OSError("only message"); print(repr(o), str(o), o.args, o.errno, o.strerror, o.filename)
o = OSError(2, "No such file"); print(repr(o), str(o), o.args, o.errno, o.strerror, o.filename, type(o).__name__)
o = OSError(2, "No such file", "f.txt"); print(repr(o), str(o), o.args, o.errno, o.strerror, o.filename, o.filename2, type(o).__name__)
o = OSError(2, "msg", "a", None, "b"); print(repr(o), str(o), o.args, o.filename, o.filename2)
o = OSError(1, 2, 3, 4, 5, 6); print(repr(o), str(o), o.args, o.errno, o.filename, type(o).__name__)
o = OSError("a", "b"); print(repr(o), str(o), o.errno, o.strerror, type(o).__name__)
o = OSError(2, "m", b"bytes.txt"); print(str(o)); o = OSError(2, "m", 5); print(str(o)); o = OSError(None, None); print(str(o), o.errno); o = OSError(2, None, "f"); print(str(o))
for num, name in ((1, "EPERM"), (2, "ENOENT"), (3, "ESRCH"), (4, "EINTR"), (10, "ECHILD"), (11, "EAGAIN"), (13, "EACCES"), (17, "EEXIST"), (20, "ENOTDIR"), (21, "EISDIR"), (32, "EPIPE"), (103, "ECONNABORTED"), (104, "ECONNRESET"), (110, "ETIMEDOUT"), (111, "ECONNREFUSED"), (114, "EALREADY"), (115, "EINPROGRESS"), (5, "EIO"), (22, "EINVAL"), (28, "ENOSPC"), (0, "zero"), (-1, "neg"), (99999, "big")):
    print(name, type(OSError(num, "x")).__name__, end="; ")
print()
print(type(FileNotFoundError(13, "x")).__name__, type(ConnectionError(32, "x")).__name__, FileNotFoundError("just msg").errno, FileNotFoundError(2, "m", "f").filename, repr(FileNotFoundError(2, "m")), str(PermissionError(13, "Permission denied", "/x")), BlockingIOError(11, "m", 5).characters_written, isinstance(OSError(2, "x"), FileNotFoundError), OSError(2, "x").__class__.__mro__[1].__name__)
t(lambda: BlockingIOError(11, "m").characters_written); t(lambda: OSError(2, "x").characters_written); t(lambda: OSError(a=1))
class MyOS(OSError): pass
class MyOSInit(OSError):
    def __init__(self, a): self.a = a
class MyOSNew(OSError):
    def __new__(cls, a): return super().__new__(cls)
print(type(MyOS(2, "x")).__name__, MyOS(2, "x").errno, MyOS(2, "x", "f").filename, str(MyOS(2, "x", "f")), MyOSInit("q").a, MyOSInit("q").args, MyOSInit("q").errno, MyOSNew("q").args, MyOSNew("q").errno)
o = OSError(2, "m", "f"); o.errno = 5; o.strerror = "changed"; o.filename = "g"; print(str(o), o.args); del o.filename; print(str(o), o.filename)
# SyntaxError
s = SyntaxError(); print(repr(s), str(s), s.msg, s.filename, s.lineno, s.offset, s.text, s.end_lineno, s.end_offset, s.print_file_and_line, s.args)
s = SyntaxError("m"); print(repr(s), str(s), s.msg, s.lineno)
s = SyntaxError("m", ("f.py", 3, 5, "text\n")); print(repr(s), str(s), s.msg, s.filename, s.lineno, s.offset, s.text, s.end_lineno, s.end_offset, s.args)
s = SyntaxError("m", ("f.py", 3, 5, "text", 4, 9)); print(str(s), s.end_lineno, s.end_offset)
s = SyntaxError("m", ("dir/f.py", 3, None, None)); print(str(s)); s = SyntaxError("m", (None, 3, 1, "t")); print(str(s)); s = SyntaxError("m", ("f.py", None, 1, "t")); print(str(s)); s = SyntaxError("m", (None, None, None, None)); print(str(s)); s = SyntaxError(5, ("f", 1, 1, "t")); print(str(s), s.msg); s = SyntaxError("m", ["f", 1, 1, "t"]); print(s.filename)
t(lambda: SyntaxError("m", ("f", 1))); t(lambda: SyntaxError("m", ("f", 1, 2, 3, 4))); t(lambda: SyntaxError("m", 5)); t(lambda: SyntaxError("m", ("f", 1, 2, 3, 4, 5, 6, 7))); t(lambda: SyntaxError("m", "abcd").filename); t(lambda: SyntaxError("m", ("f", 1, 1, "t"), "extra").args)
for src, mode in (("x = ", "exec"), ("1 +", "eval"), ("def f(:\n  pass", "exec"), ("if x\n  pass", "exec"), ("  x = 1", "exec"), ("if 1:\nx = 1", "exec"), ("if 1:\n  x = 1\n y = 2", "exec"), ("if 1:\n\tx = 1\n        y = 2", "exec"), ("x = (1,\n2", "exec"), ("x = 'abc", "exec"), ("a b", "exec"), ("x = 1 +* 2", "exec"), ("print 'hi'", "exec"), ("é = $", "exec"), ("x = [1, 2\ny = 3", "exec"), ("f(a=1, a=2)", "eval"), ("return", "exec"), ("x = 5 = y", "exec"), ("\n\n  \n x", "exec"), ("a = 1\nb = )", "exec"), ("'é' 😀", "exec"), ("x = '''a\nb", "exec"), ("1 = x", "exec"), ("for x in y: pass\nelse x", "exec"), ("0777", "eval"), ("1__0", "eval"), ("1.e", "eval"), ("0x", "eval"), ("1_", "eval"), ("0b2", "eval"), ("1a", "eval"), ("1 if 2", "eval"), ("lambda", "eval"), ("x = {1: 2, 3}", "exec"), ("x = {1, 2: 3}", "exec"), ("del f()", "exec"), ("import a.b as c.d", "exec"), ("from . import", "exec"), ("from a import (b, c", "exec"), ("from a import *, b", "exec"), ("a; ; b", "exec"), ("\\", "exec"), ("a \\ b", "exec"), ("x = 1 \\", "exec")):
    try: compile(src, "file.py", mode); print("ok", repr(src))
    except SyntaxError as e: print(type(e).__name__, "|", e.msg, "|", e.lineno, e.offset, e.end_lineno, e.end_offset, repr(e.text), e.filename)
# UnicodeError family
u = UnicodeDecodeError("utf-8", b"a\xffb", 1, 2, "invalid start byte"); print(repr(u), "|", str(u), "|", u.encoding, u.object, u.start, u.end, u.reason, u.args)
u = UnicodeDecodeError("utf-8", b"a\xff\xfeb", 1, 3, "r"); print(str(u)); u.start = 0; u.end = 1; u.reason = "changed"; print(str(u)); u = UnicodeDecodeError("x", bytearray(b"ab"), 0, 1, "r"); print(type(u.object).__name__, str(u))
u = UnicodeEncodeError("ascii", "aéb", 1, 2, "ordinal not in range(128)"); print(repr(u), "|", str(u), "|", u.encoding, u.object, u.start, u.end, u.reason)
print(str(UnicodeEncodeError("ascii", "a€b", 1, 2, "r")), "|", str(UnicodeEncodeError("ascii", "a😀b", 1, 2, "r")), "|", str(UnicodeEncodeError("ascii", "aéèb", 1, 3, "r")), "|", str(UnicodeEncodeError("ascii", "ab", 0, 1, "r")), "|", str(UnicodeEncodeError("ascii", "", 0, 1, "r")), "|", str(UnicodeEncodeError("ascii", "ab", 5, 6, "r")), "|", str(UnicodeEncodeError("ascii", "ab", -1, 0, "r")))
u = UnicodeTranslateError("aéb", 1, 2, "reason"); print(repr(u), "|", str(u), "|", u.object, u.start, u.end, u.reason, hasattr(u, "encoding") and u.encoding)
t(lambda: UnicodeDecodeError()); t(lambda: UnicodeDecodeError("a", "str", 0, 1, "r")); t(lambda: UnicodeDecodeError(1, b"", 0, 1, "r")); t(lambda: UnicodeDecodeError("a", b"", "0", 1, "r")); t(lambda: UnicodeEncodeError("a", b"bytes", 0, 1, "r")); t(lambda: UnicodeEncodeError("a", "s", 0, 1)); t(lambda: UnicodeTranslateError("s", 0, 1)); t(lambda: UnicodeDecodeError("a", b"", 0, 1, 5)); print(repr(UnicodeError("plain")), UnicodeError().args)
# add_note
n = ValueError("v"); print(hasattr(n, "__notes__")); n.add_note("note 1"); n.add_note("note 2"); print(n.__notes__, str(n), repr(n), n.args); t(lambda: n.add_note(1)); t(lambda: n.add_note()); t(lambda: n.add_note(None)); n.__notes__ = "not a list"; t(lambda: n.add_note("x")); del n.__notes__; n.add_note("fresh"); print(n.__notes__, "__notes__" in n.__dict__)
# Custom exceptions.
class MyErr(Exception): pass
class WithFields(Exception):
    def __init__(self, code, msg): super().__init__(msg); self.code = code
class WithStr(Exception):
    def __str__(self): return "custom str " + repr(self.args)
class NoSuper(Exception):
    def __init__(self, a, b): self.a = a
class WithRepr(ValueError):
    def __repr__(self): return "WithRepr!"
class Multi(KeyError, AttributeError): pass
print(repr(MyErr()), repr(MyErr("m")), str(MyErr("m", 1)), MyErr.__mro__[1].__name__, repr(WithFields(5, "m")), str(WithFields(5, "m")), WithFields(5, "m").code, WithFields(5, "m").args, str(WithStr(1)), repr(WithStr(1)), NoSuper(1, 2).args, str(NoSuper(1, 2)), repr(NoSuper(1, 2)), repr(WithRepr("x")), str(WithRepr("x")), [WithRepr()], str(Multi("k")), isinstance(Multi(), LookupError), Multi.__mro__[1:4])
for exc, handlers in ((MyErr("a"), (ValueError, MyErr)), (Multi("m"), (AttributeError,)), (WithRepr(), (ValueError,)), (MyErr(), (Exception,)), (KeyboardInterrupt(), (Exception, BaseException))):
    for h in handlers:
        try:
            try: raise exc
            except h as c: print(type(exc).__name__, "caught by", h.__name__, end="; "); break
        except BaseException: print(type(exc).__name__, "not caught by", h.__name__, end="; ")
print()
t(lambda: WithFields(1)); t(lambda: NoSuper()); t(lambda: type("X", (Exception, int), {})); t(lambda: type("X", (ValueError, OSError), {}).__name__); t(lambda: type("X", (OSError, SyntaxError), {})); t(lambda: type("X", (KeyError, IndexError), {})("a").args)
print(BaseException.__new__(ValueError, 1, 2).args, Exception.__new__(KeyError).args, ValueError.__init__(v := ValueError(1), 2, 3), v.args, BaseException.__str__(KeyError("k")), BaseException.__repr__(KeyError("k")), ValueError("a").__reduce__(), WithFields(1, "m").__reduce__()[1], OSError(2, "m", "f").__reduce__()[1], (w := ValueError("s")).__setstate__({"z": 1}), w.z, KeyError("k").__reduce__()[0].__name__)
