# Properties whose getters are written in Python: what is called, when the instruction may go by what it remembers, and what the program
# can see of the call while it runs.
import gc, operator, sys, traceback, weakref, functools, inspect
out = []
def rec(label, f):
    try: r = f()
    except BaseException as e: r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %r" % (label, r))
def get(o): return o.p
def thrice(label, f):
    for _ in range(3): rec(label, f)

class A:
    def __init__(self, n=1): self.n = n
    @property
    def p(self): return ("A.p", self.n)
a = A()
thrice("plain", lambda: get(a))
thrice("another object", lambda: get(A(2)))
rec("through the class", lambda: type(get(A)).__name__)

# The kinds of getters.
class Callable:
    def __call__(self, *args): return ("called", len(args))
def kinds():
    yield "lambda", lambda self: "lambda"
    yield "defaults", lambda self, a=1, b=2: (a, b)
    yield "three defaults", lambda self, a=1, b=2, c=3: (a, b, c)
    yield "many defaults", lambda self, a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8: (a, h)
    yield "star", lambda *args: len(args)
    yield "star after self", lambda self, *args: args
    yield "keywords", lambda self, **kw: kw
    yield "keyword only", lambda self, *, k=5: k
    yield "keyword only without a default", lambda self, *, k: k
    yield "no parameter", lambda: 1
    yield "two parameters", lambda self, other: 1
    yield "positional only", lambda self, /: "positional only"
    yield "builtin", id.__class__
    yield "len", len
    yield "type", type
    yield "repr", repr
    yield "callable object", Callable()
    yield "partial", functools.partial(lambda x, self: ("partial", x), 1)
    yield "bound method", Callable().__call__
    yield "attrgetter", operator.attrgetter("n")
    yield "none", None
    yield "not callable", 5
    yield "staticmethod", staticmethod(lambda self: "static")
    yield "classmethod", classmethod(lambda cls, self: "class")
    def generator(self): yield self.n
    yield "generator", generator
    async def coroutine(self): return self.n
    yield "coroutine", coroutine
    def closure(self): return (label_of_closure, self.n)
    yield "closure", closure
    def deletes(self):
        n = self.n
        del self
        return n, sorted(locals())
    yield "deletes self", deletes
label_of_closure = "closure"
def shown(r):
    if inspect.isgenerator(r): return list(r)
    if inspect.iscoroutine(r): r.close(); return "coroutine"
    if isinstance(r, type): return r.__name__
    if isinstance(r, str) and " at 0x" in r: return r.split(" at 0x")[0]
    return r
for label, getter in kinds():
    K = type("K", (), {"p": property(getter), "n": 7, "__len__": lambda self: 3})
    k = K()
    thrice("getter: " + label, lambda: shown(get(k)))

# One place in the code sees objects of several classes.
class B(A):
    pass
class C(A):
    @property
    def p(self): return ("C.p", self.n)
class D:
    p = "plain"
class E:
    def __init__(self): self.p = "of the instance"
class F:
    __slots__ = ("p",)
    def __init__(self): self.p = "slot"
objects = [A(), B(), C(), D(), E(), F(), A(3), C(4)]
for round in range(3): rec("several classes", lambda: [get(o) for o in objects])

# Objects of one class that are laid out differently, and between them what has no such attribute, or is no object of a class at all.
def shapes():
    one = A(1)
    two = A(2); two.x = 1
    three = A(3); three.y = 1; three.x = 2
    four = A(4); four.__dict__
    five = A(5); five.ref = weakref.ref(five)
    six = A(6); del six.n; six.n = 6
    seven = A(7); setattr(seven, "0", 1)
    return [one, two, three, four, five, six, seven]
def attempt(o):
    try: return get(o)
    except AttributeError: return "AttributeError"
others = [5, "s", None, True, 1.0, 1.5, 2 ** 70, [1], (1,), {1: 2}, {1}, b"x", sys, len, attempt, A, object(), type, Ellipsis, range(3), slice(1), 1j, iter([]), (x for x in ()), ValueError(1), NotImplemented]
for round in range(3):
    rec("shapes", lambda: [get(o) for o in shapes()])
    rec("shapes and others", lambda: [attempt(o) if not isinstance(attempt(o), property) else "property" for pair in zip(shapes() * 4, others) for o in pair])
class Slotted(A):
    __slots__ = ("z",)
class Exc(Exception):
    p = property(lambda self: ("Exc.p", self.args))
