# Comparisons whose methods are written in Python, as values and as conditions: which methods are called, in what order, what becomes of
# what they return, and what the program can see of the call while it runs.
import gc, operator, sys, traceback, weakref, functools, inspect
out = []
def rec(label, f):
    try: r = f()
    except BaseException as e: r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %r" % (label, r))

NAMES = ["eq", "ne", "lt", "le", "gt", "ge"]
SYMBOLS = ["==", "!=", "<", "<=", ">", ">="]
log = []
def forms(s):
    ns = {}
    exec("""
def value(a, b): return a %(s)s b
def if_(a, b):
    if a %(s)s b: return "then"
    return "else"
def if_not(a, b):
    if not a %(s)s b: return "then"
    return "else"
def while_(a, b):
    n = 0
    while a %(s)s b:
        n += 1
        if n == 3: break
    return n
def ternary(a, b): return "yes" if a %(s)s b else "no"
def and_(a, b): return a %(s)s b and "second"
def or_(a, b): return a %(s)s b or "second"
def not_(a, b): return not a %(s)s b
def chain(a, b): return a %(s)s b %(s)s a
def chain_if(a, b):
    if a %(s)s b %(s)s a: return "then"
    return "else"
def filter_(a, b): return [x for x in (1, 2) if a %(s)s b]
def assert_(a, b):
    assert a %(s)s b, "message"
    return "passed"
def both(a, b):
    if a %(s)s b and b %(s)s a: return "both"
    elif a %(s)s b or b %(s)s a: return "one"
    return "none"
""" % {"s": s}, ns)
    del ns["__builtins__"]
    return ns
FORMS = {s: forms(s) for s in SYMBOLS}

def method(tag, answer):
    def f(self, other):
        log.append((tag, self.name, getattr(other, "name", other)))
        return answer
    return f
MISSING = object()
def make(name, bases, answer):
    ns = {"__init__": lambda self, n: setattr(self, "name", n), "__hash__": None}
    if answer is not MISSING:
        for n in NAMES: ns["__%s__" % n] = method(name + "." + n, answer)
    return type(name, bases, ns)

# Every combination of what the two classes answer, for every operator and every form, twice each.
choices = (MISSING, NotImplemented, True, False)
shown_choice = {id(MISSING): "-", id(NotImplemented): "N", id(True): "T", id(False): "F"}
for ca in choices:
    A = make("A", (), ca)
    for cb in choices:
        for kind in ("other", "same", "subclass"):
            if kind == "same" and cb is not MISSING: continue
            B = A if kind == "same" else make("B", (A,) if kind == "subclass" else (), cb)
            for s in SYMBOLS:
                for form, f in FORMS[s].items():
                    for _ in range(2):
                        del log[:]
                        a, b = A("a"), B("b")
                        try: r = f(a, b)
                        except (TypeError, AssertionError) as e: r = type(e).__name__ + ":" + str(e)
                    out.append("%s %s %s %s%s -> %r %r" % (s, form, kind, shown_choice[id(ca)], shown_choice[id(cb)], r, log))

# What a method returns need not be a bool.
class Truth:
    def __init__(self, v): self.v = v
    def __bool__(self): log.append("__bool__"); return self.v
    def __repr__(self): return "Truth(%r)" % (self.v,)
class Sized:
    def __init__(self, n): self.n = n
    def __len__(self): log.append("__len__"); return self.n
    def __repr__(self): return "Sized(%r)" % (self.n,)
class Fails:
    def __bool__(self): raise ValueError("no truth")
    def __repr__(self): return "Fails()"
class NoBool:
    __bool__ = None
    def __repr__(self): return "NoBool()"
answers = [0, 1, -1, 2 ** 70, 0.0, 1.5, float("nan"), "", "x", (), (0,), [], [0], {}, None, Ellipsis, b"", 0j, Truth(True), Truth(False), Truth(1), Truth(None),
           Sized(0), Sized(2), Sized(-1), Sized("x"), Fails(), NoBool(), object, range(0), range(1)]
