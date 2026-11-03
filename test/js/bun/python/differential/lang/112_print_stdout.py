import sys
def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print()
print("")
print("a")
print("a", "b")
print("a", "b", sep="")
print("a", "b", sep="-")
print("a", "b", sep="\n")
print("a", "b", sep=None)
print("a", end="")
print("b", end="!\n")
print("c", end=None)
print("a", "b", sep=", ", end=".\n")
print(sep="x")
print(end="only end\n")
print(sep="x", end="y\n")
print("one", sep="ignored with a single argument")
print(1, 2.5, None, True, [1, "a"], (1,), {"k": "v"}, {1}, 1j, b"b", ..., int, range(2))
print("é", "€", "😀", "é", "a\tb", "a\\b", "quote'", 'dq"')
print("multi\nline", "second")
print("", "", "")
print("", sep="x")
print(*[1, 2, 3])
print(*[1, 2, 3], sep="")
print(*"abc", sep="|")
print(*[], sep="x")
print(*range(3), *"ab", sep=",")
print(print("inner"))
print("a" "b", "c" * 3)
print(("tuple",))
print([print("in list")])
print("sep with unicode", "x", sep="→")
print("long sep", "x", sep=" <=====> ")
print("nul\0char".replace("\0", "<NUL>"))
print("trailing space ", end=" \n")
print("\r\n".encode(), "cr lf kept as is")
class S:
    def __str__(s): return "S.__str__"
    def __repr__(s): return "S.__repr__"
print(S(), [S()], (S(),), {S(): S()} and "dict", str(S()), repr(S()))
class R:
    def __repr__(s): return "R.__repr__"
print(R(), [R()])
class SS(str):
    def __str__(s): return "overridden __str__"
print(SS("raw"), [SS("raw")], SS("raw") + "", f"{SS('raw')}", "%s" % SS("raw"), "{}".format(SS("raw")), str(SS("raw")))
class IS(int):
    def __str__(s): return "int subclass str"
    def __repr__(s): return "int subclass repr"
print(IS(5), [IS(5)], "%s %r %d" % (IS(5), IS(5), IS(5)))
t(lambda: print("a", sep=1)); t(lambda: print("a", end=1)); t(lambda: print("a", sep=b"x")); t(lambda: print("a", nope=1)); t(lambda: print("a", file=1)); t(lambda: print("a", file="s")); t(lambda: print("a", sep=["x"])); t(lambda: print("a", end=b"\n")); t(lambda: print("a", file=object())); t(lambda: print(file=5))
class BadStr:
    def __str__(s): raise ValueError("str failed")
def partial(): print("printed before the failure", BadStr(), "never")
t(partial)
# file=
class W:
    def __init__(s): s.parts = []
    def write(s, x): s.parts.append(x); return len(x)
w = W(); print("a", "b", file=w); print(w.parts)
w = W(); print(file=w); print(w.parts)
w = W(); print("a", 1, None, sep="-", end="", file=w); print(w.parts)
w = W(); print("a", "", "b", sep="", end="", file=w); print(w.parts)
w = W(); print(1, 2, sep=None, end=None, file=w); print(w.parts)
w = W(); print(SS("x"), IS(1), file=w); print(w.parts, [type(p).__name__ for p in w.parts])
w = W(); print("a", file=w, flush=True) if False else None
class WF(W):
    def flush(s): s.parts.append("<flush>")
w = WF(); print("a", file=w); print("b", file=w, flush=True); print("c", file=w, flush=False); print("d", file=w, flush=1); print("e", file=w, flush=""); print(w.parts)
t(lambda: print("a", file=W(), flush=True))
class WR:
    def write(s, x): raise OSError("write failed")
t(lambda: print("a", file=WR()))
print("file=None means sys.stdout", file=None)
print("to stdout explicitly", file=sys.stdout)
print("to stderr: not compared", file=sys.stderr)
# Replacing sys.stdout.
old = sys.stdout
w = W(); sys.stdout = w
print("captured", 1)
sys.stdout = old
print(w.parts)
sys.stdout = None
print("silently dropped when sys.stdout is None")
sys.stdout = old
print("restored")
del sys.stdout
try: print("no sys.stdout")
except RuntimeError as e: err = e
sys.stdout = old
print(type(err).__name__, err)
print(sys.__stdout__ is old, sys.stdout is sys.__stdout__)
# sys.stdout methods.
print(sys.stdout.write("written\n"), sys.stdout.write(""), sys.stdout.write("é😀\n"), sys.stdout.write("a\nb\n"))
sys.stdout.writelines(["l1\n", "l2\n"]); sys.stdout.writelines(("t",)); sys.stdout.writelines(c for c in "g\n"); sys.stdout.writelines([])
print(sys.stdout.flush(), sys.stdout.writable(), sys.stdout.readable(), sys.stdout.seekable() in (True, False), sys.stdout.closed, sys.stdout.fileno(), sys.stdout.name, sys.stdout.mode, sys.stdout.encoding, sys.stdout.errors, sys.stdout.isatty(), type(sys.stdout).__name__, type(sys.stdout.buffer).__name__, sys.stderr.fileno(), sys.stderr.name, sys.stderr.errors, sys.stdin.fileno(), sys.stdin.name, sys.stdin.mode, sys.stdout.newlines, sys.stdout.line_buffering, sys.stdout.write_through)
t(lambda: sys.stdout.write(1)); t(lambda: sys.stdout.write(b"bytes")); t(lambda: sys.stdout.write(None)); t(lambda: sys.stdout.write()); t(lambda: sys.stdout.write("a", "b")); t(lambda: sys.stdout.writelines([1])); t(lambda: sys.stdout.writelines(1)); t(lambda: sys.stdout.read()); t(lambda: sys.stdout.nope)
# Text and binary layers keep their order when flushed.
sys.stdout.write("text 1\n"); sys.stdout.flush(); sys.stdout.buffer.write(b"binary 1\n"); sys.stdout.buffer.flush(); sys.stdout.write("text 2\n"); sys.stdout.flush()
print(sys.stdout.buffer.write(b"\xc3\xa9\n"), end=""); sys.stdout.flush(); print()
t(lambda: sys.stdout.buffer.write("str"))
# Lone surrogates cannot be encoded to UTF-8 with the strict handler.
t(lambda: print("\ud800"))
print("after the failed print")
t(lambda: sys.stdout.write("ok then \udfff\n"))
print()
print("surrogates via repr:", repr("\ud800"), ascii("\ud800"))
# stdin is /dev/null.
print(repr(sys.stdin.read()), repr(sys.stdin.readline()), list(sys.stdin), sys.stdin.readable(), sys.stdin.writable())
t(lambda: input()); t(lambda: input("prompt> "))
print()
# Large outputs.
print("x" * 10000)
print(*range(2000))
for i in range(300): print(i, end=" ")
print()
sys.stdout.write("".join("%d\n" % i for i in range(200)))
print("no newline at the very end", end="")