class Lst(list):
    p = property(lambda self: ("Lst.p", len(self)))
class Int(int):
    p = property(lambda self: ("Int.p", self + 1))
class Str(str):
    p = property(lambda self: ("Str.p", self.upper()))
class Tup(tuple):
    p = property(lambda self: ("Tup.p", len(self)))
class Dct(dict):
    p = property(lambda self: ("Dct.p", len(self)))
for round in range(3): rec("derived from built-in types", lambda: [get(o) for o in (Slotted(1), Exc(1), Lst([1]), Int(1), Str("a"), Tup((1,)), Dct(a=1), Exc(2), Lst(), Int(2), Str("b"), Tup(), Dct())])
for cls, args in ((Exc, (1,)), (Lst, ([1],)), (Int, (1,)), (Str, ("a",)), (Tup, ((1,),)), (Dct, ())):
    def site(o): return o.p
    thrice("one class at a site: " + cls.__name__, lambda: [site(cls(*args)) for _ in range(3)])

# A property comes before what the instance has.
a = A(); a.__dict__["p"] = "in the dict"
thrice("shadowed", lambda: get(a))

# What changes under the instruction.
def changes():
    class X:
        n = 1
        @property
        def p(self): return "first"
    x = X(); got = [get(x), get(x)]
    X.p = property(lambda self: "second"); got += [get(x), get(x)]
    X.p = "plain"; got += [get(x), get(x)]
    X.p = property(lambda self: "third"); got += [get(x), get(x)]
    X.p.__init__(lambda self: "initialised again"); got += [get(x), get(x)]
    X.p.__init__(len); X.__len__ = lambda self: 9; got += [get(x), get(x)]
    X.p.__init__(None)
    try: get(x)
    except AttributeError as e: got.append(str(e))
    X.p.__init__(lambda self: "and again"); got += [get(x), get(x)]
    del X.p
    try: get(x)
    except AttributeError as e: got.append(str(e))
    x.p = "of the instance"; got += [get(x), get(x)]
    X.p = property(lambda self: "fourth"); got += [get(x), get(x)]
    class Y:
        p = property(lambda self: "of another class")
    x.__class__ = Y; got += [get(x), get(x)]
    return got
thrice("changes", changes)
def changes_in_base():
    class Base:
        p = property(lambda self: "base")
    class Derived(Base): pass
    d = Derived(); got = [get(d), get(d)]
    Base.p = property(lambda self: "new in base"); got += [get(d), get(d)]
    Derived.p = property(lambda self: "derived"); got += [get(d), get(d)]
    del Derived.p; got += [get(d), get(d)]
    Derived.__bases__ = (A,); d.n = 5; got += [get(d), get(d)]
    return got
thrice("changes in a base", changes_in_base)
def getter_changes_the_class():
    class X:
        @property
        def p(self):
            X.p = property(lambda self: "replaced")
            return "original"
    x = X()
    return [get(x), get(x), get(x)]
thrice("the getter changes the class", getter_changes_the_class)

# AttributeError out of a getter, with and without __getattr__.
def raising():
    class X:
        @property
        def p(self): raise AttributeError("from the getter")
    x = X(); got = []
    def attempt():
        try: got.append(get(x))
        except AttributeError as e: got.append("AttributeError:" + str(e))
    attempt(); attempt()
    X.__getattr__ = lambda self, name: "__getattr__(%s)" % name
    attempt(); attempt()
    del X.__getattr__
    attempt(); attempt()
    got.append(getattr(x, "p", "default")); got.append(hasattr(x, "p"))
    return got
thrice("raising", raising)
class WithGetattr:
    def __init__(self): self.fails = False
    @property
    def p(self):
        if self.fails: raise AttributeError("fails")
        return "works"
    def __getattr__(self, name): return "__getattr__(%s)" % name
def with_getattr():
    w = WithGetattr(); got = [get(w), get(w)]
    w.fails = True; got += [get(w), get(w)]
    w.fails = False; got += [get(w)]
    return got
thrice("with __getattr__", with_getattr)
class InheritsGetattr(WithGetattr): pass
thrice("inherits __getattr__", lambda: (lambda w: [get(w), setattr(w, "fails", True), get(w)])(InheritsGetattr()))
class WithGetattribute:
    p = property(lambda self: "property")
    def __getattribute__(self, name): return "__getattribute__(%s)" % name