for answer in answers:
    R = make("R", (), answer)
    for s in ("==", "<", ">="):
        for form, f in FORMS[s].items():
            for _ in range(2):
                del log[:]
                try: r = f(R("a"), R("b"))
                except Exception as e: r = type(e).__name__ + ":" + str(e)
            out.append("answer %r %s %s -> %r %d %r" % (answer, s, form, r, len(log), [x for x in log if isinstance(x, str)]))

# With numbers, strs and other built-in objects on one side.
C = make("C", (), NotImplemented)
D = make("D", (), True)
for other in (1, 1.5, 2 ** 70, "s", [1], (1,), None, True, 1j, b"x", {1}, NotImplemented):
    for s in SYMBOLS:
        for cls in (C, D):
            for form in ("value", "if_", "if_not"):
                del log[:]
                rec("%s %s %r %s" % (cls.__name__, s, other, form), lambda: (FORMS[s][form](cls("c"), other), log))
                del log[:]
                rec("%r %s %s %s" % (other, s, cls.__name__, form), lambda: (FORMS[s][form](other, cls("c")), log))
# Subclasses of built-in types.
class I(int):
    def __lt__(self, other): log.append("I.__lt__"); return NotImplemented
    def __gt__(self, other): log.append("I.__gt__"); return "I.__gt__"
    def __eq__(self, other): log.append("I.__eq__"); return False
    __hash__ = int.__hash__
class S(str):
    def __eq__(self, other): log.append("S.__eq__"); return True
    def __ne__(self, other): log.append("S.__ne__"); return NotImplemented
    __hash__ = str.__hash__
for a, b in ((I(1), 2), (1, I(2)), (I(1), I(1)), (S("a"), "b"), ("a", S("b")), (S("a"), S("a")), (I(1), 1.5), (True, I(1))):
    for s in SYMBOLS:
        for form in ("value", "if_", "if_not", "chain"):
            del log[:]
            rec("%s(%r) %s %s(%r) %s" % (type(a).__name__, a + type(a).__mro__[-2](), s, type(b).__name__, b + type(b).__mro__[-2](), form), lambda: (FORMS[s][form](a, b), log))
# Only __eq__: != is its opposite, unless it says NotImplemented.
class OnlyEq:
    def __init__(self, answer): self.answer = answer
    def __eq__(self, other): log.append("eq"); return self.answer
for answer in (True, False, NotImplemented, 0, "x", Truth(True), Truth(False), Fails()):
    for s in ("==", "!="):
        for form in ("value", "if_", "if_not"):
            del log[:]
            rec("only __eq__ %r %s %s" % (answer, s, form), lambda: (FORMS[s][form](OnlyEq(answer), OnlyEq(answer)), log))
x = OnlyEq(NotImplemented)
for s in ("==", "!="):
    for form in ("value", "if_", "if_not"): rec("identical %s %s" % (s, form), lambda: FORMS[s][form](x, x))

# Signatures of the methods.
class Signatures:
    def __eq__(self, other, context=None, extra=(1, 2)): return ("eq", other, context, extra)
    def __ne__(self, *args): return ("ne", args)
    def __lt__(self, other, **kw): return ("lt", other, kw)
    def __le__(self): return "le"
    def __gt__(self, other, third): return "gt"
    def __ge__(self, other, a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9): return ("ge", other, a, i)
class Signatures2:
    def __eq__(*args): return ("eq", len(args))
    def __ne__(self, other, /): return ("ne", other)
    def __lt__(self, other, *, key): return "lt"
    def __le__(self, other, *, key="k"): return ("le", other, key)
    def __gt__(self, other):
        other = other + 1
        del self
        return ("gt", other, sorted(locals()))
    def __ge__(self, other): yield other
for cls in (Signatures, Signatures2):
    for s in SYMBOLS:
        for form in ("value", "if_", "if_not"):
            for _ in range(3):
                rec("signature %s %s %s" % (cls.__name__, s, form), lambda: (lambda r: list(r) if inspect.isgenerator(r) else r)(FORMS[s][form](cls(), 7)))

# What is found under the name need not be a function.
class Callable:
    def __call__(self, *args): return ("called", len(args))
class Descriptor:
    def __get__(self, instance, owner): return lambda other: ("bound by hand", type(instance).__name__, other)
