# A code object is one object for as long as the code is there: programs keep weak references to it and tables by its id().
import gc, marshal, sys, threading, types, weakref

def f():
    return sys._getframe().f_code

print(f.__code__ is f.__code__, f() is f.__code__)
before = id(f.__code__)
ref = weakref.ref(f.__code__)
table = weakref.WeakKeyDictionary({f.__code__: "f"})
for _ in range(3):
    gc.collect()
print(id(f.__code__) == before, ref() is f.__code__, table.get(f.__code__), len(table))

class C:
    def method(self):
        return sys._getframe().f_code
    @staticmethod
    def static():
        return sys._getframe().f_code
    @property
    def prop(self):
        return sys._getframe().f_code
refs = [weakref.ref(C.method.__code__), weakref.ref(C.static.__code__), weakref.ref(C.prop.fget.__code__)]
gc.collect()
print([r() is not None for r in refs], C().method() is refs[0](), C.static() is refs[1](), C().prop is refs[2]())

# Functions made from the same code have the same code object, which is a constant of the code around them.
def outer():
    def inner():
        return sys._getframe().f_code
    return inner
first = outer().__code__
gc.collect()
print(outer().__code__ is first, outer()() is first, [c is first for c in outer.__code__.co_consts if isinstance(c, types.CodeType)])
lambdas = [lambda: sys._getframe().f_code for _ in range(3)]
print(len({id(l.__code__) for l in lambdas}), lambdas[0]() is lambdas[2].__code__)

# Whatever shows the code shows that object.
def gen():
    yield sys._getframe().f_code
g = gen()
print(g.gi_code is gen.__code__, g.gi_frame.f_code is gen.__code__, next(g) is gen.__code__)
async def coro():
    return sys._getframe().f_code
c = coro()
print(c.cr_code is coro.__code__, c.cr_frame.f_code is coro.__code__)
try:
    c.send(None)
except StopIteration as e:
    print(e.value is coro.__code__)
async def agen():
    yield 1
a = agen()
print(a.ag_code is agen.__code__, a.ag_frame.f_code is agen.__code__)
def raises():
    1 / 0
try:
    raises()
except ZeroDivisionError as e:
    print(e.__traceback__.tb_next.tb_frame.f_code is raises.__code__, e.__traceback__.tb_frame.f_code is sys._getframe().f_code)

# A weak reference lives as long as anything that shows the code.
def make():
    def temporary():
        yield 1
    return temporary
t = make()
r = weakref.ref(t.__code__)
it = t()
del t
gc.collect()
print(r() is it.gi_code)

# Assigning code.
def h(): return 1
def k(): return 2
h.__code__ = k.__code__
gc.collect()
print(h.__code__ is k.__code__, h())

# compile(), exec(), marshal: new objects, each stable.
code = compile("def x(): pass\ny = x.__code__", "<s>", "exec")
ns = {}
exec(code, ns)
gc.collect()
print(ns["x"].__code__ is ns["y"], [k is ns["y"] for k in code.co_consts if isinstance(k, types.CodeType)])
copy = marshal.loads(marshal.dumps(f.__code__))
print(copy is f.__code__, copy == f.__code__)
replaced = f.__code__.replace(co_name="other")
print(replaced is f.__code__, replaced.co_name, f.__code__.co_name)

# In another thread.
seen = []
thread = threading.Thread(target=lambda: seen.append(f()))
thread.start(); thread.join()
print(seen[0] is f.__code__)

# Nothing is kept for ever: code goes with the last thing that shows it.
dead = []
for i in range(5):
    ns = {}
    exec(f"def fn{i}():\n    def nested(): pass\n    return nested", ns)
    fn = ns[f"fn{i}"]
    dead.append(weakref.ref(fn.__code__))
    dead.append(weakref.ref(fn().__code__))
del ns, fn
gc.collect()
print([r() for r in dead])

# What a tracer reads for every line is not made anew each time.
print(f.__code__.co_code is f.__code__.co_code, type(f.__code__.co_code).__name__)

# An engine may drop what it made of code that has not run for a while, and make it again. (The variable asks one engine to do so at once.)
import os, subprocess
program = """
import gc
def outer():
    def inner(): pass
    return inner
first = outer().__code__
for _ in range(3): gc.collect()
print(outer().__code__ is first, [c is first for c in outer.__code__.co_consts if isinstance(c, type(first))])
"""
print(subprocess.run([sys.executable, "-c", program], env=dict(os.environ, BUN_JSC_forceCodeBlockToJettisonDueToOldAge="1"), capture_output=True, text=True).stdout)
