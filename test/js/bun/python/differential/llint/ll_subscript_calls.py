# obj[key] where __getitem__ is written in Python: what is called with what, and what the program can see of the call while it runs.
import gc, operator, sys, traceback, weakref, functools, inspect
out = []
def rec(label, f):
    try: r = f()
    except BaseException as e: r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %r" % (label, r))
def thrice(label, f):
    for _ in range(3): rec(label, f)
def get(o, k): return o[k]

class A:
    def __getitem__(self, key): return ("A", key)
a = A()
for key in (0, -1, 2 ** 70, 1.5, 2.0, "k", None, True, (), (1, 2), slice(1, 2), Ellipsis, a.__class__, b"x", frozenset()):
    thrice("key %r" % (key,), lambda: get(a, key))
thrice("slices", lambda: (a[1:2], a[:], a[::2], a[1:2, 3], a[..., 1], a[1,], a[()], a[a[0]]))

class Callable:
    def __call__(self, *args): return ("called", len(args))
def kinds():
    yield "lambda", lambda self, key: ("lambda", key)
    yield "defaults", lambda self, key, a=1, b=2: (key, a, b)
    yield "three defaults", lambda self, key, a=1, b=2, c=3: (key, a, b, c)
    yield "star", lambda *args: len(args)
    yield "star after self", lambda self, *args: args
    yield "keywords", lambda self, key, **kw: (key, kw)
    yield "keyword only", lambda self, key, *, k=5: (key, k)
    yield "keyword only without a default", lambda self, key, *, k: k
    yield "one parameter", lambda self: 1
    yield "three parameters", lambda self, key, other: 1
    yield "a default for the key", lambda self, key=9: key
    yield "builtin", operator.add
    yield "type", type
    yield "callable object", Callable()
    yield "partial", functools.partial(lambda x, key: ("partial", x, key), 1)
    yield "partialmethod", functools.partialmethod(lambda self, x, key: ("partialmethod", x, key), 1)
    yield "none", None
    yield "not callable", 5
    yield "staticmethod", staticmethod(lambda key: ("static", key))
    yield "classmethod", classmethod(lambda cls, key: ("class", cls.__name__, key))
    yield "property", property(lambda self: lambda key: ("property", key))
    yield "of list", list.__getitem__
    def generator(self, key): yield key
    yield "generator", generator
    def deletes(self, key):
        del self, key
        return sorted(locals())
    yield "deletes", deletes
for label, method in kinds():
    K = type("K", (), {"__getitem__": method})
    k = K()
    thrice("method: " + label, lambda: (lambda r: list(r) if inspect.isgenerator(r) else r)(get(k, 7)))

# One place in the code sees objects of many kinds.
class B(A): pass
class C(A):
    def __getitem__(self, key): return ("C", key)
class L(list):
    def __getitem__(self, key): return ("L", key, list.__getitem__(self, key))
class D(dict):
    def __getitem__(self, key): return ("D", key)
class M(dict):
    def __missing__(self, key): return ("missing", key)
class T(tuple):
    def __getitem__(self, key): return ("T", key)
class S(str):
    def __getitem__(self, key): return ("S", key)
class N: pass
class G:
    def __class_getitem__(cls, key): return ("G", cls.__name__, key)
objects = [A(), B(), C(), L([1, 2]), D(), M(), T((1, 2)), S("ab"), [5, 6], (7, 8), "xy", {0: "zero"}, b"ab", range(3), G, list, A()]
for _ in range(3): rec("many kinds", lambda: [get(o, 0) for o in objects])
thrice("no __getitem__", lambda: get(N(), 0))
thrice("an instance of a class with __class_getitem__", lambda: get(G(), 0))
n = N(); n.__getitem__ = lambda key: "of the instance"
thrice("__getitem__ of the instance", lambda: get(n, 0))

def changes():
    class X:
        def __getitem__(self, key): return "first"
    x = X(); got = [get(x, 0), get(x, 0)]
    X.__getitem__ = lambda self, key: "second"; got += [get(x, 0), get(x, 0)]
    X.__getitem__ = Callable(); got += [get(x, 0), get(x, 0)]
    X.__getitem__ = lambda self, key: "third"; got += [get(x, 0), get(x, 0)]
    del X.__getitem__
    try: get(x, 0)
    except TypeError as e: got.append(str(e).replace("changes.<locals>.", ""))
    class Base:
        def __getitem__(self, key): return "base"
    X.__bases__ = (Base,); got += [get(x, 0), get(x, 0)]
    Base.__getitem__ = lambda self, key: "new in base"; got += [get(x, 0), get(x, 0)]
    x.__class__ = A; got += [get(x, 0), get(x, 0)]
    return got