thrice("with __getattribute__", lambda: get(WithGetattribute()))
class OtherErrors:
    @property
    def p(self): raise KeyError("k")
    def __getattr__(self, name): return "not asked"
thrice("another error", lambda: get(OtherErrors()))

# Classes derived from property, and other descriptors.
class Sub(property): pass
class SubWithGet(property):
    def __get__(self, instance, owner): return ("SubWithGet", super().__get__(instance, owner))
class Data:
    def __get__(self, instance, owner): return "Data.__get__"
    def __set__(self, instance, value): pass
class G:
    p = Sub(lambda self: "Sub")
class H:
    p = SubWithGet(lambda self: "inner")
class I:
    p = Data()
class J:
    p = functools.cached_property(lambda self: log.append("computed") or "cached")
log = []
for cls in (G, H, I, J):
    o = cls()
    thrice("descriptor of " + cls.__name__, lambda: get(o))
rec("computed once", lambda: log)
def sub_gets_get():
    class S(property): pass
    class X:
        p = S(lambda self: "before")
    x = X(); got = [get(x), get(x)]
    S.__get__ = lambda self, instance, owner: "after"
    got += [get(x), get(x)]
    return got
thrice("a subclass gets a __get__", sub_gets_get)
class Meta(type):
    p = property(lambda cls: "of the metaclass: " + cls.__name__)
class WithMeta(metaclass=Meta): pass
thrice("metaclass", lambda: get(WithMeta))
rec("metaclass, instance", lambda: get(WithMeta()))

# In calls, subscripts, augmented assignments, deletions.
class L:
    def __init__(self): self.items = [1, 2, 3]; self.count = 0
    @property
    def p(self): self.count += 1; return self.items
    @property
    def f(self): return lambda *args: ("called", args)
    @property
    def w(self): return self._w
    @w.setter
    def w(self, value): self._w = value * 2
    @w.deleter
    def w(self): del self._w
def uses():
    l = L()
    r = [l.p[0], l.p.copy(), l.f(1, 2), l.f(*[3]), len(l.p)]
    l.p[0] += 5; l.p.append(4)
    l.w = 1; l.w += 1; r.append(l.w)
    del l.w
    try: l.w
    except AttributeError as e: r.append(str(e).replace("'L' object has no attribute ", ""))
    try: l.p = 1
    except AttributeError as e: r.append(str(e))
    return r, l.items, l.count
thrice("uses", uses)

# What the getter sees of its caller, and what a traceback says.
class Looks:
    @property
    def p(self):
        f = sys._getframe()
        return (f.f_code.co_name, f.f_back.f_code.co_name, f.f_back.f_lineno - f.f_back.f_code.co_firstlineno, len(inspect.stack(0)) - depth, sorted(f.f_back.f_locals))
    @property
    def q(self): raise ValueError("from q")
    @property
    def r(self): return self.q
    @property
    def s(self): return [x.name for x in traceback.extract_stack()[-3:]]
depth = len(inspect.stack(0))
def caller(x):
    z = (x
         .p)
    return z
thrice("frames", lambda: caller(Looks()))
thrice("stack", lambda: Looks().s)
def tb(f):
    try: f()
    except Exception as e: return [(t.name, t.lineno - t_first, t.line) for t in traceback.extract_tb(e.__traceback__)]
t_first = sys._getframe().f_lineno
def raises(x): return x.r
def raises_in_try(x):
    try: return x.q
    except ValueError as e: return "caught " + str(e)
    finally: out.append("finally")
for _ in range(3):
    rec("traceback", lambda: tb(lambda: raises(Looks())))
    rec("caught", lambda: raises_in_try(Looks()))

# The result goes where the object is; the object is a cell, a global, a constant.
class V:
    def __init__(self, n): self.n = n
    @property
    def next(self): return V(self.n + 1)
    def __repr__(self): return "V(%d)" % self.n
g = V(100)
def aliases():
    a = V(1)
    a = a.next; a = a.next.next
    def inner(): return a.next, g.next
    return a, inner(), [x.next for x in (a, g)], {k: v.next for k, v in {"k": a}.items()}, a.next.next.next.n
thrice("aliases", aliases)

# In a generator, around yields; in a coroutine; in a class body; at module level.
def generator(a):
    x = yield a.next
    y = yield (yield x.next).next
    try:
        yield y.next
    finally:
        yield a.next.next
