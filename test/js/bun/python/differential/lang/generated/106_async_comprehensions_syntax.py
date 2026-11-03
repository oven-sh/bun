try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def run(coro):
        steps = []
        try:
            while True: steps.append(coro.send(None))
        except StopIteration as e:
            return (steps, e.value) if steps else e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(coro):')
try:
    class Suspend:
        def __init__(s, tag): s.tag = tag
        def __await__(s):
            r = yield s.tag
            return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Suspend:')
try:
    async def arange(n):
        for i in range(n): yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def arange(n):')
try:
    async def val(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def val(v): return v')
try:
    async def collect(x): return [v async for v in x]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def collect(x): return [v async for v in x]')

try:
    async def c1(): return [x async for x in arange(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c1(): return [x async for x in arange(3)]')
try:
    async def c2(): return {x async for x in arange(3)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c2(): return {x async for x in arange(3)}')
try:
    async def c3(): return {x: x * 2 async for x in arange(3)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c3(): return {x: x * 2 async for x in arange(3)}')
try:
    async def c4(): return [x async for x in arange(6) if x % 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c4(): return [x async for x in arange(6) if x % 2]')
try:
    async def c5(): return [(x, y) async for x in arange(2) async for y in arange(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c5(): return [(x, y) async for x in arange(2) async for y i...')
try:
    async def c6(): return [(x, y) async for x in arange(2) for y in range(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c6(): return [(x, y) async for x in arange(2) for y in rang...')
try:
    async def c7(): return [(x, y) for x in range(2) async for y in arange(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c7(): return [(x, y) for x in range(2) async for y in arang...')
try:
    async def c8(): return [await val(x) for x in range(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c8(): return [await val(x) for x in range(3)]')
try:
    async def c9(): return [await val(x) async for x in arange(3) if await val(x % 2 == 0)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c9(): return [await val(x) async for x in arange(3) if awai...')
try:
    async def c10(): return [x for x in await val([1, 2])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c10(): return [x for x in await val([1, 2])]')
try:
    async def c11(): return {await val(k): await val(v) for k, v in [("a", 1)]}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c11(): return {await val(k): await val(v) for k, v in [("a"...')
try:
    async def c12(): return [[y async for y in arange(x)] async for x in arange(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c12(): return [[y async for y in arange(x)] async for x in ...')
try:
    async def c13(): return [[await val(y) for y in range(x)] for x in range(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c13(): return [[await val(y) for y in range(x)] for x in ra...')
try:
    async def c14(): return sum([x async for x in arange(4)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c14(): return sum([x async for x in arange(4)])')
try:
    async def c15(): return [a + b async for a, b in pairs()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c15(): return [a + b async for a, b in pairs()]')
try:
    async def pairs():
        yield 1, 2
        yield 3, 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def pairs():')
try:
    async def c16(): return [x async for x in arange(0)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c16(): return [x async for x in arange(0)]')
try:
    async def c17(): return [await Suspend(x) for x in "ab"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c17(): return [await Suspend(x) for x in "ab"]')
try:
    async def c18(): return [(y := x * 2) async for x in arange(3)], y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c18(): return [(y := x * 2) async for x in arange(3)], y')
try:
    async def c19(): return [*[x async for x in arange(2)], *[await val(9)]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c19(): return [*[x async for x in arange(2)], *[await val(9)]]')
try:
    async def c20(): return [*x async for x in lists()], {**d async for d in dicts()}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c20(): return [*x async for x in lists()], {**d async for d...')
try:
    async def lists():
        yield [1, 2]
        yield [3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def lists():')
try:
    async def dicts():
        yield {"a": 1}
        yield {"b": 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def dicts():')
try:
    for f in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19, c20): t(lambda: run(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14...')
# Asynchronous generator expressions.
try:
    async def g1():
        g = (x * 2 async for x in arange(3))
        return type(g).__name__, g.__name__, [v async for v in g]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g1():')
try:
    async def g2():
        g = (await val(x) for x in range(3))
        return type(g).__name__, [v async for v in g]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g2():')
try:
    async def g3():
        g = (x for x in range(3))
        return type(g).__name__, list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g3():')
try:
    async def g4():
        g = (x for x in await val([1, 2]))
        return type(g).__name__, list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g4():')
try:
    async def g5():
        g = ((x, y) for x in range(2) async for y in arange(2))
        return type(g).__name__, [v async for v in g]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g5():')
try:
    async def g6():
        g = (x async for x in arange(3) if await val(x))
        return await collect(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g6():')
try:
    async def g7(): return await collect(x + 1 async for x in arange(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def g7(): return await collect(x + 1 async for x in arange(2))')
try:
    for f in (g1, g2, g3, g4, g5, g6, g7): t(lambda: run(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (g1, g2, g3, g4, g5, g6, g7): t(lambda: run(f()))')
try:
    def sync_makes_asyncgen():
        g = (x async for x in arange(2))
        return type(g).__name__, run(collect(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sync_makes_asyncgen():')
try: print(sync_makes_asyncgen())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sync_makes_asyncgen()')
try: gexp = (x async for x in arange(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gexp = (x async for x in arange(2))')
try: print('type(gexp).__name__ =>', type(gexp).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(gexp).__name__')
try: print('run(collect(gexp)) =>', run(collect(gexp)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(gexp))')
# Errors at run time.
try:
    async def e1(): return [x async for x in [1, 2]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e1(): return [x async for x in [1, 2]]')
try:
    async def e2(): return [x async for x in 5]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e2(): return [x async for x in 5]')
try:
    async def e3(): return [x for x in arange(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e3(): return [x for x in arange(2)]')
try:
    async def e4(): return [await x for x in [1]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e4(): return [await x for x in [1]]')
try:
    async def e5(): return [x async for x in arange(3) if 1 / (x - 1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e5(): return [x async for x in arange(3) if 1 / (x - 1)]')
try:
    async def e6(): return list(x async for x in arange(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e6(): return list(x async for x in arange(2))')
try:
    async def e7(): return sum(await val(x) for x in range(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e7(): return sum(await val(x) for x in range(2))')
try:
    async def e8(): return [x async for x in undefined_name]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e8(): return [x async for x in undefined_name]')
try:
    async def e9():
        g = (x async for x in 5)
        return "the outermost iterable is checked eagerly"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e9():')
try:
    async def e10(): return [x async for x in arange]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def e10(): return [x async for x in arange]')
try:
    for f in (e1, e2, e3, e4, e5, e6, e7, e8, e9, e10): t(lambda: run(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (e1, e2, e3, e4, e5, e6, e7, e8, e9, e10): t(lambda: run(f()))')
# Scope.
try:
    async def s1():
        x = "outer"
        r = [x async for x in arange(2)]
        return r, x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def s1():')
try:
    async def s2():
        fs = [lambda: x async for x in arange(3)]
        return [f() for f in fs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def s2():')
try:
    async def s3():
        k = 10
        return [x + k async for x in arange(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def s3():')
try: print('run(s1()) =>', run(s1()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(s1())')
try: print('run(s2()) =>', run(s2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(s2())')
try: print('run(s3()) =>', run(s3()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(s3())')
# Syntax.
try:
    for src in ("await x", "x = await y", "def f(): await x", "def f(): return await x", "lambda: await x", "async def f(): await x", "async def f(): await", "async def f(): await x y", "async def f(): await await x", "async def f(): return await x", "async def f(): x = await", "async def f(): await = 1", "async def f(): await x = 1", "async def f(): (await x) = 1", "async def f(): await x += 1", "async def f(): del await x", "async def f(): await -x", "async def f(): -await x", "async def f(): await x ** 2", "async def f(): 2 ** await x", "async def f(): await not x", "async def f(): not await x", "async def f(): await x.y", "async def f(): await x()", "async def f(): await x[0]", "async def f(): (await x)()", "async def f(): await (x, y)", "async def f(): await x, y", "async def f(): await lambda: 1", "async def f(): await (lambda: 1)", "async def f(): await x if y else z", "async def f(): await *x", "async def f(): await yield", "async def f(): await (yield)", "async def f(): yield await x", "async def f(): await x + await y", "async def f(): f(await x)", "async def f(): f(a=await x)", "async def f(): f(*await x)", "async def f(): f(**await x)", "async def f(): [await x]", "async def f(): {await x: await y}", "async def f(): x[await y]", "async def f(): f'{await x}'", "async def f(): await f'{x}'", "async def f(): (x := await y)", "async def f(): await (x := y)", "async def f(): await x := y", "async def f(x=await y): pass", "async def g():\n async def f(x=await y): pass", "async def g():\n def f(x=await y): pass", "async def g():\n def f(): await y", "async def g():\n lambda: await y", "async def g():\n class C: await y", "async def g():\n class C:\n  x = await y", "async def g():\n @await y\n def f(): pass", "async def g():\n class C(await y): pass", "async def f(x: await y): pass", "async def f() -> await y: pass", "class C: await x", "class C:\n async def f(self): await x",
                "async def f(): pass", "async  def f(): pass", "async\ndef f(): pass", "async def f(): return", "async def f(): return 1", "async def f(): yield", "async def f(): yield 1", "async def f(): yield; return", "async def f(): yield; return 1", "async def f(): return 1; yield", "async def f(): yield from x", "async def f(): x = yield from y", "async def f(): await x; yield from y", "async def f():\n def g(): yield from x", "async f(): pass", "async def: pass", "async def f: pass", "async def f()", "async lambda: 1", "async class C: pass", "async x = 1", "async", "async = 1", "await = 1", "def async(): pass", "def await(): pass", "x.async", "x.await", "import async", "async.x", "print(async)", "async if x: pass", "async while x: pass", "async try: pass\nfinally: pass", "async match x:\n case 1: pass", "@d\nasync def f(): pass", "async @d\ndef f(): pass", "async def f[T](): pass", "async def f(): global x", "async def f(): nonlocal x",
                "async with x: pass", "async for x in y: pass", "def f():\n async with x: pass", "def f():\n async for x in y: pass", "async def f():\n async with x: pass", "async def f():\n async for x in y: pass", "async def f():\n async with x as y: pass", "async def f():\n async with x as y, z as w: pass", "async def f():\n async with (x as y, z as w): pass", "async def f():\n async with: pass", "async def f():\n async with x", "async def f():\n async with x as 1: pass", "async def f():\n async for in y: pass", "async def f():\n async for x y: pass", "async def f():\n async for x in: pass", "async def f():\n async for x in y: pass\n else: pass", "async def f():\n async for 1 in y: pass", "async def f():\n async for x, y in z: pass", "async def f():\n async for x in y, z: pass", "async def f():\n async for x in *y, z: pass", "async def f():\n async for *x in y: pass", "async def f():\n async for x in y: break", "async def f():\n async for x in y: continue", "async def f():\n async  with  x: pass", "async def f():\n async\\\n with x: pass", "async def f():\n def g():\n  async with x: pass", "async def f():\n lambda: [x async for x in y]", "class C:\n async with x: pass", "class C:\n async for x in y: pass", "async def f():\n with await x: pass", "async def f():\n for x in await y: pass", "async def f():\n await async with x: pass",
                "[x async for x in y]", "{x async for x in y}", "{x: x async for x in y}", "(x async for x in y)", "[await x for x in y]", "(await x for x in y)", "[x for x in await y]", "def f(): [x async for x in y]", "def f(): {x async for x in y}", "def f(): (x async for x in y)", "def f(): return (x async for x in y)", "def f(): [await x for x in y]", "def f(): (await x for x in y)", "def f(): [x for x in await y]", "def f(): (x for x in await y)", "def f(): ([x async for x in y] for z in w)", "def f(): [(x async for x in y) for z in w]", "def f(): [[x async for x in y] for z in w]", "def f(): ((x async for x in y) for z in w)", "def f(): (x async for x in y if await z)", "def f(): (x for x in y if await z)", "def f(): (x for x in y async for z in w)", "def f(): [x for x in y async for z in w]", "lambda: [x async for x in y]", "lambda: (x async for x in y)", "class C: [x async for x in y]", "class C: x = (x async for x in y)", "async def f(): [x async for x in y]", "async def f(): [x async for x in y async for z in w]", "async def f(): [x async for x in y if z async for w in v]", "async def f(): [x async x in y]", "async def f(): [x async for]", "async def f(): [async for x in y]", "async def f(): [x for async x in y]", "async def f(): [x async for x in y for]", "async def f(): [x async for x, y in z]", "async def f(): [x async for (x, y) in z]", "async def f(): [x async for 1 in z]", "async def f(): [x async for x in y, z]", "async def f(): f(x async for x in y)", "async def f(): f(x async for x in y, 1)", "async def f(): [yield async for x in y]", "async def f(): [(yield x) async for x in y]", "async def f(): ((yield x) async for x in y)", "async def f(): [x async for x in (yield)]", "async def f(): [x := 1 async for x in y]", "async def f(): [(z := x) async for x in y]", "async def f(): [(x := 1) async for x in y]", "async def f(): [x asyncfor x in y]", "async def f(): [x async  for x in y]", "async def f(): [x async\n for x in y]"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("await x", "x = await y", "def f(): await x", "def f(): r...')
# compile() with the top-level-await flag.
try: PyCF_ALLOW_TOP_LEVEL_AWAIT = 0x2000
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: PyCF_ALLOW_TOP_LEVEL_AWAIT = 0x2000')
try: code = compile("r = await val(5)\n[x async for x in arange(2)]", "<s>", "exec", flags=PyCF_ALLOW_TOP_LEVEL_AWAIT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile("r = await val(5)\\n[x async for x in arange(2)]", "<s>...')
try: print(code.co_flags & 0x80 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code.co_flags & 0x80 != 0')
try: ns = {"val": val, "arange": arange}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {"val": val, "arange": arange}')
try: co = eval(code, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: co = eval(code, ns)')
try: print('type(co).__name__ =>', type(co).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(co).__name__')
try: print('run(co) =>', run(co))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(co)')
try: print('ns["r"] =>', ns["r"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["r"]')
try: code = compile("1 + 1", "<s>", "eval", flags=PyCF_ALLOW_TOP_LEVEL_AWAIT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile("1 + 1", "<s>", "eval", flags=PyCF_ALLOW_TOP_LEVEL_AWAIT)')
try: print('code.co_flags & 0x80 != 0 =>', code.co_flags & 0x80 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code.co_flags & 0x80 != 0')
try: print('eval(code) =>', eval(code))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: eval(code)')
try: code = compile("await val(7)", "<s>", "eval", flags=PyCF_ALLOW_TOP_LEVEL_AWAIT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile("await val(7)", "<s>", "eval", flags=PyCF_ALLOW_TOP_LE...')
try: print(run(eval(code, ns)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(eval(code, ns))')
try:
    for src in ("async with x: pass", "async for x in y: pass", "yield", "return", "def f(): await x", "await x\nyield y", "lambda: await x", "class C: await x"):
        try: print("ok:", src.replace("\n", "\\n"), compile(src, "<s>", "exec", flags=PyCF_ALLOW_TOP_LEVEL_AWAIT).co_flags & 0x280)
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("async with x: pass", "async for x in y: pass", "yield", ...')