thrice("changes", changes)
def method_changes_the_class():
    class X:
        def __getitem__(self, key):
            X.__getitem__ = lambda self, key: "replaced"
            return "original"
    x = X()
    return [get(x, 0), get(x, 0), get(x, 0)]
thrice("the method changes the class", method_changes_the_class)

# Other instructions that use __getitem__.
class Seq:
    def __init__(self): self.log = []
    def __getitem__(self, key):
        self.log.append(key)
        if isinstance(key, int) and key >= 3: raise IndexError(key)
        return key
    def __setitem__(self, key, value): self.log.append(("set", key, value))
    def __delitem__(self, key): self.log.append(("del", key))
def uses():
    s = Seq()
    r = [list(s), [x for x in s], 2 in s, 5 in s, tuple(reversed([s[0], s[1]]))]
    x, y, z = s
    s[0] += 1; s[1:2] = [1]; del s[0]; s[s[0]] = s[1]
    return r, (x, y, z), s.log
thrice("uses", uses)

class Looks:
    def __getitem__(self, key):
        if key == "frames":
            f = sys._getframe()
            return (f.f_code.co_name, f.f_back.f_code.co_name, f.f_back.f_lineno - f.f_back.f_code.co_firstlineno, len(inspect.stack(0)) - depth, sorted(f.f_back.f_locals))
        if key == "stack": return [x.name for x in traceback.extract_stack()[-3:]]
        if key == "again": return self["raise"]
        raise KeyError(key)
depth = len(inspect.stack(0))
def caller(x):
    z = (x
         ["frames"])
    return z
thrice("frames", lambda: caller(Looks()))
thrice("stack", lambda: Looks()["stack"])
def tb(f):
    try: f()
    except Exception as e: return [(t.name, t.lineno - t_first, t.line) for t in traceback.extract_tb(e.__traceback__)]
t_first = sys._getframe().f_lineno
def raises(x): return x["again"]
def raises_in_try(x):
    try: return x["raise"]
    except KeyError as e: return "caught " + str(e)
    finally: out.append("finally")
for _ in range(3):
    rec("traceback", lambda: tb(lambda: raises(Looks())))
    rec("caught", lambda: raises_in_try(Looks()))

class V:
    def __init__(self, n): self.n = n
    def __getitem__(self, key): return V(self.n + getattr(key, "n", key))
    def __repr__(self): return "V(%d)" % self.n
g = V(100)
def aliases():
    a = V(1); k = V(2)
    a = a[k]; k = a[k]; a = a[a]; a = a[1][2][k]
    def inner(): return a[k], g[a], a[g], g[1]
    return a, k, inner(), [x[y] for x in (a, g) for y in (k, 1)]
thrice("aliases", aliases)
def generator(a):
    x = yield a[1]
    y = yield (yield x[a])[x]
    try:
        yield y[a]
    finally:
        yield a[a][a]
def drive():
    it = generator(V(1)); got = [next(it)]
    try:
        for v in (V(10), V(20), V(30), V(40), V(50)):
            gc.collect(); got.append(it.send(v))
    except StopIteration as e: got.append(("returned", e.value))
    return got
thrice("generator", drive)
class Body:
    x = V(1)[2]
rec("class body", lambda: Body.x)
m = V(1)[2]
rec("module", lambda: m)

class W:
    def __getitem__(self, key):
        gc.collect()
        return [r() is not None for r in refs]
class W2:
    def __getitem__(self, key):
        del self, key
        gc.collect()
        return [r() is not None for r in refs]
refs = []
def noted(x): refs.append(weakref.ref(x)); return x
def alive():
    del refs[:]
    during = noted(W())[noted(W())]
    gc.collect()
    return during, [r() is not None for r in refs]
thrice("alive", alive)
# The instruction holds on to its operands meanwhile. (CPython's does the first time it is executed. Later it may not.)
def once(source, scope): return eval(compile(source, "<once>", "eval"), scope)
def alive2():
    del refs[:]
    during = once("noted(W2())[noted(W2())]", globals())
    gc.collect()
    return during, [r() is not None for r in refs]
thrice("alive, the method lets go", alive2)

class Deep:
    def __getitem__(self, key): return self[key] if key is None else (key if key <= 0 else self[key - 1])
