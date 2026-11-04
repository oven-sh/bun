# Operators whose methods are written in Python: which methods are called, in what order, with what, and what the program can see of the
# call while it runs (frames, tracebacks, tracing, what is alive).
import gc, operator, sys, traceback, weakref, functools, inspect
out = []
def rec(label, f):
    try: r = f()
    except BaseException as e: r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %r" % (label, r))

NAMES = ["add", "sub", "mul", "matmul", "truediv", "mod", "pow", "lshift", "rshift", "or", "xor", "and", "floordiv"]
SYMBOLS = ["+", "-", "*", "@", "/", "%", "**", "<<", ">>", "|", "^", "&", "//"]
log = []
def method(tag, answer):
    def f(self, other):
        log.append((tag, self.name, getattr(other, "name", other)))
        return NotImplemented if answer is None else (answer, self.name)
    return f
def make(name, bases=(), left=0, right=0, inplace=0):
    # 0: no such method; None: it returns NotImplemented; otherwise what it returns.
    ns = {"__init__": lambda self, n: setattr(self, "name", n)}
    for n in NAMES:
        if left != 0: ns["__%s__" % n] = method(name + "." + n, left)
        if right != 0: ns["__r%s__" % n] = method(name + ".r" + n, right)
        if inplace != 0: ns["__i%s__" % n] = method(name + ".i" + n, inplace)
    return type(name, bases, ns)
binary = {s: eval("lambda a, b: a %s b" % s) for s in SYMBOLS}
def in_place(s):
    ns = {}
    exec("def f(a, b):\n    a %s= b\n    return a" % s, ns)
    return ns["f"]
augmented = {s: in_place(s) for s in SYMBOLS}

# Every combination of what the two classes have, for every operator, twice each (the second time the instruction has seen it before).
choices = (0, None, "yes")
for la in choices:
    for ra in choices:
        for ia in choices:
            A = make("A", (), la, ra, ia)
            for lb in choices:
                for rb in choices:
                    for kind in ("other", "same", "subclass"):
                        B = A if kind == "same" else make("B", (A,) if kind == "subclass" else (), lb, rb, 0)
                        if kind == "same" and (lb, rb) != (0, 0): continue
                        for s in ("+", "//", "**", "&") if (la, ra, ia, lb, rb) != (None, None, None, None, None) else SYMBOLS:
                            for table, mark in ((binary, ""), (augmented, "=")):
                                for _ in range(2):
                                    del log[:]
                                    a, b = A("a"), B("b")
                                    try: r = table[s](a, b)
                                    except TypeError as e: r = "TypeError:" + str(e)
                                    r = "a" if r is a else r
                                out.append("%s%s %s A%r B%r -> %r %r" % (s, mark, kind, (la, ra, ia), (lb, rb), r, log))
# With numbers, strs and lists on one side.
C = make("C", (), None, "r", None)
D = make("D", (), "l", None, "i")
for other in (1, 1.5, 2 ** 70, "s", [1], (1,), None, True, 1j, b"x", {1}):
    for s in SYMBOLS:
        for cls in (C, D):
            del log[:]
            rec("%s %s %r" % (cls.__name__, s, other), lambda: (binary[s](cls("c"), other), log))
            del log[:]
            rec("%r %s %s" % (other, s, cls.__name__), lambda: (binary[s](other, cls("c")), log))
            del log[:]
            rec("%r %s= %s" % (other, s, cls.__name__), lambda: (augmented[s](other, cls("c")), log))

# Signatures of the methods.
class Signatures:
    def __add__(self, other, context=None, extra=(1, 2)): return ("add", other, context, extra)
    def __sub__(self, *args): return ("sub", args)
    def __mul__(self, other, **kw): return ("mul", other, kw)
    def __truediv__(self, other, *, key="k"): return ("div", other, key)
    def __mod__(self): return "mod"
    def __pow__(self, other, third): return "pow"
    def __lshift__(*args): return ("lshift", len(args))
    def __rshift__(self, other, a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9): return ("rshift", other, a, i)
    def __or__(self, other, /): return ("or", other)
    def __xor__(self, other, *, key): return "xor"
    def __and__(self, other=5): return ("and", other)
    def __floordiv__(self, other):
        other = other + 1
        del self
        return ("floordiv", other, sorted(locals()))
    def __matmul__(self, other):
        yield other
