# A function that holds the bytes of an argument lets go of them however it ends: the next argument raises, is no buffer, gives
# something that is no view; a count raises; the function itself finds fault. __release_buffer__() is called with the exception pending,
# and what it raises is reported and lost.
import array, io, mmap, pickle, sys, _operator

log = []
sys.unraisablehook = lambda u: log.append(f"unraisable {type(u.exc_value).__name__}")


class Exporter:
    def __init__(self, name, data, get_raises=None, release_raises=None, gives=None):
        self.name, self.data, self.get_raises, self.release_raises, self.gives = name, data, get_raises, release_raises, gives

    def __repr__(self):
        return f"<{self.name}>"

    def __buffer__(self, flags):
        log.append(self.name + "+")
        if self.get_raises:
            raise self.get_raises
        return memoryview(self.data) if self.gives is None else self.gives

    def __release_buffer__(self, view):
        log.append(self.name + "-")
        if self.release_raises:
            raise self.release_raises


class BadIndex:
    def __index__(self):
        log.append("i")
        raise ZeroDivisionError("z")


def show(title, f):
    del log[:]
    try:
        r = repr(f())
    except BaseException as e:
        r = f"{type(e).__name__}: {e}"
    print(f"{title}: {r[:110]} [{' '.join(log)}]")


T = bytes(range(256))
two = {
    "replace": lambda s, x, y: s.replace(x, y),
    "maketrans": lambda s, x, y: bytes.maketrans(x, y)[95:100],
    "compare_digest": lambda s, x, y: _operator._compare_digest(x, y),
    "startswith": lambda s, x, y: s.startswith((x, y)),
    "join": lambda s, x, y: s.join([x, y]),
    "translate": lambda s, x, y: s.translate(x, y),
}
released = memoryview(b"abc")
released.release()
for kind in (bytes, bytearray):
    k = kind.__name__
    for name, f in two.items():
        d = bytearray(T) if name == "translate" else bytearray(b"zz")
        for e in (ValueError("v"), TypeError("t"), BufferError("b"), KeyboardInterrupt("k"), MemoryError("m")):
            show(f"{k} {name}, the second raises {type(e).__name__}", lambda: f(kind(b"abc"), Exporter("x", d), Exporter("y", b"", e)))
        show(f"{k} {name}, the second gives an int", lambda: f(kind(b"abc"), Exporter("x", d), Exporter("y", b"", gives=1)))
        show(f"{k} {name}, the second gives a released view", lambda: f(kind(b"abc"), Exporter("x", d), Exporter("y", b"", gives=released)))
        show(f"{k} {name}, the second gives a view with gaps", lambda: f(kind(b"abc"), Exporter("x", d), Exporter("y", b"", gives=memoryview(b"abcdef")[::2])))
        show(f"{k} {name}, the second is an int", lambda: f(kind(b"abc"), Exporter("x", d), 5))
        show(f"{k} {name}, both releases raise", lambda: f(kind(b"abc"), Exporter("x", d, None, ValueError("r")), Exporter("y", bytearray(b"ab"), None, KeyError("r"))))
        show(f"{k} {name}, a release raises and the second raises", lambda: f(kind(b"abc"), Exporter("x", d, None, ValueError("r")), Exporter("y", b"", OSError("o"))))
    show(f"{k} replace, the count raises", lambda: kind(b"abc").replace(Exporter("x", b"a"), Exporter("y", b"b"), BadIndex()))
    show(f"{k} replace, the count is a str", lambda: kind(b"abc").replace(Exporter("x", b"a"), Exporter("y", b"b"), "1"))
    show(f"{k} find, a bound raises", lambda: kind(b"abc").find(Exporter("x", b"a"), BadIndex()))
    show(f"{k} split, maxsplit raises", lambda: kind(b"abc").split(Exporter("x", b"a"), BadIndex()))
    show(f"{k} split, empty", lambda: kind(b"abc").split(Exporter("x", b"")))
    show(f"{k} partition, empty", lambda: kind(b"abc").partition(Exporter("x", b"")))
    show(f"{k} index, not found", lambda: kind(b"abc").index(Exporter("x", b"zz")))
    show(f"{k} startswith, TypeError", lambda: kind(b"abc").startswith(Exporter("x", b"", TypeError("mine"))))
    show(f"{k} startswith, ValueError", lambda: kind(b"abc").startswith(Exporter("x", b"", ValueError("mine"))))
    show(f"{k} startswith, TypeError in a tuple", lambda: kind(b"abc").startswith((Exporter("x", b"", TypeError("mine")),)))
    show(f"{k} startswith, an int in a tuple", lambda: kind(b"abc").startswith((Exporter("x", b"q"), 1)))
    show(f"{k} startswith, the first matches", lambda: kind(b"abc").startswith((Exporter("x", b"a"), Exporter("y", b"q"))))
    for e in (ValueError("v"), KeyboardInterrupt("k")):
        show(f"{k} ==, {type(e).__name__}", lambda: kind(b"abc") == Exporter("x", b"", e))
        show(f"{k} <, {type(e).__name__}", lambda: kind(b"abc") < Exporter("x", b"", e))
        show(f"{k} +, {type(e).__name__}", lambda: kind(b"abc") + Exporter("x", b"", e))
        show(f"{k} in, {type(e).__name__}", lambda: Exporter("x", b"", e) in kind(b"abc"))
