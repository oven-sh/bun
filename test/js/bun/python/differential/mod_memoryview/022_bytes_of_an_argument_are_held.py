# A function that reads the bytes of an argument holds them until it is through, whatever runs meanwhile: the __buffer__() of the
# next argument, an __index__(), the __release_buffer__() of the argument itself.
import array, mmap, re, pickle, _operator

log = []


class Exporter:
    "Written in Python, of the memory of `data`."

    def __init__(self, name, data, on_get=None, on_release=None):
        self.name, self.data, self.on_get, self.on_release = name, data, on_get, on_release

    def __repr__(self):
        return f"<{self.name}>"

    def __buffer__(self, flags):
        log.append(self.name + "+")
        if self.on_get:
            self.on_get()
        return memoryview(self.data)

    def __release_buffer__(self, view):
        log.append(self.name + "-")
        view.release()
        if self.on_release:
            self.on_release()


class Index:
    def __init__(self, value, act):
        self.value, self.act = value, act

    def __index__(self):
        log.append("i")
        self.act()
        return self.value


def tried(act):
    "What the attempt raises is noted, and the call goes on."

    def run():
        try:
            act()
        except BaseException as e:
            log.append(type(e).__name__)
        else:
            log.append("done")

    return run


def show(title, f):
    del log[:]
    try:
        r = repr(f())
    except BaseException as e:
        r = f"{type(e).__name__}: {e}"
    print(f"{title}: {r[:100]} [{' '.join(log)}]")


def iadd(s, x):
    s += x
    return s


class File:
    def __init__(self, data):
        self.data = data

    def read(self, n):
        return self.data

    def readline(self):
        return self.data


one = {
    "find": lambda s, x: s.find(x),
    "rfind": lambda s, x: s.rfind(x),
    "index": lambda s, x: s.index(x),
    "rindex": lambda s, x: s.rindex(x),
    "count": lambda s, x: s.count(x),
    "in": lambda s, x: x in s,
    "startswith": lambda s, x: s.startswith(x),
    "endswith": lambda s, x: s.endswith(x),
    "startswith tuple": lambda s, x: s.startswith((x,)),
    "removeprefix": lambda s, x: s.removeprefix(x),
    "removesuffix": lambda s, x: s.removesuffix(x),
    "split": lambda s, x: s.split(x),
    "rsplit": lambda s, x: s.rsplit(x),
    "partition": lambda s, x: s.partition(x)[::2],
    "rpartition": lambda s, x: s.rpartition(x)[::2],
    "strip": lambda s, x: s.strip(x),
    "lstrip": lambda s, x: s.lstrip(x),
    "rstrip": lambda s, x: s.rstrip(x),
    "+": lambda s, x: s + x,
    "==": lambda s, x: s == x,
    "<": lambda s, x: s < x,
    "join": lambda s, x: s.join([x]),
    "join 2": lambda s, x: s.join([x, b"-"]),
    "translate": lambda s, x: s.translate(None, x),
}
# These make nothing of s.
functions = {
    "from_bytes": lambda s, x: int.from_bytes(x),
    "fromhex": lambda s, x: bytes.fromhex(x),
    "UnicodeDecodeError": lambda s, x: UnicodeDecodeError("u", x, 0, 1, "r").object,
    "re.sub": lambda s, x: re.sub(b"c", x, b"cc")[:8],
    "compile": lambda s, x: eval(compile(x, "f", "eval")),
    "int": lambda s, x: int(x),
    "float": lambda s, x: float(x),
    "pickle.load": lambda s, x: pickle.load(File(x)),
}
of_bytearray = {
    "+=": iadd,
    "extend": lambda s, x: (s.extend(x), s)[1],
    "[1:2] =": lambda s, x: (s.__setitem__(slice(1, 2), x), s)[1],
}
two = {
    "replace": lambda s, x, y: s.replace(x, y),
    "maketrans": lambda s, x, y: bytes.maketrans(x, y)[48:53],
    "compare_digest": lambda s, x, y: _operator._compare_digest(x, y),
    "startswith tuple": lambda s, x, y: s[1:].startswith((x, y)),
    "join": lambda s, x, y: s.join([x, y]),
}
S = b"12c12c 12"
T = bytes(range(256))