for s in SYMBOLS:
    for _ in range(3):
        rec("signature " + s, lambda: binary[s](Signatures(), 7) if s != "@" else list(binary[s](Signatures(), 7)))

# What is found under the name need not be a function.
class Callable:
    def __call__(self, *args): return ("called", len(args))
class Descriptor:
    def __get__(self, instance, owner): return lambda other: ("bound by hand", type(instance).__name__, other)
class Kinds:
    __add__ = staticmethod(lambda *args: ("static", len(args)))
    __sub__ = classmethod(lambda *args: ("class", args[0].__name__, len(args)))
    __mul__ = Callable()
    __truediv__ = Descriptor()
    __mod__ = property(lambda self: lambda other: ("property", other))
    __pow__ = functools.partial(lambda *args: ("partial", len(args)), 1)
    __lshift__ = operator.add
    __rshift__ = None
    __or__ = len
    __xor__ = int.__add__
    __and__ = functools.partialmethod(lambda self, x, other: ("partialmethod", x, other), 5)
    __floordiv__ = property(lambda self: 1 / 0)
    __matmul__ = type
for s in SYMBOLS:
    for _ in range(3):
        rec("kind " + s, lambda: binary[s](Kinds(), 7))

# What the method sees of its caller, and what a traceback says.
class Looks:
    def __add__(self, other):
        f = sys._getframe()
        return (f.f_code.co_name, f.f_back.f_code.co_name, f.f_back.f_lineno - f.f_back.f_code.co_firstlineno, len(inspect.stack(0)) - depth, sorted(f.f_back.f_locals))
    def __sub__(self, other): raise ValueError("from __sub__")
    def __mul__(self, other): return self - other
    def __radd__(self, other): return [x.name for x in traceback.extract_stack()[-3:]]
depth = len(inspect.stack(0))
def caller(x, y):
    z = (x
         + y)
    return z
for _ in range(3): rec("frames", lambda: caller(Looks(), 1))
for _ in range(3): rec("frames reflected", lambda: caller(1, Looks()))
def shown(f):
    try: f()
    except Exception as e: return [(t.name, t.lineno - t_first, t.line) for t in traceback.extract_tb(e.__traceback__)]
t_first = sys._getframe().f_lineno
def raises(x): return x * 2
def raises_in_try(x):
    try: return x - 1
    except ValueError as e: return "caught " + str(e)
    finally: out.append("finally")
for _ in range(3):
    rec("traceback", lambda: shown(lambda: raises(Looks())))
    rec("caught", lambda: raises_in_try(Looks()))

# The result goes where an operand is, and operands are constants, cells, globals.
class V:
    def __init__(self, n): self.n = n
    def __add__(self, other): return V(self.n + getattr(other, "n", other))
    __radd__ = __add__
    def __iadd__(self, other): self.n += 100 + getattr(other, "n", other); return self
    def __repr__(self): return "V(%d)" % self.n
g = V(1)
def aliases():
    a = V(1); b = V(2)
    a = a + b; b = a + b; a = a + a; c = 1 + a + 2 + b + 3
    def inner(): return a + c + g + 1
    a += b; a += a; a += 1
    l = [V(5)]; l[0] += 1; l[0] = l[0] + l[0]
    return a, b, c, inner(), l, [x + y for x in (a, 1) for y in (b, 2)], sum([a, b, c], V(0))
for _ in range(3): rec("aliases", aliases)

# In a generator, around yields; in a coroutine; in a class body; at module level.
def generator(a, b):
    x = yield a + b
    y = yield (yield a + x) + b
    return a + y
def drive():
    it = generator(V(1), V(2)); got = [next(it)]
    try:
        for v in (V(10), V(20), V(30)): got.append(it.send(v))
    except StopIteration as e: got.append(("returned", e.value))
    return got
for _ in range(3): rec("generator", drive)
async def coroutine(a, b): return a + b
def run(c):
    try: c.send(None)
    except StopIteration as e: return e.value
rec("coroutine", lambda: run(coroutine(V(1), V(2))))
class Body:
    x = V(1) + V(2)
    x += 1