for name, f in {
    "int": int,
    "int with a base": lambda x: int(x, 10),
    "float": float,
    "from_bytes": int.from_bytes,
    "fromhex": bytes.fromhex,
    "UnicodeDecodeError": lambda x: UnicodeDecodeError("u", x, 0, 1, "r").object,
    "compile": lambda x: compile(x, "f", "eval"),
}.items():
    show(f"{name}, raises", lambda: f(Exporter("x", b"", ValueError("v"))))
    show(f"{name}, KeyboardInterrupt", lambda: f(Exporter("x", b"", KeyboardInterrupt("k"))))
    show(f"{name}, no good", lambda: f(Exporter("x", b"1x+")))

print("-- whatever was held is free afterwards")


class Raises:
    def __init__(self, e):
        self.e = e

    def __buffer__(self, flags):
        raise self.e


class ToldArray(bytearray):
    def __release_buffer__(self, view):
        raise KeyError("told")


class ToldArrayArray(array.array):
    def __release_buffer__(self, view):
        super().__release_buffer__(view)
        raise KeyError("told")


def kinds(d):
    "What has bytes to show, and something that cannot be done while they are held."
    a = bytearray(d)
    yield "bytearray", a, lambda: a.append(1)
    b = bytearray(d)
    view = memoryview(b)
    yield "memoryview", view, lambda: (view.release(), b.append(1))
    c = array.array("B", d)
    yield "array", c, lambda: c.append(1)
    m = mmap.mmap(-1, len(d))
    m[:] = d
    yield "mmap", m, m.close
    stream = io.BytesIO(d)
    got = stream.getbuffer()
    yield "getbuffer", got, lambda: (got.release(), stream.write(b"x" * 100))
    e = bytearray(d)
    p = pickle.PickleBuffer(e)
    yield "PickleBuffer", p, lambda: (p.release(), e.append(1))
    f = ToldArray(d)
    yield "ToldArray", f, lambda: f.append(1)
    g = ToldArrayArray("B", d)
    yield "ToldArrayArray", g, lambda: g.append(1)


def exported():
    a = bytearray(b"q")
    return a, memoryview(a)


calls = {
    "replace, the second raises": lambda x: b"abc".replace(x, Raises(ValueError("v"))),
    "replace, the second is an int": lambda x: b"abc".replace(x, 1),
    "replace, the count raises": lambda x: b"abc".replace(x, x, BadIndex()),
    "replace, the count is a float": lambda x: b"abc".replace(x, x, 1.5),
    "bytearray.replace, the second raises": lambda x: bytearray(b"abc").replace(x, Raises(MemoryError())),
    "maketrans, the second raises": lambda x: bytes.maketrans(x, Raises(ValueError("v"))),
    "maketrans, lengths": lambda x: bytes.maketrans(x, b"1"),
    "translate, a short table": lambda x: b"abc".translate(x),
    "translate, delete raises": lambda x: b"abc".translate(x, Raises(ValueError("v"))),
    "compare_digest, the second raises": lambda x: _operator._compare_digest(x, Raises(ValueError("v"))),
    "compare_digest, the second is a str": lambda x: _operator._compare_digest(x, "s"),
    "index, not found": lambda x: b"abc".index(x),
    "fromhex, no good": lambda x: bytes.fromhex(x),
    "int, no good": lambda x: int(x),
    "compile, no good": lambda x: compile(x, "f", "eval").co_names,
    "startswith, the second raises": lambda x: b"abc".startswith((x, Raises(ValueError("v")))),
    "join, the second raises": lambda x: b"".join([x, Raises(ValueError("v"))]),
    "join, the second is an int": lambda x: b"".join([x, 1]),
    "bytearray.join, the second is an int": lambda x: bytearray().join((x, 1)),
    "from_bytes, the class raises": lambda x: type("I", (int,), {"__new__": lambda c, v: 1 / 0}).from_bytes(x),
    "+= to what is exported": lambda x: (lambda a, view: a.__iadd__(x))(*exported()),
    "extend() of what is exported": lambda x: (lambda a, view: a.extend(x))(*exported()),
}
for name, f in calls.items():
    for kind, x, act in kinds(T if name == "translate, delete raises" else b"zz"):
        show(f"{name}, {kind}", lambda: f(x))
        try:
            act()
        except BaseException as e:
            print(f"    NOT FREE: {type(e).__name__}: {e}")
