# code.replace() that takes effect, function.__code__ = code, code(...) from the attributes of a code object, co_code.
# (jinja2, hypothesis, networkx and cloudpickle do these.)
import sys, traceback, types, dis, inspect, warnings
def frames(thunk):
    try:
        thunk()
    except Exception:
        return [(f.filename.rpartition("/")[2], f.lineno, f.name) for f in traceback.extract_tb(sys.exc_info()[2])][1:]
code = compile("\n\nraise ValueError('x')", "<template>", "exec")
c2 = code.replace(co_name="top-level template code")
print(c2.co_name, code.co_name, c2.co_filename, c2.co_qualname, c2.co_firstlineno)
print(frames(lambda: exec(c2, {})), frames(lambda: exec(code, {})))
def f(a, b=2):
    raise KeyError(a + b)
g = types.FunctionType(f.__code__.replace(co_name="other", co_filename="elsewhere.py", co_firstlineno=100, co_qualname="Q.other"), globals(), argdefs=(5,))
print(frames(lambda: g(1)), g.__name__, g.__qualname__, g.__code__.co_qualname, g.__code__.co_firstlineno, list(g.__code__.co_lines())[-1][2], f.__code__.co_firstlineno == 100)
print(frames(lambda: f(1))[-1][2], f.__code__.co_name, g.__code__ is g.__code__, f.__code__.replace() == f.__code__, f.__code__.replace(co_name="z") == f.__code__)
c3 = g.__code__.replace(co_firstlineno=200); print(c3.co_firstlineno, c3.co_name, c3.co_filename, list(c3.co_lines())[-1][2])
def seen():
    return sys._getframe().f_code
h = types.FunctionType(seen.__code__.replace(co_name="renamed"), globals()); print(h() is h.__code__, h().co_name, seen() is seen.__code__)
def gen():
    yield sys._getframe().f_code.co_name
    raise ValueError
k = types.FunctionType(gen.__code__.replace(co_name="gen2", co_filename="g.py"), globals()); it = k(); print(next(it), it.gi_code.co_name, it.gi_code is k.__code__, frames(lambda: next(it)))

# function.__code__ = code
def one(x): return x + 1
def two(x): return x * 2
def caller(fn, n): return [fn(i) for i in range(n)]
print(caller(one, 3)); one.__code__ = two.__code__; print(caller(one, 3), one(10), one.__name__, one.__code__ is two.__code__, one.__code__.co_name)
def lazy(*args, **kwargs):
    lazy.__code__ = real.__code__; lazy.__defaults__ = real.__defaults__; lazy.__kwdefaults__ = real.__kwdefaults__
    return lazy(*args, **kwargs)
def real(a, b=3, *, c=4): return (a, b, c)
print(lazy(1), lazy(1, 2, c=5), inspect.signature(lazy))
def outer(v):
    def inner(): return v
    return inner
i1 = outer(1)
def outer2(w):
    def inner2(): return w * 100
    return inner2
i1.__code__ = outer2(0).__code__; print(i1(), i1.__closure__[0].cell_contents, i1.__code__.co_freevars)
for bad in (one.__code__, 5):
    try: i1.__code__ = bad
    except (ValueError, TypeError) as e: print(type(e).__name__, e)
try: del one.__code__
except TypeError as e: print(e)
class C:
    def m(self): return "m"
    def n(self): return "n"
c = C(); print([c.m() for _ in range(3)]); C.m.__code__ = C.n.__code__; print([c.m() for _ in range(3)], C.m.__name__)
def plain(): return 1
def generator(): yield 2
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always"); plain.__code__ = generator.__code__; print([str(x.message)[:40] for x in w], list(plain()))
def rec(n): return 0 if n == 0 else 1 + rec(n - 1)
def rec10(n): return 0 if n == 0 else 10 + rec(n - 1)
print(rec(3)); rec.__code__ = rec10.__code__; print(rec(3))
def swaps_itself():
    swaps_itself.__code__ = two.__code__
    return "still the old code"
print(swaps_itself(), swaps_itself(4))

# code(...) puts together what a code object was taken apart into
names = "argcount posonlyargcount kwonlyargcount nlocals stacksize flags code consts names varnames filename name qualname firstlineno linetable exceptiontable freevars cellvars".split()
G = 7
def sample(a, /, b, *, c=1):
    "doc"
    d = [a + b + c + G for _ in range(2)]
    def nested(): return d
    return nested()
parts = [getattr(sample.__code__, "co_" + n) for n in names]
again = types.CodeType(*parts); fn = types.FunctionType(again, globals(), "sample", None, None); fn.__kwdefaults__ = {"c": 1}
print(fn(1, 2), again == sample.__code__, again is sample.__code__, again.co_name, sorted(again.co_varnames), again.co_consts[0], [type(x).__name__ for x in again.co_consts])
parts[names.index("name")] = "renamed"; parts[names.index("filename")] = "f.py"; print(types.CodeType(*parts).co_name, types.CodeType(*parts).co_filename)
for n, v in (("argcount", "x"), ("filename", 1)):
    p = list(parts); p[names.index(n)] = v
    try: types.CodeType(*p)
    except TypeError as e: print("TypeError")
try: types.CodeType()
except TypeError as e: print("TypeError")

# co_code tells code apart, and says which names the code uses
ident = lambda x: x
print(ident.__code__.co_code == (lambda y: y).__code__.co_code, ident.__code__.co_code == (lambda y: y + 1).__code__.co_code, ident.__code__.co_code == (lambda y: -y).__code__.co_code, ident.__code__.co_code == (lambda y: f(y)).__code__.co_code, type(ident.__code__.co_code).__name__, len(ident.__code__.co_code) % 2)
import os
def uses(x):
    global written
    written = len(x) + G
    return os.path.join(str(x), x.attr.deeper)
ops = {}
for ins in dis.get_instructions(uses):
    if ins.opname in ("LOAD_GLOBAL", "STORE_GLOBAL", "LOAD_ATTR", "STORE_ATTR", "LOAD_NAME", "STORE_NAME"): ops.setdefault(ins.opname, []).append(ins.argval)
print({k: sorted(set(v)) for k, v in sorted(ops.items())})
cv = inspect.getclosurevars(uses); print(sorted(cv.globals), sorted(cv.builtins), sorted(cv.unbound), cv.nonlocals)
print(sorted({i.argval for i in dis.get_instructions(compile("a = b.c\nimport q\nd.e = a", "<s>", "exec")) if i.opname in ("LOAD_NAME", "STORE_NAME", "LOAD_ATTR", "STORE_ATTR")}))