rec("class body", lambda: Body.x)
m = V(1) + V(2); m += m
rec("module", lambda: m)

# A method that changes what comes next, and then says NotImplemented.
def scenario(change, reflected_first=False):
    del log[:]
    class L:
        def __add__(self, other): log.append("L.__add__"); change(L, R, self, other); return NotImplemented
        def __iadd__(self, other): log.append("L.__iadd__"); change(L, R, self, other); return NotImplemented
    class R(L if reflected_first else object):
        def __radd__(self, other): log.append("R.__radd__"); change(L, R, other, self); return NotImplemented
    class Other:
        def __add__(self, other): log.append("Other.__add__"); return "Other.__add__"
        def __radd__(self, other): log.append("Other.__radd__"); return "Other.__radd__"
    scenario.Other = Other
    results = []
    for f in (binary["+"], augmented["+"]):
        try: results.append(f(L(), R()))
        except TypeError as e: results.append("TypeError")
    return results, list(log)
changes = {
    "nothing": lambda L, R, l, r: None,
    "delete __radd__": lambda L, R, l, r: "__radd__" in R.__dict__ and delattr(R, "__radd__"),
    "delete __add__": lambda L, R, l, r: "__add__" in L.__dict__ and delattr(L, "__add__"),
    "replace __radd__": lambda L, R, l, r: setattr(R, "__radd__", lambda self, other: "new __radd__"),
    "replace __add__": lambda L, R, l, r: setattr(L, "__add__", lambda self, other: "new __add__"),
    "class of the right": lambda L, R, l, r: setattr(r, "__class__", scenario.Other),
    "class of the left": lambda L, R, l, r: setattr(l, "__class__", scenario.Other),
    "delete __iadd__": lambda L, R, l, r: "__iadd__" in L.__dict__ and delattr(L, "__iadd__"),
}
for name, change in changes.items():
    for first in (False, True):
        rec("meanwhile: %s, reflected first %s" % (name, first), lambda: scenario(change, first))

# What is alive while the method runs, and afterwards.
class W:
    def __add__(self, other):
        gc.collect()
        return [r() is not None for r in refs]
    def __radd__(self, other): return NotImplemented
refs = []
def noted(x): refs.append(weakref.ref(x)); return x
def alive():
    del refs[:]
    during = noted(W()) + noted(W())
    gc.collect()
    return during, [r() is not None for r in refs]
for _ in range(3): rec("alive", alive)
def alive_after_not_implemented():
    del refs[:]
    try: noted(V(1)).__class__; r = 1 + noted(W())
    except TypeError: r = "TypeError"
    gc.collect()
    return r, [x() is not None for x in refs]
for _ in range(3): rec("alive after NotImplemented", alive_after_not_implemented)

# Recursion through operators ends as any other.
class Deep:
    def __add__(self, other): return self + other
    def __sub__(self, other): return other if other <= 0 else self - (other - 1)
rec("endless", lambda: Deep() + 1)
rec("deep", lambda: Deep() - 500)
limit = sys.getrecursionlimit()
def deepest():
    n = 0
    class Count:
        def __add__(self, other):
            nonlocal n
            n += 1
            return self + other
    try: Count() + 1
    except RecursionError: pass
    return limit - n < 60
rec("how deep", deepest)

# Many variables: the operands of the instruction need more than a byte.
for count in (100, 130, 250, 300, 40000):
    source = "def wide(a, b):\n" + "".join("    v%d = %d\n" % (i, i) for i in range(count)) + "    r = a + b\n    r += a\n    return r, v%d\n" % (count - 1)
    ns = {}; exec(source, ns)
    for _ in range(2): rec("wide %d" % count, lambda: ns["wide"](V(1), V(2)))

# What a tracer is told.
def traced(f):
    events = []
    def tracer(frame, event, arg):
        if frame.f_code.co_name in ("__add__", "__radd__", "__iadd__", "body"): events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer
    sys.settrace(tracer)
    try: f()
    finally: sys.settrace(None)
    return events
class T:
    def __add__(self, other):
        return NotImplemented
    def __radd__(self, other):
        x = 1
        return x
    def __iadd__(self, other): return NotImplemented
def body():
    a = T()
    b = a + T2()
    a += T2()
    return b
