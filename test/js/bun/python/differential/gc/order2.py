# In what order finalizers run when a structure is dropped: as reference counts would have it.
import gc, collections, functools, types
class A:
    def __init__(self, n, **kw):
        self.n = n
        self.__dict__.update(kw)
    def __del__(self): print("  del", self.n)
class S:
    __slots__ = ("n", "a", "b", "c")
    def __init__(self, n, a=None, b=None, c=None): self.n = n; self.a = a; self.b = b; self.c = c
    def __del__(self): print("  del", self.n)
class L(list):
    def __del__(self): print("  del L")
class D(dict):
    def __del__(self): print("  del D")
class T(tuple):
    def __del__(self): print("  del T")
# A collection of the engine's own that ends between `del x` and gc.collect() would go by the order in which the objects were made. After a collection none is due for a long time.
gc.collect()
def case(name, make):
    print(name)
    x = make()
    del x
    gc.collect()
def shared():
    s = A("shared")
    return [[A(1), s], [s, A(2)]]
def closure():
    a = A("a"); b = A("b")
    def f(): return a, b
    return f
def chain(n):
    x = None
    for i in range(n): x = A(i, next=x)
    return x
def diamond():
    bottom = A("bottom")
    return A("top", left=A("left", down=bottom), right=A("right", down=bottom))
def cycle(*names):
    objects = [A(n) for n in names]
    for a, b in zip(objects, objects[1:] + objects[:1]): a.next = b
    return objects[0]
def cycle_made_backwards():
    c = A("made first"); b = A("made second", next=c); a = A("made third", next=b); c.next = a
    return a
def cycle_with_tail():
    a = A("in cycle 1"); b = A("in cycle 2", next=a); a.next = b
    a.tail = A("tail 1", next=A("tail 2"))
    return a
def plain_cycle_above():
    l = [A("below a plain cycle 1"), A("below a plain cycle 2")]
    l.append(l)
    return l
def owner_above_cycle():
    a = A("in cycle 1"); b = A("in cycle 2", next=a); a.next = b
    return A("owner", cycle=a)
def traceback_frames():
    def inner():
        x = A("local of inner"); raise ValueError
    def outer():
        y = A("local of outer"); inner()
    try: outer()
    except ValueError as e: return e
def several_locals():
    def f():
        a = A("first local"); b = A("second local"); c = A("third local"); raise ValueError
    try: f()
    except ValueError as e: return e
def generator_locals():
    def g():
        a = A("first local"); b = A("second local")
        yield
    it = g(); next(it); return it
case("list", lambda: [A(1), A(2), A(3)])
case("tuple", lambda: (A(1), A(2), A(3)))
case("dict values", lambda: {"a": A(1), "b": A(2), "c": A(3)})
case("dict keys and values", lambda: {A(1): A(2), A(3): A(4)})
case("nested", lambda: [A(1), [A(2), (A(3), A(4))], {"k": A(5)}, A(6)])
case("attributes", lambda: A("owner", x=A("x"), y=A("y"), z=A("z")))
case("slots", lambda: S("owner", S("a"), S("b"), S("c")))
case("deque", lambda: collections.deque([A(1), A(2), A(3)]))
case("list subclass", lambda: L([A(1), A(2)]))
case("dict subclass", lambda: D(a=A(1), b=A(2)))
case("tuple subclass", lambda: T([A(1), A(2)]))
case("namespace", lambda: types.SimpleNamespace(a=A(1), b=A(2)))
case("partial", lambda: functools.partial(print, A(1), A(2), k=A(3)))
case("closure", closure)
case("defaults", lambda: (lambda a=A(1), b=A(2), *, c=A(3): None))
case("shared", shared)
case("diamond", diamond)
case("chain of 3", lambda: chain(3))
case("chain of 8", lambda: chain(8))
case("cycle", lambda: cycle(1, 2, 3))
case("cycle made backwards", cycle_made_backwards)
case("cycle with a tail", cycle_with_tail)
case("plain cycle above", plain_cycle_above)
case("owner above a cycle", owner_above_cycle)
case("frames of a traceback", traceback_frames)
case("locals of a frame", several_locals)
case("locals of a generator", generator_locals)
case("two roots", lambda: None)
a = [A("root 1")]; b = [A("root 2")]
del a, b
gc.collect()