class Kinds:
    __eq__ = staticmethod(lambda *args: ("static", len(args)))
    __ne__ = classmethod(lambda *args: ("class", args[0].__name__, len(args)))
    __lt__ = Callable()
    __le__ = Descriptor()
    __gt__ = property(lambda self: lambda other: ("property", other))
    __ge__ = functools.partial(lambda *args: ("partial", len(args)), 1)
class Kinds2:
    __eq__ = operator.add
    __ne__ = None
    __lt__ = len
    __le__ = int.__add__
    __gt__ = functools.partialmethod(lambda self, x, other: ("partialmethod", x, other), 5)
    __ge__ = property(lambda self: 1 / 0)
class Kinds3:
    __eq__ = property(lambda self: self.missing)
    __lt__ = type
    __le__ = object.__eq__
    __gt__ = int.__lt__
for cls in (Kinds, Kinds2, Kinds3):
    for s in SYMBOLS:
        for form in ("value", "if_", "if_not"):
            for _ in range(3): rec("kind %s %s %s" % (cls.__name__, s, form), lambda: FORMS[s][form](cls(), 7))

# What the method sees of its caller, and what a traceback says.
class Looks:
    def __lt__(self, other):
        f = sys._getframe()
        return (f.f_code.co_name, f.f_back.f_code.co_name, f.f_back.f_lineno - f.f_back.f_code.co_firstlineno, len(inspect.stack(0)) - depth, sorted(f.f_back.f_locals))
    def __le__(self, other): raise ValueError("from __le__")
    def __ge__(self, other): return self <= other
    def __gt__(self, other): return [x.name for x in traceback.extract_stack()[-3:]]
    def __eq__(self, other): seen.append((sys._getframe(1).f_code.co_name, sys._getframe(1).f_lineno - sys._getframe(1).f_code.co_firstlineno)); return True
depth = len(inspect.stack(0))
seen = []
def caller(x, y):
    z = (x
         < y)
    return z
def caller_if(x, y):
    if (x
            == y):
        return list(seen)
for _ in range(3): rec("frames", lambda: caller(Looks(), 1))
for _ in range(3): rec("frames reflected", lambda: caller(1, Looks()))
for _ in range(3): rec("frames of a condition", lambda: (seen.clear(), caller_if(Looks(), 1))[1])
def shown(f):
    try: f()
    except Exception as e: return [(t.name, t.lineno - t_first, t.line) for t in traceback.extract_tb(e.__traceback__)]
t_first = sys._getframe().f_lineno
def raises(x): return x >= 2
def raises_if(x):
    if x >= 2: return 1
    return 2
def raises_in_try(x):
    try:
        if x <= 1: return "then"
        return "else"
    except ValueError as e: return "caught " + str(e)
    finally: out.append("finally")
def raises_in_truth(x):
    try:
        while x == 1: return "then"
        return "else"
    except ValueError as e: return "caught " + str(e)
for _ in range(3):
    rec("traceback", lambda: shown(lambda: raises(Looks())))
    rec("traceback of a condition", lambda: shown(lambda: raises_if(Looks())))
    rec("caught", lambda: raises_in_try(Looks()))
    rec("caught from __bool__", lambda: raises_in_truth(OnlyEq(Fails())))
    rec("traceback from __bool__", lambda: shown(lambda: FORMS["=="]["if_"](OnlyEq(Fails()), 1)))

# The result goes where an operand is, and operands are constants, cells, globals.
class V:
    def __init__(self, n): self.n = n
    def __lt__(self, other): return V(self.n - getattr(other, "n", other))
    def __gt__(self, other): return V(getattr(other, "n", other) - self.n)
    def __eq__(self, other): return self.n == getattr(other, "n", other)
    def __bool__(self): return self.n < 0
    def __repr__(self): return "V(%d)" % self.n
g = V(1)
def aliases():
    a = V(1); b = V(2)
    a = a < b; b = a < b; a = a < a; c = 1 < a
    def inner(): return (a < c, c < g, g < 1, a == a, a == 0)
    l = [V(5)]; l[0] = l[0] < l[0]
    return a, b, c, inner(), l, [x < y for x in (a, 1) for y in (b, 2)], sorted([V(3), V(1), V(2)], key=lambda v: v.n), 1 < a < 2, a < 5 < b
for _ in range(3): rec("aliases", aliases)