class T2(T): pass
class T2:
    def __radd__(self, other):
        return 5
for _ in range(2): rec("settrace", lambda: traced(body))
def profiled(f):
    events = []
    def profiler(frame, event, arg): events.append((event, frame.f_code.co_name))
    sys.setprofile(profiler)
    try: f()
    finally: sys.setprofile(None)
    return [e for e in events if e[1] in ("__add__", "__radd__", "__iadd__", "body")]
for _ in range(2): rec("setprofile", lambda: profiled(body))

# A method gives the variables that the operands came from other values: the operator goes on with the operands it began with.
def variables_change():
    log = []
    class A:
        def __init__(self, n): self.n = n
        def __add__(self, other):
            log.append(("A.__add__", self.n, other.n))
            frame = sys._getframe(1)
            frame.f_locals["x"] = A("other x"); frame.f_locals["y"] = B("other y")
            return NotImplemented
        def __iadd__(self, other):
            log.append(("A.__iadd__", self.n, other.n))
            frame = sys._getframe(1)
            frame.f_locals["x"] = A("another x"); frame.f_locals["y"] = B("another y")
            return NotImplemented
    class B:
        def __init__(self, n): self.n = n
        def __radd__(self, other):
            log.append(("B.__radd__", self.n, other.n))
            return "radd"
    def plain(x, y):
        r = x + y
        return r, x.n, y.n
    def in_place(x, y):
        x += y
        return x, y.n
    for _ in range(3): log.append(plain(A("a"), B("b")))
    for _ in range(3): log.append(in_place(A("a"), B("b")))
    return log
rec("the variables change", variables_change)

# A method changes the class of an operand.
def classes_of_operands_change():
    log = []
    def add(x, y): return x + y
    def iadd(x, y):
        x += y
        return x
    def attempt(f, x, y):
        try: log.append(f(x, y))
        except TypeError as e: log.append(str(e))
    class A:
        def __add__(self, other): log.append("A.add"); other.__class__ = A; return NotImplemented
        def __radd__(self, other): log.append("A.radd"); return "A.radd"
    class B:
        def __radd__(self, other): log.append("B.radd"); return "B.radd"
    class C:
        def __add__(self, other): log.append("C.add"); self.__class__ = D; return NotImplemented
    class D:
        def __radd__(self, other): log.append("D.radd"); return "D.radd"
    class E:
        def __add__(self, other): log.append("E.add"); return "E.add"
        def __radd__(self, other): log.append("E.radd"); return NotImplemented
    class F(E):
        def __radd__(self, other): log.append("F.radd"); other.__class__ = G; return NotImplemented
    class G:
        def __add__(self, other): log.append("G.add"); return "G.add"
    class H:
        def __iadd__(self, other): log.append("H.iadd"); self.__class__ = I; return NotImplemented
    class I:
        def __add__(self, other): log.append("I.add"); return "I.add"
        def __iadd__(self, other): log.append("I.iadd"); return "I.iadd"
    for _ in range(3):
        attempt(add, A(), B()); attempt(add, C(), D()); attempt(add, E(), F()); attempt(iadd, H(), 1)
    return log
rec("the classes of the operands change", classes_of_operands_change)

# A method gives a class the method that would be asked next. Whether the class is asked was settled at the start: it is if it knew of
# the operator in either direction.
def classes_gain_methods():
    log = []
    def add(x, y): return x + y
    def attempt(x, y):
        try: log.append(add(x, y))
        except TypeError as e: log.append(str(e))
    def new(name): return lambda self, other: (log.append(name), name)[1]
    for _ in range(2):
        class A:
            def __add__(self, other): log.append("A.add"); type(other).__radd__ = new("new radd"); return NotImplemented
        class B:
            def __add__(self, other): return "B.add"
        class Bare: pass
        attempt(A(), B()); attempt(A(), Bare())
        class C:
            def __radd__(self, other): return NotImplemented
        class D(C):
            def __radd__(self, other): log.append("D.radd"); C.__add__ = new("new add"); return NotImplemented
        attempt(C(), D())
        class E:
            def __add__(self, other): log.append("E.add"); del type(other).__radd__; return NotImplemented
        class F:
            def __radd__(self, other): return "F.radd"
        attempt(E(), F())
    return log