def drive():
    it = generator(V(1)); got = [next(it)]
    try:
        for v in (V(10), V(20), V(30), V(40), V(50)):
            gc.collect(); got.append(it.send(v))
    except StopIteration as e: got.append(("returned", e.value))
    return got
thrice("generator", drive)
async def coroutine(a): return a.next
def run(c):
    try: c.send(None)
    except StopIteration as e: return e.value
rec("coroutine", lambda: run(coroutine(V(1))))
class Body:
    x = V(1).next
rec("class body", lambda: Body.x)
m = V(1).next
rec("module", lambda: m)

# What is alive while the getter runs, and afterwards.
class W:
    @property
    def p(self):
        gc.collect()
        return [r() is not None for r in refs]
    @property
    def q(self):
        del self
        gc.collect()
        return [r() is not None for r in refs]
refs = []
def noted(x): refs.append(weakref.ref(x)); return x
# The instruction holds on to the object meanwhile. (CPython's does the first time it is executed. Later it may not.)
def once(source, scope): return eval(compile(source, "<once>", "eval"), scope)
def alive(name):
    del refs[:]
    during = noted(W()).p if name == "p" else once("noted(W()).q", globals())
    gc.collect()
    return during, [r() is not None for r in refs]
thrice("alive", lambda: alive("p"))
thrice("alive, the getter lets go", lambda: alive("q"))

# Recursion through properties ends as any other.
class Deep:
    def __init__(self, n=0): self.n = n
    @property
    def p(self): return self.p
    @property
    def q(self): return self.n if self.n >= 500 else Deep(self.n + 1).q
rec("endless", lambda: Deep().p)
rec("deep", lambda: Deep().q)
limit = sys.getrecursionlimit()
def deepest():
    n = 0
    class Count:
        def __init__(self, left): self.left = left
        @property
        def p(self):
            nonlocal n
            n += 1
            self.left -= 1
            return self.p if self.left else 0
    Count(3).p
    n = 0
    try: Count(-1).p
    except RecursionError: pass
    return limit - n < 60
rec("how deep", deepest)

# Many variables: the operands of the instruction need more than a byte.
for count in (100, 130, 250, 300, 40000):
    source = "def wide(a):\n" + "".join("    v%d = %d\n" % (i, i) for i in range(count)) + "    r = a.next\n    r = r.next\n    return r, v%d\n" % (count - 1)
    ns = {}; exec(source, ns)
    for _ in range(2): rec("wide %d" % count, lambda: ns["wide"](V(1)))

# What a tracer is told.
def traced(f):
    events = []
    def tracer(frame, event, arg):
        if frame.f_code.co_name in ("p", "body"): events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer
    sys.settrace(tracer)
    try: f()
    finally: sys.settrace(None)
    return events
class T:
    @property
    def p(self):
        x = 1
        return x
t = T()
def body():
    b = t.p
    b += t.p
    return b
body(); body()
for _ in range(2): rec("settrace", lambda: traced(body))
def profiled(f):
    events = []
    def profiler(frame, event, arg): events.append((event, frame.f_code.co_name))
    sys.setprofile(profiler)
    try: f()
    finally: sys.setprofile(None)
    return [e for e in events if e[1] in ("p", "body")]
for _ in range(2): rec("setprofile", lambda: profiled(body))
def monitored(f, *names):
    M = sys.monitoring; events = []
    M.use_tool_id(3, "test")
    try:
        for name in names:
            M.register_callback(3, getattr(M.events, name), lambda code, *rest, name=name: events.append((name, code.co_name)) if code.co_name in ("p", "body") else None)
        M.set_events(3, functools.reduce(operator.or_, (getattr(M.events, name) for name in names)))
        result = f()
    finally:
        M.set_events(3, 0)
        for name in names: M.register_callback(3, getattr(M.events, name), None)
        M.free_tool_id(3)
    return result, events
for _ in range(2): rec("monitoring", lambda: monitored(body, "PY_START", "PY_RETURN", "LINE", "CALL"))
rec("afterwards", body)