# In a generator, around yields; in a coroutine; in a class body; at module level.
def generator(a, b):
    x = yield a < b
    if a < x: y = yield "less"
    else: y = yield "not less"
    while (yield a < y) < b:
        try:
            if a == (yield "in try"): yield "equal"
        finally:
            yield "finally"
    return a < y
def drive():
    it = generator(V(1), V(2)); got = [next(it)]
    try:
        for v in (V(10), V(20), V(1), V(1), V(3), V(4), V(5), V(-7), V(8)): got.append(it.send(v))
    except StopIteration as e: got.append(("returned", e.value))
    return got
for _ in range(3): rec("generator", drive)
# A collection while a generator is suspended after conditions that called methods: what it has saved are values.
def suspended(a, b):
    for i in range(3):
        try:
            if a < b or b < a or a == b: yield [i, a < b]
            if not a == b: yield (i, [a, b] if a < b else [b, a])
        except ValueError:
            yield "never"
def collect_between():
    got = []
    for item in suspended(V(1), V(2)):
        gc.collect(); got.append(item)
    return got
for _ in range(3): rec("suspended", collect_between)
async def coroutine(a, b): return "less" if a < b else "not less"
def run(c):
    try: c.send(None)
    except StopIteration as e: return e.value
rec("coroutine", lambda: run(coroutine(V(1), V(2))))
class Body:
    x = V(1) < V(2)
    if V(1) < V(2): y = "less"
rec("class body", lambda: (Body.x, Body.y))
m = V(1) < V(2)
if V(2) < V(1): m = "less"
rec("module", lambda: m)

# A method that changes what comes next, and then says NotImplemented.
def scenario(change, reflected_first, form):
    del log[:]
    class L:
        def __lt__(self, other): log.append("L.__lt__"); change(L, R, self, other); return NotImplemented
    class R(L if reflected_first else object):
        def __gt__(self, other): log.append("R.__gt__"); change(L, R, other, self); return NotImplemented
    class Other:
        def __lt__(self, other): log.append("Other.__lt__"); return "Other.__lt__"
        def __gt__(self, other): log.append("Other.__gt__"); return "Other.__gt__"
    scenario.Other = Other
    try: result = FORMS["<"][form](L(), R())
    except TypeError as e: result = "TypeError:" + str(e).replace("scenario.<locals>.", "")
    return result, list(log)
changes = {
    "nothing": lambda L, R, l, r: None,
    "delete __gt__": lambda L, R, l, r: "__gt__" in R.__dict__ and delattr(R, "__gt__"),
    "delete __lt__": lambda L, R, l, r: "__lt__" in L.__dict__ and delattr(L, "__lt__"),
    "replace __gt__": lambda L, R, l, r: setattr(R, "__gt__", lambda self, other: "new __gt__"),
    "replace __lt__": lambda L, R, l, r: setattr(L, "__lt__", lambda self, other: "new __lt__"),
    "class of the right": lambda L, R, l, r: setattr(r, "__class__", scenario.Other),
    "class of the left": lambda L, R, l, r: setattr(l, "__class__", scenario.Other),
}
for name, change in changes.items():
    for first in (False, True):
        for form in ("value", "if_", "if_not"):
            rec("meanwhile: %s, reflected first %s, %s" % (name, first, form), lambda: scenario(change, first, form))

# What is alive while the method runs, and afterwards.
class W:
    def __lt__(self, other):
        gc.collect()
        return [r() is not None for r in refs]
    def __eq__(self, other):
        gc.collect()
        during.append([r() is not None for r in refs])
        return noted(Truth(True))
    def __gt__(self, other): return NotImplemented
refs = []
during = []
def noted(x): refs.append(weakref.ref(x)); return x
def alive():
    del refs[:]
    meanwhile = noted(W()) < noted(W())
    gc.collect()
    return meanwhile, [r() is not None for r in refs]
for _ in range(3): rec("alive", alive)
def alive_in_condition():
    del refs[:], during[:]
    if noted(W()) == noted(W()):
        gc.collect()
        return during, [r() is not None for r in refs]
for _ in range(3): rec("alive in a condition", alive_in_condition)
def alive_after_not_implemented():
    del refs[:]
    try: r = noted(W()) > noted(V(1)).n
    except TypeError: r = "TypeError"
    gc.collect()
    return r, [x() is not None for x in refs]