rec("the classes gain and lose methods", classes_gain_methods)

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
        __add__ = Called()
        __isub__ = Called()
        def __sub__(self, other, a=1, b=2, c=3, d=4):
            log.append(("A.__sub__", self.n, other.n))
            change(2)
            return NotImplemented
    class B:
        def __init__(self, n): self.n = n
        def __radd__(self, other):
            log.append(("B.__radd__", self.n, other.n))
            return "radd"
        def __rsub__(self, other):
            log.append(("B.__rsub__", self.n, other.n))
            return "rsub"
    def plus(x, y):
        r = x + y
        return r, x.n, y.n
    def minus(x, y):
        r = x - y
        return r, x.n, y.n
    def in_place(x, y):
        x -= y
        return x, y.n
    for f in (plus, minus, in_place) * 3: log.append(f(A("a"), B("b")))
    return log
rec("the variables change, other callables", variables_change_in_other_callables)

# What an exception out of a method leaves behind: nothing.
def after_an_exception():
    log = []
    class Raises:
        def __add__(self, other): raise ValueError
        def __sub__(self, other): return NotImplemented
        def __rsub__(self, other): raise ValueError
        def __imul__(self, other): return NotImplemented
        def __mul__(self, other): return NotImplemented
    class Other(Raises): pass
    def first(): return noted(Raises()) + noted(Raises())
    def second(): return noted(Raises()) - noted(Other())
    def number(): return 1 - noted(Raises())
    def none():
        x = noted(Raises())
        x *= noted(Raises())
    def caught(f):
        try: f()
        except (ValueError, TypeError) as e: return type(e).__name__
    def caught_here():
        try: return noted(Raises()) + noted(Raises())
        except ValueError: return "here"
    for f in (first, second, number, none) * 3:
        del refs[:]
        r = caught(f)
        gc.collect()
        log.append((r, [x() is not None for x in refs]))
    for _ in range(3):
        del refs[:]
        r = caught_here()
        gc.collect()
        log.append((r, [x() is not None for x in refs]))
    return log
rec("after an exception", after_an_exception)

# The variable that takes the result has its old value until the method has returned, but a temporary has none.
def result_while_methods_run():
    log = []
    class Old: pass
    class Looks:
        def __add__(self, other):
            gc.collect()
            return [r() is not None for r in refs]
        def __rsub__(self, other):
            gc.collect()
            return [r() is not None for r in refs]
    looks = Looks()
    def variable():
        x = noted(Old())
        x = looks + 1
        return x
    def temporary(): return (noted(Old()) is None, looks + 1)
    def reflected(): return (noted(Old()) is None, 1 - looks)
    looks + 1; 1 - looks
    for f in (variable, temporary, reflected) * 3:
        del refs[:]
        log.append(f())
    return log
rec("the result while methods run", result_while_methods_run)

print("\n".join(out))
print(len(out))

print('--- which of two classes has its own idea of the reflected method')
import functools


class FreshEachTime:
    def __get__(self, obj, cls=None):
        gets.append(('fresh', obj is None, cls.__name__))
        return lambda *args: 'reflected'


class SameEachTime:
    def __init__(self):
        self.function = lambda *args: 'reflected'

    def __get__(self, obj, cls=None):
        gets.append(('same', obj is None, cls.__name__))
        return self.function


class EqualEachTime:
    class Result:
        def __call__(self, *args):
            return 'reflected'

        def __eq__(self, other):
            gets.append('==')
            return True

        def __ne__(self, other):
            gets.append('!=')
            return False

        __hash__ = None

    def __get__(self, obj, cls=None):
        return self.Result()


class RaisesForClass:
    def __init__(self, error):
        self.error = error

    def __get__(self, obj, cls=None):
        if obj is None:
            raise self.error('no %s for the class' % cls.__name__)
        return lambda *args: 'reflected'


class NeRaises:
    class Result:
        def __call__(self, *args):
            return 'reflected'

        def __ne__(self, other):
            raise RuntimeError('not to be compared')

    def __get__(self, obj, cls=None):
        return self.Result()


def reflected_function(*args):
    return 'reflected'