rec("endless", lambda: Deep()[None])
rec("deep", lambda: Deep()[500])
for count in (100, 130, 250, 300, 40000):
    source = "def wide(a, k):\n" + "".join("    v%d = %d\n" % (i, i) for i in range(count)) + "    r = a[k]\n    r = r[r]\n    return r, v%d\n" % (count - 1)
    ns = {}; exec(source, ns)
    for _ in range(2): rec("wide %d" % count, lambda: ns["wide"](V(1), V(2)))

def traced(f):
    events = []
    def tracer(frame, event, arg):
        if frame.f_code.co_name in ("__getitem__", "body"): events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer
    sys.settrace(tracer)
    try: f()
    finally: sys.settrace(None)
    return events
class Tr:
    def __getitem__(self, key):
        x = key
        return x
t = Tr()
def body():
    b = t[1]
    b += t[2]
    return b
body(); body()
for _ in range(2): rec("settrace", lambda: traced(body))
def profiled(f):
    events = []
    def profiler(frame, event, arg): events.append((event, frame.f_code.co_name))
    sys.setprofile(profiler)
    try: f()
    finally: sys.setprofile(None)
    return [e for e in events if e[1] in ("__getitem__", "body")]
for _ in range(2): rec("setprofile", lambda: profiled(body))
rec("afterwards", body)

# The same for other kinds of methods.
def operands_while_methods_run():
    log = []
    refs = []
    def noted(x): refs.append(weakref.ref(x)); return x
    def gone():
        gc.collect()
        return refs[-1]() is None
    class Two:
        def __getitem__(self, key):
            del self
            return gone()
    class Default:
        def __getitem__(self, key, a=1):
            del self
            return gone()
    class Many:
        def __getitem__(self, key, a=1, b=2, c=3, d=4):
            del self
            return gone()
    class Star:
        def __getitem__(*args):
            del args
            return gone()
    class Key: pass
    class OfKey:
        def __getitem__(self, key):
            del key
            return gone()
    of_key = OfKey()
    scope = dict(locals())
    def in_try():
        exec("def f():\n    try: return noted(Two())[0]\n    except ValueError: return None\n", scope)
        return scope["f"]()
    for _ in range(3):
        log.append([once(source, scope) for source in ("noted(Two())[0]", "noted(Default())[0]", "noted(Many())[0]", "noted(Star())[0]", "of_key[noted(Key())]")] + [in_try()])
        log.append(gone())
    return log
rec("operands while methods run", operands_while_methods_run)

# What an exception out of the method leaves behind: nothing.
def after_an_exception():
    log = []
    class Key: pass
    class Raises:
        def __getitem__(self, key): raise ValueError
    def caught():
        try: return noted(Raises())[noted(Key())]
        except ValueError: return None
    def passes(): return noted(Raises())[noted(Key())]
    def caught_outside():
        try: passes()
        except ValueError: pass
    for f in (caught, caught_outside) * 3:
        del refs[:]
        f()
        gc.collect()
        log.append([r() is not None for r in refs])
    return log
rec("after an exception", after_an_exception)

# The variable that takes the result has its old value until the method has returned, but a temporary has none.
def result_while_methods_run():
    log = []
    class Old: pass
    class Looks:
        def __getitem__(self, key):
            gc.collect()
            return [r() is not None for r in refs]
    looks = Looks()
    def variable():
        x = noted(Old())
        x = looks[0]
        return x
    def temporary():
        return (noted(Old()) is None, looks[0])
    looks[0]
    for f in (variable, temporary) * 3:
        del refs[:]
        log.append(f())
    return log
rec("the result while methods run", result_while_methods_run)

def buffers_while_methods_run():
    log = []
    def attempt(b):
        try: b.clear(); return "cleared"
        except BufferError: return "BufferError"
    class Base:
        def __init__(self, b): self.b = b; self.v = memoryview(b)
    class Default(Base):
        def __getitem__(self, key, a=1):
            b = self.b
            del self
            return attempt(b)
    class Many(Base):
        def __getitem__(self, key, a=1, b=2, c=3, d=4):
            b = self.b
            del self
            return attempt(b)
    def get_default(): return Default(bytearray(b"abc"))[0]
    def get_many(): return Many(bytearray(b"abc"))[0]
    for _ in range(4): log.append((get_default(), get_many()))
    return log
rec("buffers while methods run", buffers_while_methods_run)

print("\n".join(out))
print(len(out))