for _ in range(3): rec("alive after NotImplemented", alive_after_not_implemented)

# Recursion through comparisons ends as any other.
class Deep:
    def __lt__(self, other): return self < other
    def __eq__(self, other):
        if self == other: return True
        return False
    def __gt__(self, other): return other if other <= 0 else self > (other - 1)
rec("endless", lambda: Deep() < 1)
rec("endless in a condition", lambda: Deep() == 1)
rec("deep", lambda: Deep() > 500)
limit = sys.getrecursionlimit()
def deepest():
    n = 0
    class Count:
        def __lt__(self, other):
            nonlocal n
            n += 1
            if self < other: return True
            return False
    try: Count() < 1
    except RecursionError: pass
    return limit - n < 60
rec("how deep", deepest)

# Many variables: the operands of the instruction need more than a byte. Far jumps.
for count in (100, 130, 250, 300, 40000):
    source = ("def wide(a, b):\n" + "".join("    v%d = %d\n" % (i, i) for i in range(count)) + "    r = a < b\n    if a < b:\n" +
              "".join("        v%d = %d\n" % (i, i + 1) for i in range(count)) + "    if not a < b: r = None\n    return r, v%d\n" % (count - 1))
    ns = {}; exec(source, ns)
    for _ in range(2):
        rec("wide %d" % count, lambda: ns["wide"](V(1), V(2)))
        rec("wide %d" % count, lambda: ns["wide"](V(2), V(1)))

# What a tracer is told.
NAMES_TRACED = ("__lt__", "__gt__", "__eq__", "__bool__", "body")
def traced(f):
    events = []
    def tracer(frame, event, arg):
        if frame.f_code.co_name in NAMES_TRACED: events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer
    sys.settrace(tracer)
    try: f()
    finally: sys.settrace(None)
    return events
class T:
    def __lt__(self, other):
        return NotImplemented
    def __eq__(self, other):
        return Truth(False)
class T2:
    def __gt__(self, other):
        x = 1
        return x
def body():
    a = T()
    b = a < T2()
    if a < T2():
        b = 2
    if a == 1:
        b = 3
    while not a < T2():
        b = 4
    return b
for _ in range(2): rec("settrace", lambda: traced(body))
def profiled(f):
    events = []
    def profiler(frame, event, arg): events.append((event, frame.f_code.co_name))
    sys.setprofile(profiler)
    try: f()
    finally: sys.setprofile(None)
    return [e for e in events if e[1] in NAMES_TRACED]
for _ in range(2): rec("setprofile", lambda: profiled(body))
def monitored(f, *names):
    M = sys.monitoring; events = []
    M.use_tool_id(3, "test")
    try:
        for name in names:
            M.register_callback(3, getattr(M.events, name), lambda code, *rest, name=name: events.append((name, code.co_name)) if code.co_name in NAMES_TRACED else None)
        M.set_events(3, functools.reduce(operator.or_, (getattr(M.events, name) for name in names)))
        result = f()
    finally:
        M.set_events(3, 0)
        for name in names: M.register_callback(3, getattr(M.events, name), None)
        M.free_tool_id(3)
    return result, events
for _ in range(2):
    rec("monitoring of branches", lambda: monitored(body, "BRANCH_LEFT", "BRANCH_RIGHT"))
    rec("monitoring of calls", lambda: monitored(body, "PY_START", "PY_RETURN", "BRANCH_LEFT", "BRANCH_RIGHT", "LINE"))

# A method gives the variables that the operands came from other values: the comparison goes on with the operands it began with.
def variables_change():
    log = []
    class A:
        def __init__(self, n): self.n = n
        def __lt__(self, other):
            log.append(("A.__lt__", self.n, other.n))
            frame = sys._getframe(1)
            frame.f_locals["x"] = A("other x"); frame.f_locals["y"] = B("other y")
            return NotImplemented
        __eq__ = __lt__
        __hash__ = None
    class B:
        def __init__(self, n): self.n = n
        def __gt__(self, other):
            log.append(("B.__gt__", self.n, other.n))
            return True
        __eq__ = __gt__
        __hash__ = None
    def value(x, y):
        r = x < y
        return r, x.n, y.n
    def jump(x, y):
        if x < y: return "yes", x.n, y.n
        return "no", x.n, y.n
    def jump_if_not(x, y):
        while not x == y: return "no", x.n, y.n
        return "yes", x.n, y.n
    for f in value, jump, jump_if_not:
        for _ in range(3): log.append(f(A("a"), B("b")))
    return log