DESCRIPTORS = [
    ('fresh', FreshEachTime), ('same', SameEachTime), ('equal', EqualEachTime), ('classmethod', lambda: classmethod(reflected_function)),
    ('staticmethod', lambda: staticmethod(reflected_function)), ('partialmethod', lambda: functools.partialmethod(reflected_function)),
    ('function', lambda: reflected_function), ('attribute error', lambda: RaisesForClass(AttributeError)), ('value error', lambda: RaisesForClass(ValueError)),
    ('!= raises', NeRaises), ('builtin', lambda: int.__radd__), ('callable', lambda: functools.partial(reflected_function)), ('None', lambda: None),
]
for base in (object, int, str, list, float, tuple):
    for name, make in DESCRIPTORS:
        descriptor = make()
        namespace = {'__radd__': descriptor, '__rpow__': descriptor, '__rmatmul__': descriptor}
        if base is object:
            namespace.update(__add__=lambda self, other: 'direct', __pow__=lambda self, other, modulus=None: 'direct', __matmul__=lambda self, other: 'direct')
        Left = type('Left', (base,), namespace)
        Right = type('Right', (Left,), {})
        row = []
        for operation in (lambda: Left() + Right(), lambda: Left() @ Right(), lambda: Left() ** Right(), lambda: pow(Left(), Right(), 5), lambda: Right() + Left()):
            for _ in range(2):
                gets = []
                try:
                    result = operation()
                except Exception as e:
                    result = type(e).__name__
            row.append((result if isinstance(result, str) and result else type(result).__name__, len(gets)))
        print(base.__name__, name, row)


class Meta(type):
    def __getattribute__(cls, name):
        if name == '__radd__':
            asked.append(cls.__name__)
            if cls.__name__ == 'OfMetaDerived':
                return 'something else'
        return type.__getattribute__(cls, name)


class OfMeta(metaclass=Meta):
    def __add__(self, other):
        return 'direct'

    def __radd__(self, other):
        return 'reflected'


class OfMetaDerived(OfMeta):
    pass


class MetaWithAttribute(type):
    __radd__ = property(lambda cls: cls.__name__)


class OfMetaWithAttribute(metaclass=MetaWithAttribute):
    def __add__(self, other):
        return 'direct'

    def __radd__(self, other):
        return 'reflected'


class OfMetaWithAttributeDerived(OfMetaWithAttribute):
    pass


for _ in range(3):
    asked = []
    print(OfMeta() + OfMetaDerived(), OfMetaDerived() + OfMeta(), OfMeta() + OfMeta(), asked)
    print(OfMetaWithAttribute() + OfMetaWithAttributeDerived(), OfMetaWithAttributeDerived() + OfMetaWithAttribute())

print('--- the class of the left operand has the operator from a built-in type, or not at all: nothing is compared')


def attempt(operation):
    del gets[:]
    try:
        result = operation()
    except Exception as e:
        result = '%s: %s' % (type(e).__name__, e)
    return result, list(gets)


class NeverDifferent:
    def __call__(self, *args):
        return 'reflected'

    def __ne__(self, other):
        gets.append('!=')
        return False

    __hash__ = None


for name, make in DESCRIPTORS + [('never different', NeverDifferent), ('static builtin', lambda: staticmethod(int.__radd__))]:
    row = []
    for base, left in ((int, 1), (float, 2.0), (str, 'a'), (list, [1]), (object, object())):
        descriptor = make()
        Derived = type('Derived', (base,), {'__radd__': descriptor, '__rpow__': descriptor, '__rmod__': descriptor, '__rmul__': descriptor})
        Between = type('Between', (base,), {})
        Below = type('Below', (Between,), {'__radd__': descriptor, '__rpow__': descriptor})
        for operation in (lambda: left + Derived(), lambda: left % Derived(), lambda: left * Derived(), lambda: left ** Derived(), lambda: pow(left, Derived(), 5),
                          lambda: Between() + Below(), lambda: pow(Between(), Below(), 5)):
            result, got = attempt(operation)
            row.append((result if isinstance(result, str) and len(result) > 1 else type(result).__name__, len(got)))
    print(name, row)

print('--- code of the program runs while the question is asked')


class Hook(type):
    def __getattribute__(cls, name):
        value = type.__getattribute__(cls, name)
        if name in ('__radd__', '__rpow__'):
            gets.append((cls.__name__, name))
            if hook:
                hook.pop()(cls)
        return value


