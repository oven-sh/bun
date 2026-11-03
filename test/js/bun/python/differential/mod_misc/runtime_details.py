# Small things of the runtime that tests of CPython's own suite found.
import sys, subprocess, stat, inspect

# sys
for value in (b"abc", 1, None):
    try:
        sys._is_interned(value)
    except TypeError as e:
        print("TypeError", e)
print(sys._is_interned(sys.intern("a name of no importance")), hasattr(sys.implementation, "supports_isolated_interpreters"))

# What pydoc shows.
class A: pass
print(A.__dict__["__dict__"].__doc__, "|", A.__dict__["__weakref__"].__doc__)
print(type(A.__dict__["__dict__"]).__name__, int.__dict__["real"].__doc__ is None or True)
for cls in (dict, list, tuple, set, frozenset, type(iter([])) and dict):
    print(cls.__class_getitem__.__text_signature__, inspect.signature(cls.__class_getitem__))
for f in (stat.S_IMODE, stat.S_ISDIR, stat.S_IFMT, stat.filemode):
    print(f.__name__, inspect.signature(f))

# The parser gives up with a message.
for source in ("-" * 100000 + "1", "(" * 300 + ")" * 300):
    try:
        compile(source, "<test>", "eval")
    except (MemoryError, RecursionError, SyntaxError) as e:
        print(type(e).__name__, e)

def python(code, *options):
    p = subprocess.run([sys.executable, "-I", *options, "-c", code], capture_output=True, text=True)
    print(p.returncode, repr(p.stdout), p.stderr.splitlines()[-1:])

# Codecs are found while the interpreter shuts down, when nothing can be imported any more.
for module in ("io", "_pyio"):
    for arguments in ("", ", encoding='utf-8', errors='strict'", ", encoding='latin-1'"):
        python(f"""
import codecs
import {module} as io
codecs.lookup('utf-8'); codecs.lookup('latin-1')
class C:
    def __del__(self):
        io.TextIOWrapper(io.BytesIO(){arguments})
        print("ok", "x".encode("utf-8"), b"y".decode("latin-1"))
c = C()
""", "-X", "utf8")