rec("the variables change", variables_change)

# The same where the first method is no function: an object that is called, a method with many parameters.
def variables_change_in_other_callables():
    log = []
    def change(depth):
        frame = sys._getframe(depth)
        frame.f_locals["x"] = A("other x"); frame.f_locals["y"] = B("other y")
    class Called:
        def __call__(self, other):
            log.append(("Called", other.n))
            change(2)
            return NotImplemented
    class A:
        def __init__(self, n): self.n = n
        __eq__ = Called()
        def __lt__(self, other, a=1, b=2, c=3, d=4):
            log.append(("A.__lt__", self.n, other.n))
            change(2)
            return NotImplemented
    class B:
        def __init__(self, n): self.n = n
        def __eq__(self, other):
            log.append(("B.__eq__", self.n, other.n))
            return "eq"
        def __gt__(self, other):
            log.append(("B.__gt__", self.n, other.n))
            return "gt"
    def equal(x, y):
        r = x == y
        return r, x.n, y.n
    def less(x, y):
        r = x < y
        return r, x.n, y.n
    def if_equal(x, y):
        if x == y: return "yes", x.n, y.n
        return "no", x.n, y.n
    def if_not_less(x, y):
        if not x < y: return "no", x.n, y.n
        return "yes", x.n, y.n
    for f in (equal, less, if_equal, if_not_less) * 3: log.append(f(A("a"), B("b")))
    return log
rec("the variables change, other callables", variables_change_in_other_callables)

# What an exception leaves behind, out of a method or out of the __bool__ of what it returns: nothing.
def after_an_exception():
    log = []
    class Untrue:
        def __bool__(self): raise ValueError
    class Raises:
        def __eq__(self, other): raise ValueError
        def __lt__(self, other): return NotImplemented
        def __gt__(self, other): raise ValueError
        def __le__(self, other): return NotImplemented
        def __ge__(self, other): return NotImplemented
        def __ne__(self, other): return noted(Untrue())
    class Other(Raises): pass
    def first(): return noted(Raises()) == noted(Raises())
    def second(): return noted(Raises()) < noted(Raises())
    def number(): return 1 < noted(Raises())
    def none(): return noted(Raises()) <= noted(Raises())
    def if_first():
        if noted(Raises()) == noted(Raises()): return 1
    def if_second():
        if noted(Raises()) < noted(Raises()): return 1
    def if_none():
        if noted(Raises()) <= noted(Raises()): return 1
    def if_untrue():
        if noted(Raises()) != noted(Raises()): return 1
    def caught(f):
        try: f()
        except (ValueError, TypeError) as e: return type(e).__name__
    def caught_here():
        try:
            if noted(Raises()) == noted(Raises()): return 1
        except ValueError: return "here"
    for f in (first, second, number, none, if_first, if_second, if_none, if_untrue, caught_here) * 3:
        del refs[:]
        r = caught(f)
        gc.collect()
        log.append((r, [x() is not None for x in refs]))
    return log
rec("after an exception", after_an_exception)

# The variable that takes the result has its old value until the method has returned, but a temporary has none.
def result_while_methods_run():
    log = []
    class Old: pass
    class Looks:
        def __eq__(self, other):
            gc.collect()
            return [r() is not None for r in refs]
        def __gt__(self, other):
            gc.collect()
            return [r() is not None for r in refs]
    looks = Looks()
    def variable():
        x = noted(Old())
        x = looks == 1
        return x
    def temporary(): return (noted(Old()) is None, looks == 1)
    def reflected(): return (noted(Old()) is None, 1 < looks)
    looks == 1; 1 < looks
    for f in (variable, temporary, reflected) * 3:
        del refs[:]
        log.append(f())
    return log
rec("the result while methods run", result_while_methods_run)

print("\n".join(out))
print(len(out))