class HookForMissing(type):
    def __getattr__(cls, name):
        gets.append(('missing', cls.__name__, name))
        if supplies:
            return cls.__name__
        raise AttributeError(name)


def classes(metaclass, with_reflected=True):
    class Upper(metaclass=metaclass):
        def __add__(self, other):
            return 'Upper.__add__'

        def __pow__(self, other, modulus=None):
            return 'Upper.__pow__'

    class Lower(Upper):
        if with_reflected:
            def __radd__(self, other):
                return 'Lower.__radd__ of ' + type(self).__name__

            def __rpow__(self, other, modulus=None):
                return 'Lower.__rpow__ of ' + type(self).__name__

    class Sibling(Upper):
        def __radd__(self, other):
            return 'Sibling.__radd__ of ' + type(self).__name__

        def __rpow__(self, other, modulus=None):
            return 'Sibling.__rpow__ of ' + type(self).__name__

    return Upper, Lower, Sibling


def replaces(cls):
    type.__setattr__(Lower, '__radd__', lambda self, other: 'new __radd__')
    type.__setattr__(Lower, '__rpow__', lambda self, other, modulus=None: 'new __rpow__')


def deletes(cls):
    type.__delattr__(Lower, '__radd__')
    type.__delattr__(Lower, '__rpow__')


def changes_class(cls):
    right.__class__ = Sibling


def changes_left(cls):
    left_operand.__class__ = Sibling


def raises(cls):
    raise RuntimeError('from the hook')


def raises_attribute_error(cls):
    raise AttributeError('from the hook')


for action in (None, replaces, deletes, changes_class, changes_left, raises, raises_attribute_error):
    for operation in (lambda: left_operand + right, lambda: pow(left_operand, right, 5), lambda: left_operand ** right):
        Upper, Lower, Sibling = classes(Hook)
        left_operand, right = Upper(), Lower()
        hook = [action] if action else []
        print(action and action.__name__, attempt(operation))
hook = []
Upper, Lower, Sibling = classes(Hook, with_reflected=False)
print(attempt(lambda: Upper() + Lower()), attempt(lambda: pow(Upper(), Lower(), 5)), attempt(lambda: Upper() + Upper()), attempt(lambda: Lower() + Upper()))
for supplies in (False, True):
    Upper, Lower, Sibling = classes(HookForMissing, with_reflected=False)
    print(attempt(lambda: Upper() + Lower()), attempt(lambda: pow(Upper(), Lower(), 5)), attempt(lambda: Upper() + Sibling()))

print('--- the operands are of one class, or of unrelated ones, once the question has been asked')


def classes_with_both(metaclass):
    class Upper(metaclass=metaclass):
        def __add__(self, other):
            return 'Upper.__add__ of ' + type(self).__name__

        def __radd__(self, other):
            return 'Upper.__radd__ of ' + type(self).__name__

        def __pow__(self, other, modulus=None):
            return 'Upper.__pow__ of ' + type(self).__name__

        def __rpow__(self, other, modulus=None):
            return 'Upper.__rpow__ of ' + type(self).__name__

    class Lower(Upper):
        def __radd__(self, other):
            return 'Lower.__radd__ of ' + type(self).__name__

        def __rpow__(self, other, modulus=None):
            return 'Lower.__rpow__ of ' + type(self).__name__

    class Unrelated(metaclass=metaclass):
        def __add__(self, other):
            return 'Unrelated.__add__ of ' + type(self).__name__

        def __radd__(self, other):
            return 'Unrelated.__radd__ of ' + type(self).__name__

        def __pow__(self, other, modulus=None):
            return 'Unrelated.__pow__ of ' + type(self).__name__

        def __rpow__(self, other, modulus=None):
            return 'Unrelated.__rpow__ of ' + type(self).__name__

    class Bare(metaclass=metaclass):
        pass

    return Upper, Lower, Unrelated, Bare


