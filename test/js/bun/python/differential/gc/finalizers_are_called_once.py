# An object is finalized once, however it was made, however often the runtime may have heard of it, and whichever collections it has lived through.
import copy, gc, io, os, pickle, sys, tempfile, warnings

log = []


def drain(label):
    for generation in (0, 2, 2):
        gc.collect(generation)
    print(label, sorted(log) if label.endswith("(any order)") else log)
    log.clear()


class Noisy:
    def __del__(self): log.append(f"{type(self).__name__}:{getattr(self, 'tag', '?')}")


# ---- __new__ hands out an object that exists already
class Singleton(Noisy):
    instance = None
    def __new__(cls):
        if cls.instance is None:
            cls.instance = super().__new__(cls)
            cls.instance.tag = "only"
        return cls.instance

for i in range(1000):
    Singleton()
    if i % 300 == 0: gc.collect(0)
drain("singleton, alive")
Singleton.instance = None
drain("singleton, dropped")


# ---- classes derived from built-in types, made in every way there is
class D(Noisy, dict): pass
class L(Noisy, list): pass
class S(Noisy, set): pass
class T(Noisy, tuple): pass
class I(Noisy, int): pass
class Str(Noisy, str): pass
class B(Noisy, bytes): pass
class E(Noisy, Exception): pass
class O(Noisy): pass

for cls in (D, L, S, T, I, Str, B, E, O):
    a = cls(); a.tag = "call"
    b = cls.__new__(cls); b.tag = "new"
    c = copy.copy(a); c.tag = "copy"
    d = pickle.loads(pickle.dumps(a)); d.tag = "pickle"
    e = object.__new__(cls) if cls is O else cls.__mro__[2].__new__(cls); e.tag = "base new"
    del a, b, c, d, e
    drain(cls.__name__ + " (any order)")


# ---- what a built-in type returns need not be what it made
class Gives:
    def __init__(self, value): self.value = value
    def __str__(self): return self.value
    def __int__(self): return self.value
    def __bytes__(self): return self.value

s = Str("text"); s.tag = "given"
for i in range(50): assert str(Gives(s)) is s
del s
drain("str() of an object whose __str__ returns such a str")
b = B(b"text"); b.tag = "given"
for i in range(50): bytes(Gives(b))
del b
drain("bytes() likewise")


# ---- the class changes
class Quiet: pass

o = Quiet(); o.tag = "changed"
for i in range(20):
    o.__class__ = O
    if i % 7 == 0: gc.collect(0)
    o.__class__ = Quiet
o.__class__ = O
del o
drain("__class__ set back and forth, last to the class with __del__")
o = O(); o.tag = "changed"
o.__class__ = Quiet
del o
drain("made with __del__, dropped without")


# ---- the class gets a __del__ when the objects are there
class Late: pass
objects = [Late() for i in range(5)]
for i, x in enumerate(objects): x.tag = i
gc.collect()
Late.__del__ = Noisy.__del__
del Late.__del__
Late.__del__ = Noisy.__del__
more = Late(); more.tag = "after"
del objects, x, more
drain("a __del__ given later (any order)")


# ---- brought back
kept = []
class Lazarus:
    def __del__(self): log.append("Lazarus"); kept.append(self)

x = Lazarus()
print(gc.is_finalized(x))
del x
drain("first death")
print(gc.is_finalized(kept[0]))
gc.collect(0); gc.collect()
print(gc.is_finalized(kept[0]))
kept[0].__class__ = Quiet
kept[0].__class__ = Lazarus
kept.clear()
drain("second death")


# ---- old and young together: as the list that held them lets go of them
old = [O() for i in range(4)]
for i, x in enumerate(old): x.tag = i
gc.collect()
middle = [O() for i in range(4)]
for i, x in enumerate(middle): x.tag = 4 + i
gc.collect(0)
young = [O() for i in range(4)]
for i, x in enumerate(young): x.tag = 8 + i
everything = old + middle + young
del old, middle, young, x
gc.collect()
more = O(); more.tag = 12
everything.append(more)
del more, everything
gc.collect()
drain("four ages")


# ---- a parent comes before its child, whichever is older
class Node(Noisy):
    def __init__(self, tag, child=None): self.tag = tag; self.child = child

child = Node("child")
gc.collect()
parent = Node("parent", child)
del child, parent
drain("an old child of a young parent")
holder = Node("parent")
gc.collect()
holder.child = Node("child")
del holder
drain("a young child of an old parent")


# ---- files: open, closed, open again
with tempfile.TemporaryDirectory() as directory:
    path = os.path.join(directory, "file")
    open(path, "w").close()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        f = io.FileIO(path)
        f.close()
        gc.collect(0)
        f.__init__(path)
        f.close()
        f.__init__(path)
        gc.collect()
        del f
        gc.collect()
        f = open(path)
        raw = f.buffer.raw
        del f
        gc.collect()
        print(raw.closed)
        f = open(path); f.close(); del f
        gc.collect()
    print([str(w.message).split(" name=")[0] for w in caught])

    class MyRaw(io.RawIOBase):
        def readable(self): return True
        def readinto(self, b): return 0
        def close(self):
            if not self.closed: log.append("MyRaw.close")
            super().close()
    reader = io.BufferedReader(MyRaw())
    del reader
    drain("a raw stream written in Python, wrapped")


# ---- generators: done, not begun, suspended
def generator(tag):
    try: yield 1; yield 2
    finally: log.append(tag)

done = generator("done"); list(done)
not_begun = generator("not begun")
suspended_young = generator("suspended young"); next(suspended_young)
suspended_old = generator("suspended old"); next(suspended_old)
log.clear()
gc.collect()
closed = generator("closed"); next(closed); closed.close()
del done, not_begun, suspended_old, suspended_young, closed
drain("generators (any order)")

many = [generator(i) for i in range(2000)]
for g in many: next(g)
gc.collect(0)
for g in many[::2]: g.close()
log.clear()
del many, g
for generation in (0, 2, 2): gc.collect(generation)
print(len(log), sorted(log) == list(range(1, 2000, 2)))