print("-- __release_buffer__() changes the bytes: they have been read by then")
for kind in (bytes, bytearray):
    for name, f in {**one, **(of_bytearray if kind is bytearray else functions)}.items():
        if kind is bytes and name in ("==", "<"):
            continue  # bytes are compared with bytes only
        a = bytearray(b"12")

        def change(a=a):
            a[:] = b"7890" * 100

        show(f"{kind.__name__} {name}", lambda: f(kind(S), Exporter("x", a, None, tried(change))))

print("-- the __buffer__() of the second argument tries to take away the memory of the first")
for name, f in two.items():
    a = bytearray(b"12")
    show(f"{name}, a bytearray", lambda: f(S, a, Exporter("y", bytearray(b"XY"), tried(a.clear))))
a = array.array("B", b"12")
show("replace, an array", lambda: S.replace(a, Exporter("y", bytearray(b"XY"), tried(lambda: a.extend(b"Z" * 10000)))))
a = mmap.mmap(-1, 2)
a[:] = b"12"
show("replace, an mmap", lambda: S.replace(a, Exporter("y", bytearray(b"XY"), tried(a.close))))
a = bytearray(b"12")
show("replace, an exporter", lambda: S.replace(Exporter("x", a), Exporter("y", bytearray(b"XY"), tried(a.clear))))
a = bytearray(b"12")
show("replace, the count", lambda: S.replace(a, b"XY", Index(1, tried(a.clear))))
a = bytearray(T)
show("translate, the table", lambda: S.translate(a, Exporter("y", bytearray(b"12"), tried(a.clear))))

print("-- got in the order of the arguments, and released in that order")
for kind in (bytes, bytearray):
    for name, f in two.items():
        show(f"{kind.__name__} {name}", lambda: f(kind(S), Exporter("x", bytearray(b"12")), Exporter("y", bytearray(b"XY"))))
    show(f"{kind.__name__} translate", lambda: kind(S).translate(Exporter("x", bytearray(T)), Exporter("y", bytearray(b"12"))))
    show(f"{kind.__name__} translate, a short table", lambda: kind(S).translate(Exporter("x", bytearray(b"12")), Exporter("y", bytearray(b"12"))))

print("-- a bytearray whose method it is, while the argument is asked")
for name in ("find", "in", "split", "partition", "strip", "removeprefix", "+", "==", "<", "join", "+=", "extend"):
    f = {**one, **of_bytearray}[name]
    s = bytearray(S)
    show(f"{name}, __buffer__() clears it", lambda: (f(s, Exporter("x", bytearray(b"12"), tried(s.clear))), s))
for name in ("find", "count", "in", "split", "partition", "rpartition", "removeprefix", "+", "==", "<", "join", "+=", "extend"):
    f = {**one, **of_bytearray}[name]
    s = bytearray(S)
    show(f"{name}, __release_buffer__() clears it", lambda: (f(s, Exporter("x", bytearray(b"12"), None, tried(s.clear))), s))

print("-- a bytearray as its own argument")
for name, f in {**one, **of_bytearray}.items():
    s = bytearray(S)
    show(name, lambda: f(s, s))
for name, f in of_bytearray.items():
    s = bytearray(S)
    show(f"{name}, a view of it", lambda: f(s, memoryview(s)))
    s = bytearray(S)
    show(f"{name}, an empty view of it", lambda: f(s, memoryview(s)[:0]))
    s = bytearray(S)
    show(f"{name}, an exporter of it", lambda: f(s, Exporter("x", s)))

print("-- no longer held when the function calls something else")


class Int(int):
    def __new__(cls, value):
        log.append("new")
        tried(A.clear)()
        return int.__new__(cls, value)


A = bytearray(b"12")
show("from_bytes() of a class", lambda: Int.from_bytes(A))