ACTIONS = [
    ('right becomes Upper', lambda: setattr(right, '__class__', Upper)), ('left becomes Lower', lambda: setattr(left_operand, '__class__', Lower)),
    ('right becomes Unrelated', lambda: setattr(right, '__class__', Unrelated)), ('left becomes Unrelated', lambda: setattr(left_operand, '__class__', Unrelated)),
    ('right becomes Bare', lambda: setattr(right, '__class__', Bare)), ('left becomes Bare', lambda: setattr(left_operand, '__class__', Bare)),
    ('Upper loses its methods', lambda: (type.__delattr__(Upper, '__add__'), type.__delattr__(Upper, '__pow__'))),
    ('Lower says NotImplemented', lambda: (type.__setattr__(Lower, '__radd__', lambda self, other: NotImplemented), type.__setattr__(Lower, '__rpow__', lambda self, other, modulus=None: NotImplemented))),
]
for name, action in ACTIONS:
    for at_the_second_question in (False, True):
        for operation in (lambda: left_operand + right, lambda: pow(left_operand, right, 5), lambda: left_operand ** right):
            Upper, Lower, Unrelated, Bare = classes_with_both(Hook)
            left_operand, right = Upper(), Lower()
            hook = [lambda cls, action=action: action()]
            if at_the_second_question:
                hook.append(lambda cls: None)
            print(name, at_the_second_question, attempt(operation))
hook = []

print('--- what was known of the classes is forgotten while the question is asked')


class Forgetful(type):
    def __getattribute__(cls, name):
        if name in ('__radd__', '__rpow__'):
            type.__setattr__(cls, 'touched', 1)
        return type.__getattribute__(cls, name)


class OddKey:
    def __hash__(self):
        return hash('__add__')

    def __eq__(self, other):
        return False


Upper = Forgetful('Upper', (), {OddKey(): 1, 5: 6, '__add__': lambda self, other: 'Upper.__add__', '__pow__': lambda self, other, modulus=None: 'Upper.__pow__'})
Lower = Forgetful('Lower', (Upper,), {7: 8, '__radd__': lambda self, other: 'Lower.__radd__', '__rpow__': lambda self, other, modulus=None: 'Lower.__rpow__'})
x = Upper()
x += Lower()
print(Upper() + Lower(), Upper() ** Lower(), pow(Upper(), Lower(), 3), x)

print('--- only one of the two classes has the operator from Python code')


class RaisesWhenTheClassIsAsked:
    def __get__(self, obj, cls=None):
        if obj is None:
            raise ValueError('asked of the class ' + cls.__name__)
        return lambda *args: 'reflected'


import operator


class WithPython:
    def __add__(self, other):
        return 'WithPython.__add__'

    def __pow__(self, other, modulus=None):
        return 'WithPython.__pow__'

    __radd__ = __rpow__ = RaisesWhenTheClassIsAsked()


class IntFirst(int, WithPython):
    pass


class FunctionsOfC:
    __add__ = operator.concat
    __radd__ = int.__radd__


class BelowFunctionsOfC(FunctionsOfC):
    __radd__ = RaisesWhenTheClassIsAsked()


class RaisingMeta(type):
    def __getattribute__(cls, name):
        if name == '__radd__':
            raise ValueError('the metaclass of ' + cls.__name__)
        return type.__getattribute__(cls, name)


class LenAsAdd(metaclass=RaisingMeta):
    __add__ = len


class BelowLenAsAdd(LenAsAdd):
    def __radd__(self, other):
        return 'BelowLenAsAdd.__radd__'


class QuietMeta(type):
    pass


class OfQuietMeta(metaclass=QuietMeta):
    def __add__(self, other):
        return 'direct'

    def __radd__(self, other):
        return 'reflected'


class OfQuietMetaInherits(OfQuietMeta):
    pass


class OfQuietMetaOverrides(OfQuietMeta):
    def __radd__(self, other):
        return 'its own'


for _ in range(2):
    print(attempt(lambda: WithPython() + IntFirst()), attempt(lambda: WithPython() ** IntFirst()), attempt(lambda: pow(WithPython(), IntFirst(), 3)))
    print(attempt(lambda: FunctionsOfC() + BelowFunctionsOfC()), attempt(lambda: LenAsAdd() + BelowLenAsAdd()))
    print(OfQuietMeta() + OfQuietMetaInherits(), OfQuietMeta() + OfQuietMetaOverrides(), OfQuietMetaInherits() + OfQuietMeta())
