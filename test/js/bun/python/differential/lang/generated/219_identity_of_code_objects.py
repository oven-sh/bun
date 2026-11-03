# A code object is one object for as long as the code is there: programs keep weak references to it and tables by its id().
try: import gc, marshal, sys, threading, types, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, marshal, sys, threading, types, weakref')

try:
    def f():
        return sys._getframe().f_code
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f():')

try: print('f.__code__ is f.__code__ =>', f.__code__ is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__ is f.__code__')
try: print('f() is f.__code__ =>', f() is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f() is f.__code__')
try: before = id(f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before = id(f.__code__)')
try: ref = weakref.ref(f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ref = weakref.ref(f.__code__)')
try: table = weakref.WeakKeyDictionary({f.__code__: "f"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: table = weakref.WeakKeyDictionary({f.__code__: "f"})')
try:
    for _ in range(3):
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(3):')
try: print('id(f.__code__) == before =>', id(f.__code__) == before)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: id(f.__code__) == before')
try: print('ref() is f.__code__ =>', ref() is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ref() is f.__code__')
try: print('table.get(f.__code__) =>', table.get(f.__code__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: table.get(f.__code__)')
try: print('len(table) =>', len(table))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(table)')

try:
    class C:
        def method(self):
            return sys._getframe().f_code
        @staticmethod
        def static():
            return sys._getframe().f_code
        @property
        def prop(self):
            return sys._getframe().f_code
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: refs = [weakref.ref(C.method.__code__), weakref.ref(C.static.__code__), weakref.ref(C.prop.fget.__code__)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refs = [weakref.ref(C.method.__code__), weakref.ref(C.static.__code__...')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('[r() is not None for r in refs] =>', [r() is not None for r in refs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r() is not None for r in refs]')
try: print('C().method() is refs[0]() =>', C().method() is refs[0]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C().method() is refs[0]()')
try: print('C.static() is refs[1]() =>', C.static() is refs[1]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.static() is refs[1]()')
try: print('C().prop is refs[2]() =>', C().prop is refs[2]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C().prop is refs[2]()')

# Functions made from the same code have the same code object, which is a constant of the code around them.
try:
    def outer():
        def inner():
            return sys._getframe().f_code
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: first = outer().__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = outer().__code__')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('outer().__code__ is first =>', outer().__code__ is first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer().__code__ is first')
try: print('outer()() is first =>', outer()() is first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer()() is first')
try: print('[c is first for c in outer.__code__.co_consts if isinstance(c, types.... =>', [c is first for c in outer.__code__.co_consts if isinstance(c, types.CodeType)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c is first for c in outer.__code__.co_consts if isinstance(c, types....')
try: lambdas = [lambda: sys._getframe().f_code for _ in range(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lambdas = [lambda: sys._getframe().f_code for _ in range(3)]')
try: print('len({id(l.__code__) for l in lambdas}) =>', len({id(l.__code__) for l in lambdas}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({id(l.__code__) for l in lambdas})')
try: print('lambdas[0]() is lambdas[2].__code__ =>', lambdas[0]() is lambdas[2].__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lambdas[0]() is lambdas[2].__code__')

# Whatever shows the code shows that object.
try:
    def gen():
        yield sys._getframe().f_code
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: print('g.gi_code is gen.__code__ =>', g.gi_code is gen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_code is gen.__code__')
try: print('g.gi_frame.f_code is gen.__code__ =>', g.gi_frame.f_code is gen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_code is gen.__code__')
try: print('next(g) is gen.__code__ =>', next(g) is gen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g) is gen.__code__')
try:
    async def coro():
        return sys._getframe().f_code
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def coro():')
try: c = coro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = coro()')
try: print('c.cr_code is coro.__code__ =>', c.cr_code is coro.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_code is coro.__code__')
try: print('c.cr_frame.f_code is coro.__code__ =>', c.cr_frame.f_code is coro.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_frame.f_code is coro.__code__')
try:
    try:
        c.send(None)
    except StopIteration as e:
        print(e.value is coro.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    async def agen():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')
try: a = agen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = agen()')
try: print('a.ag_code is agen.__code__ =>', a.ag_code is agen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_code is agen.__code__')
try: print('a.ag_frame.f_code is agen.__code__ =>', a.ag_frame.f_code is agen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_frame.f_code is agen.__code__')
try:
    def raises():
        1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises():')
try:
    try:
        raises()
    except ZeroDivisionError as e:
        print('e.__traceback__.tb_next.tb_frame.f_code is raises.__code__ =>', e.__traceback__.tb_next.tb_frame.f_code is raises.__code__)
        print('e.__traceback__.tb_frame.f_code is sys._getframe().f_code =>', e.__traceback__.tb_frame.f_code is sys._getframe().f_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

# A weak reference lives as long as anything that shows the code.
try:
    def make():
        def temporary():
            yield 1
        return temporary
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make():')
try: t = make()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = make()')
try: r = weakref.ref(t.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = weakref.ref(t.__code__)')
try: it = t()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = t()')
try: del t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del t')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(r() is it.gi_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is it.gi_code')

# Assigning code.
try:
    def h(): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h(): return 1')
try:
    def k(): return 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def k(): return 2')
try: h.__code__ = k.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.__code__ = k.__code__')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('h.__code__ is k.__code__ =>', h.__code__ is k.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.__code__ is k.__code__')
try: print('h() =>', h())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h()')

# compile(), exec(), marshal: new objects, each stable.
try: code = compile("def x(): pass\ny = x.__code__", "<s>", "exec")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile("def x(): pass\\ny = x.__code__", "<s>", "exec")')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec(code, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(code, ns)')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('ns["x"].__code__ is ns["y"] =>', ns["x"].__code__ is ns["y"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["x"].__code__ is ns["y"]')
try: print('[k is ns["y"] for k in code.co_consts if isinstance(k, types.CodeType)] =>', [k is ns["y"] for k in code.co_consts if isinstance(k, types.CodeType)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [k is ns["y"] for k in code.co_consts if isinstance(k, types.CodeType)]')
try: copy = marshal.loads(marshal.dumps(f.__code__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: copy = marshal.loads(marshal.dumps(f.__code__))')
try: print('copy is f.__code__ =>', copy is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: copy is f.__code__')
try: print('copy == f.__code__ =>', copy == f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: copy == f.__code__')
try: replaced = f.__code__.replace(co_name="other")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replaced = f.__code__.replace(co_name="other")')
try: print('replaced is f.__code__ =>', replaced is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replaced is f.__code__')
try: print('replaced.co_name =>', replaced.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replaced.co_name')
try: print('f.__code__.co_name =>', f.__code__.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_name')

# In another thread.
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try: thread = threading.Thread(target=lambda: seen.append(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread = threading.Thread(target=lambda: seen.append(f()))')
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try: thread.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.join()')
try: print(seen[0] is f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen[0] is f.__code__')

# Nothing is kept for ever: code goes with the last thing that shows it.
try: dead = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dead = []')
try:
    for i in range(5):
        try: ns = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
        try: exec(f"def fn{i}():\n    def nested(): pass\n    return nested", ns)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(f"def fn{i}():\\n def nested(): pass\\n return nested", ns)')
        try: fn = ns[f"fn{i}"]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fn = ns[f"fn{i}"]')
        try: dead.append(weakref.ref(fn.__code__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dead.append(weakref.ref(fn.__code__))')
        try: dead.append(weakref.ref(fn().__code__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dead.append(weakref.ref(fn().__code__))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(5):')
try: del ns, fn
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ns, fn')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print([r() for r in dead])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r() for r in dead]')

# What a tracer reads for every line is not made anew each time.
try: print('f.__code__.co_code is f.__code__.co_code =>', f.__code__.co_code is f.__code__.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_code is f.__code__.co_code')
try: print('type(f.__code__.co_code).__name__ =>', type(f.__code__.co_code).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f.__code__.co_code).__name__')

# An engine may drop what it made of code that has not run for a while, and make it again. (The variable asks one engine to do so at once.)
try: import os, subprocess
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os, subprocess')
try: program = """
import gc
def outer():
    def inner(): pass
    return inner
first = outer().__code__
for _ in range(3): gc.collect()
print(outer().__code__ is first, [c is first for c in outer.__code__.co_consts if isinstance(c, type(first))])
"""
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: program = """ import gc def outer(): def inner(): pass return inner f...')
try: print(subprocess.run([sys.executable, "-c", program], env=dict(os.environ, BUN_JSC_forceCodeBlockToJettisonDueToOldAge="1"), capture_output=True, text=True).stdout)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: subprocess.run([sys.executable, "-c", program], env=dict(os.environ, ...')