class Shown(bytearray):
    def __repr__(self):
        log.append("repr")
        tried(self.clear)()
        return "Shown"


show("float()", lambda: float(Shown(b"x")))

print("-- a class derived from bytearray whose own __buffer__() makes it longer: it is not held before it has been asked")


class Grows(bytearray):
    def __buffer__(self, flags):
        log.append("s+")
        tried(lambda: self.append(0x21))()
        return super().__buffer__(flags)


for name, f in {
    "==": lambda s: s == b"12!",
    "!=": lambda s: s != b"12!",
    "<": lambda s: s < b"12!",
    ">=": lambda s: s >= b"12!",
    "reflected ==": lambda s: b"12!" == s,
    "+": lambda s: s + b"34",
    "bytes +": lambda s: b"34" + s,
    "find": lambda s: s.find(b"!"),
    "replace": lambda s: b"12!".replace(s, b"-"),
    "join": lambda s: b"".join([s, s]),
}.items():
    show(name, lambda: f(Grows(b"12")))

print("-- classes that are only told when the buffer is released")


class ToldBytes(bytes):
    def __release_buffer__(self, view):
        log.append(f"told {len(view)} {view[0]} {view.readonly}")


class ToldArray(bytearray):
    def __release_buffer__(self, view):
        log.append(f"told {len(view)} {view[0]} {view.readonly}")
        tried(self.clear)()
        super().__release_buffer__(view)


class ToldArrayArray(array.array):
    def __release_buffer__(self, view):
        log.append("told")
        super().__release_buffer__(view)


for make in (lambda: ToldBytes(b"12"), lambda: ToldArray(b"12"), lambda: ToldArrayArray("B", b"12")):
    x = make()
    show(f"{type(x).__name__} find", lambda: S.find(x))
    show(f"{type(x).__name__} replace", lambda: S.replace(x, Exporter("y", bytearray(b"XY"))))
    show(f"{type(x).__name__} +", lambda: S + x)
    show(f"{type(x).__name__} join", lambda: b"-".join([x, x]))
    show(f"{type(x).__name__} int", lambda: int(x))
    show(f"{type(x).__name__} afterwards", lambda: x if isinstance(x, bytes) else (x.append(0x33), x)[1])


# A class that is given its __release_buffer__() while the buffer is out is told all the same, as an operand and as an argument.
class LaterBytes(bytes):
    pass


class LaterArray(bytearray):
    pass


class Gives:
    def __init__(self, to):
        self.to = to

    def __buffer__(self, flags):
        self.to.__release_buffer__ = lambda self, view: log.append(f"told {len(view)}")
        return memoryview(b"o")


for Later in (LaterBytes, LaterArray):
    for title, f in (
        ("+", lambda x, y: x + y),
        ("==", lambda x, y: x == y),
        ("<", lambda x, y: x < y),
        ("replace", lambda x, y: b"xx".replace(x, y)),
        ("maketrans", lambda x, y: bytes.maketrans(x, y)[0x78:0x79]),
    ):
        show(f"{Later.__name__} {title}, given meanwhile", lambda: f(Later(b"x"), Gives(Later)))
        if "__release_buffer__" in vars(Later):
            del Later.__release_buffer__

# What looks at the bytes twice, with somebody else looking at them too.
for make in (bytearray, LaterArray):
    a = make(b"1\t2\t1")
    with memoryview(a) as view:
        show(f"{make.__name__} replace, a view is out", lambda: (a.replace(b"1", b"one"), a.replace(a[:1], b""), a.replace(view[:1], b"-"), a.replace(a, a)))
        show(f"{make.__name__} replace by a view, a view is out", lambda: b"1\t2".replace(a[:2], view))
        show(f"{make.__name__} expandtabs, a view is out", lambda: a.expandtabs(4))
        show(f"{make.__name__} translate, a view is out", lambda: (a.translate(None, b"1"), a.translate(None, view), a.translate(bytes(range(256)), b"")))
    show(f"{make.__name__} afterwards", lambda: (a.clear(), a)[1])