# An AttributeError out of a getter is told the name and the object. (By CPython's instruction the first time it is executed.)
def errors_of_getters():
    log = []
    bad = False
    class C:
        def one(self):
            if bad: raise AttributeError("boom")
        def default(self, x=1):
            if bad: raise AttributeError("boom")
        def star(*args):
            if bad: raise AttributeError("boom")
        def keyword_only(self, *, x=1):
            if bad: raise AttributeError("boom")
        def says(self):
            if bad: raise AttributeError("boom", name="other", obj=None)
        def derived(self):
            if bad: raise Derived("boom")
        def another(self):
            if bad: raise KeyError("boom")
        def changes(self):
            sys._getframe(1).f_locals["c"] = None
            if bad: raise AttributeError("boom")
        names = "one", "default", "star", "keyword_only", "says", "derived", "another", "changes"
        one, default, star, keyword_only, says, derived, another, changes = map(property, (one, default, star, keyword_only, says, derived, another, changes))
    class Derived(AttributeError): pass
    c = C()
    def attempt(name):
        try: return once("c." + name, {"c": c})
        except AttributeError as e: return type(e).__name__, e.name, e.obj is c, str(e)
        except KeyError as e: return type(e).__name__, str(e)
    def attempt_in_function(name):
        scope = {}
        exec("def f(c):\n    try: return c.%s\n    except AttributeError as e: return e\n" % name, scope)
        e = scope["f"](c)
        return e and (e.name, e.obj is c)
    for bad in False, False, True, True:
        log.append([attempt(name) for name in C.names])
    log.append([attempt_in_function(name) for name in C.names if name != "another"])
    return log
rec("errors of getters", errors_of_getters)

# What the instruction holds on to while the getter runs: the object.
def operands_while_getters_run():
    log = []
    refs = []
    def noted(x): refs.append(weakref.ref(x)); return x
    def gone():
        gc.collect()
        return refs[-1]() is None
    class C:
        def one(self):
            del self
            return gone()
        def default(self, a=1):
            del self
            return gone()
        def many(self, a=1, b=2, c=3, d=4):
            del self
            return gone()
        one, default, many = map(property, (one, default, many))
        def __getattr__(self, name):
            del self
            return gone()
    class D:
        @property
        def one(self):
            del self
            return gone()
    scope = dict(locals())
    def in_try():
        exec("def f():\n    try: return noted(D()).one\n    except ValueError: return None\n", scope)
        return scope["f"]()
    for _ in range(3):
        log.append([once(source, scope) for source in ("noted(D()).one", "noted(C()).one", "noted(C()).default", "noted(C()).many", "noted(C()).missing")] + [in_try()])
        log.append(gone())
    return log
rec("operands while getters run", operands_while_getters_run)

# What an exception out of the getter leaves behind: nothing.
def after_an_exception():
    log = []
    class Raises:
        @property
        def p(self): raise ValueError
        @property
        def q(self): raise AttributeError
    def caught():
        try: return noted(Raises()).p
        except ValueError: return None
    def passes(): return noted(Raises()).p
    def caught_outside():
        try: passes()
        except ValueError: pass
    def attribute_error():
        try: return noted(Raises()).q
        except AttributeError: return None
    for f in (caught, caught_outside, attribute_error) * 3:
        del refs[:]
        f()
        gc.collect()
        log.append([r() is not None for r in refs])
    return log
rec("after an exception", after_an_exception)

# The variable that takes the result has its old value until the getter has returned, but a temporary has none.
def result_while_getters_run():
    log = []
    class Old: pass
    class Looks:
        @property
        def p(self):
            gc.collect()
            return [r() is not None for r in refs]
    looks = Looks()
    def variable():
        x = noted(Old())
        x = looks.p
        return x
    def temporary(): return (noted(Old()) is None, looks.p)
    looks.p
    for f in (variable, temporary) * 3:
        del refs[:]
        log.append(f())
    return log
rec("the result while getters run", result_while_getters_run)

def buffers_while_getters_run():
    log = []
    class C:
        def __init__(self, b): self.b = b; self.v = memoryview(b)
        def attempt(b):
            try: b.clear(); return "cleared"
            except BufferError: return "BufferError"
        def one(self, attempt=attempt):
            b = self.b
            del self
            return attempt(b)
        def many(self, a=1, b=2, c=3, d=4, attempt=attempt):
            b = self.b
            del self
            return attempt(b)
        def __getattr__(self, name, attempt=attempt):
            b = self.b
            del self
            return attempt(b)
        one, many = property(one), property(many)
    def get_one(): return C(bytearray(b"abc")).one
    def get_many(): return C(bytearray(b"abc")).many
    def get_missing(): return C(bytearray(b"abc")).missing
    for _ in range(4): log.append((get_one(), get_many(), get_missing()))
    return log
rec("buffers while getters run", buffers_while_getters_run)

print("\n".join(out))
print(len(out))
