# code.replace() that takes effect, function.__code__ = code, code(...) from the attributes of a code object, co_code.
# (jinja2, hypothesis, networkx and cloudpickle do these.)
try: import sys, traceback, types, dis, inspect, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, traceback, types, dis, inspect, warnings')
try:
    def frames(thunk):
        try:
            thunk()
        except Exception:
            return [(f.filename.rpartition("/")[2], f.lineno, f.name) for f in traceback.extract_tb(sys.exc_info()[2])][1:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def frames(thunk):')
try: code = compile("\n\nraise ValueError('x')", "<template>", "exec")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile("\\n\\nraise ValueError(\'x\')", "<template>", "exec")')
try: c2 = code.replace(co_name="top-level template code")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2 = code.replace(co_name="top-level template code")')
try: print('c2.co_name =>', c2.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.co_name')
try: print('code.co_name =>', code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code.co_name')
try: print('c2.co_filename =>', c2.co_filename)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.co_filename')
try: print('c2.co_qualname =>', c2.co_qualname)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.co_qualname')
try: print('c2.co_firstlineno =>', c2.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.co_firstlineno')
try: print('frames(lambda: exec(c2, {})) =>', frames(lambda: exec(c2, {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames(lambda: exec(c2, {}))')
try: print('frames(lambda: exec(code, {})) =>', frames(lambda: exec(code, {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames(lambda: exec(code, {}))')
try:
    def f(a, b=2):
        raise KeyError(a + b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(a, b=2):')
try: g = types.FunctionType(f.__code__.replace(co_name="other", co_filename="elsewhere.py", co_firstlineno=100, co_qualname="Q.other"), globals(), argdefs=(5,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = types.FunctionType(f.__code__.replace(co_name="other", co_filenam...')
try: print('frames(lambda: g(1)) =>', frames(lambda: g(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames(lambda: g(1))')
try: print('g.__name__ =>', g.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__name__')
try: print('g.__qualname__ =>', g.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__qualname__')
try: print('g.__code__.co_qualname =>', g.__code__.co_qualname)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__code__.co_qualname')
try: print('g.__code__.co_firstlineno =>', g.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__code__.co_firstlineno')
try: print('list(g.__code__.co_lines())[-1][2] =>', list(g.__code__.co_lines())[-1][2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g.__code__.co_lines())[-1][2]')
try: print('f.__code__.co_firstlineno == 100 =>', f.__code__.co_firstlineno == 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_firstlineno == 100')
try: print('frames(lambda: f(1))[-1][2] =>', frames(lambda: f(1))[-1][2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames(lambda: f(1))[-1][2]')
try: print('f.__code__.co_name =>', f.__code__.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_name')
try: print('g.__code__ is g.__code__ =>', g.__code__ is g.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__code__ is g.__code__')
try: print('f.__code__.replace() == f.__code__ =>', f.__code__.replace() == f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.replace() == f.__code__')
try: print('f.__code__.replace(co_name="z") == f.__code__ =>', f.__code__.replace(co_name="z") == f.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.replace(co_name="z") == f.__code__')
try: c3 = g.__code__.replace(co_firstlineno=200)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3 = g.__code__.replace(co_firstlineno=200)')
try: print('c3.co_firstlineno =>', c3.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.co_firstlineno')
try: print('c3.co_name =>', c3.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.co_name')
try: print('c3.co_filename =>', c3.co_filename)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.co_filename')
try: print('list(c3.co_lines())[-1][2] =>', list(c3.co_lines())[-1][2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c3.co_lines())[-1][2]')
try:
    def seen():
        return sys._getframe().f_code
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def seen():')
try: h = types.FunctionType(seen.__code__.replace(co_name="renamed"), globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = types.FunctionType(seen.__code__.replace(co_name="renamed"), glob...')
try: print('h() is h.__code__ =>', h() is h.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h() is h.__code__')
try: print('h().co_name =>', h().co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h().co_name')
try: print('seen() is seen.__code__ =>', seen() is seen.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen() is seen.__code__')
try:
    def gen():
        yield sys._getframe().f_code.co_name
        raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try: k = types.FunctionType(gen.__code__.replace(co_name="gen2", co_filename="g.py"), globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k = types.FunctionType(gen.__code__.replace(co_name="gen2", co_filena...')
try: it = k()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = k()')
try: print('next(it) =>', next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print('it.gi_code.co_name =>', it.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.gi_code.co_name')
try: print('it.gi_code is k.__code__ =>', it.gi_code is k.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.gi_code is k.__code__')
try: print('frames(lambda: next(it)) =>', frames(lambda: next(it)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames(lambda: next(it))')

# function.__code__ = code
try:
    def one(x): return x + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one(x): return x + 1')
try:
    def two(x): return x * 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(x): return x * 2')
try:
    def caller(fn, n): return [fn(i) for i in range(n)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def caller(fn, n): return [fn(i) for i in range(n)]')
try: print(caller(one, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caller(one, 3)')
try: one.__code__ = two.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one.__code__ = two.__code__')
try: print('caller(one, 3) =>', caller(one, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caller(one, 3)')
try: print('one(10) =>', one(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one(10)')
try: print('one.__name__ =>', one.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one.__name__')
try: print('one.__code__ is two.__code__ =>', one.__code__ is two.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one.__code__ is two.__code__')
try: print('one.__code__.co_name =>', one.__code__.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one.__code__.co_name')
try:
    def lazy(*args, **kwargs):
        lazy.__code__ = real.__code__; lazy.__defaults__ = real.__defaults__; lazy.__kwdefaults__ = real.__kwdefaults__
        return lazy(*args, **kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy(*args, **kwargs):')
try:
    def real(a, b=3, *, c=4): return (a, b, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def real(a, b=3, *, c=4): return (a, b, c)')
try: print('lazy(1) =>', lazy(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy(1)')
try: print('lazy(1, 2, c=5) =>', lazy(1, 2, c=5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy(1, 2, c=5)')
try: print('inspect.signature(lazy) =>', inspect.signature(lazy))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.signature(lazy)')
try:
    def outer(v):
        def inner(): return v
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer(v):')
try: i1 = outer(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1 = outer(1)')
try:
    def outer2(w):
        def inner2(): return w * 100
        return inner2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer2(w):')
try: i1.__code__ = outer2(0).__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1.__code__ = outer2(0).__code__')
try: print('i1() =>', i1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1()')
try: print('i1.__closure__[0].cell_contents =>', i1.__closure__[0].cell_contents)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1.__closure__[0].cell_contents')
try: print('i1.__code__.co_freevars =>', i1.__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1.__code__.co_freevars')
try:
    for bad in (one.__code__, 5):
        try: i1.__code__ = bad
        except (ValueError, TypeError) as e: print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bad in (one.__code__, 5):')
try:
    try: del one.__code__
    except TypeError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: del one.__code__')
try:
    class C:
        def m(self): return "m"
        def n(self): return "n"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try: print([c.m() for _ in range(3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.m() for _ in range(3)]')
try: C.m.__code__ = C.n.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.m.__code__ = C.n.__code__')
try: print('[c.m() for _ in range(3)] =>', [c.m() for _ in range(3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.m() for _ in range(3)]')
try: print('C.m.__name__ =>', C.m.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.m.__name__')
try:
    def plain(): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(): return 1')
try:
    def generator(): yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator(): yield 2')
try:
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        plain.__code__ = generator.__code__
        print('[str(x.message)[:40] for x in w] =>', [str(x.message)[:40] for x in w])
        print('list(plain()) =>', list(plain()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as w:')
try:
    def rec(n): return 0 if n == 0 else 1 + rec(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rec(n): return 0 if n == 0 else 1 + rec(n - 1)')
try:
    def rec10(n): return 0 if n == 0 else 10 + rec(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rec10(n): return 0 if n == 0 else 10 + rec(n - 1)')
try: print(rec(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rec(3)')
try: rec.__code__ = rec10.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rec.__code__ = rec10.__code__')
try: print(rec(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rec(3)')
try:
    def swaps_itself():
        swaps_itself.__code__ = two.__code__
        return "still the old code"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def swaps_itself():')
try: print('swaps_itself() =>', swaps_itself())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: swaps_itself()')
try: print('swaps_itself(4) =>', swaps_itself(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: swaps_itself(4)')

# code(...) puts together what a code object was taken apart into
try: names = "argcount posonlyargcount kwonlyargcount nlocals stacksize flags code consts names varnames filename name qualname firstlineno linetable exceptiontable freevars cellvars".split()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names = "argcount posonlyargcount kwonlyargcount nlocals stacksize fl...')
try: G = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G = 7')
try:
    def sample(a, /, b, *, c=1):
        "doc"
        d = [a + b + c + G for _ in range(2)]
        def nested(): return d
        return nested()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sample(a, /, b, *, c=1):')
try: parts = [getattr(sample.__code__, "co_" + n) for n in names]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parts = [getattr(sample.__code__, "co_" + n) for n in names]')
try: again = types.CodeType(*parts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again = types.CodeType(*parts)')
try: fn = types.FunctionType(again, globals(), "sample", None, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fn = types.FunctionType(again, globals(), "sample", None, None)')
try: fn.__kwdefaults__ = {"c": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fn.__kwdefaults__ = {"c": 1}')
try: print('fn(1, 2) =>', fn(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fn(1, 2)')
try: print('again == sample.__code__ =>', again == sample.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again == sample.__code__')
try: print('again is sample.__code__ =>', again is sample.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again is sample.__code__')
try: print('again.co_name =>', again.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again.co_name')
try: print('sorted(again.co_varnames) =>', sorted(again.co_varnames))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(again.co_varnames)')
try: print('again.co_consts[0] =>', again.co_consts[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again.co_consts[0]')
try: print('[type(x).__name__ for x in again.co_consts] =>', [type(x).__name__ for x in again.co_consts])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(x).__name__ for x in again.co_consts]')
try: parts[names.index("name")] = "renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parts[names.index("name")] = "renamed"')
try: parts[names.index("filename")] = "f.py"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parts[names.index("filename")] = "f.py"')
try: print('types.CodeType(*parts).co_name =>', types.CodeType(*parts).co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.CodeType(*parts).co_name')
try: print('types.CodeType(*parts).co_filename =>', types.CodeType(*parts).co_filename)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.CodeType(*parts).co_filename')
try:
    for n, v in (("argcount", "x"), ("filename", 1)):
        try: p = list(parts)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = list(parts)')
        try: p[names.index(n)] = v
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p[names.index(n)] = v')
        try: types.CodeType(*p)
        except TypeError as e: print("TypeError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n, v in (("argcount", "x"), ("filename", 1)):')
try:
    try: types.CodeType()
    except TypeError as e: print("TypeError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: types.CodeType()')

# co_code tells code apart, and says which names the code uses
try: ident = lambda x: x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident = lambda x: x')
try: print('ident.__code__.co_code == (lambda y: y).__code__.co_code =>', ident.__code__.co_code == (lambda y: y).__code__.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__code__.co_code == (lambda y: y).__code__.co_code')
try: print('ident.__code__.co_code == (lambda y: y + 1).__code__.co_code =>', ident.__code__.co_code == (lambda y: y + 1).__code__.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__code__.co_code == (lambda y: y + 1).__code__.co_code')
try: print('ident.__code__.co_code == (lambda y: -y).__code__.co_code =>', ident.__code__.co_code == (lambda y: -y).__code__.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__code__.co_code == (lambda y: -y).__code__.co_code')
try: print('ident.__code__.co_code == (lambda y: f(y)).__code__.co_code =>', ident.__code__.co_code == (lambda y: f(y)).__code__.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__code__.co_code == (lambda y: f(y)).__code__.co_code')
try: print('type(ident.__code__.co_code).__name__ =>', type(ident.__code__.co_code).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ident.__code__.co_code).__name__')
try: print('len(ident.__code__.co_code) % 2 =>', len(ident.__code__.co_code) % 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ident.__code__.co_code) % 2')
try: import os
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os')
try:
    def uses(x):
        global written
        written = len(x) + G
        return os.path.join(str(x), x.attr.deeper)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def uses(x):')
try: ops = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ops = {}')
try:
    for ins in dis.get_instructions(uses):
        if ins.opname in ("LOAD_GLOBAL", "STORE_GLOBAL", "LOAD_ATTR", "STORE_ATTR", "LOAD_NAME", "STORE_NAME"): ops.setdefault(ins.opname, []).append(ins.argval)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for ins in dis.get_instructions(uses):')
try: print({k: sorted(set(v)) for k, v in sorted(ops.items())})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {k: sorted(set(v)) for k, v in sorted(ops.items())}')
try: cv = inspect.getclosurevars(uses)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cv = inspect.getclosurevars(uses)')
try: print('sorted(cv.globals) =>', sorted(cv.globals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(cv.globals)')
try: print('sorted(cv.builtins) =>', sorted(cv.builtins))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(cv.builtins)')
try: print('sorted(cv.unbound) =>', sorted(cv.unbound))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(cv.unbound)')
try: print('cv.nonlocals =>', cv.nonlocals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cv.nonlocals')
try: print(sorted({i.argval for i in dis.get_instructions(compile("a = b.c\nimport q\nd.e = a", "<s>", "exec")) if i.opname in ("LOAD_NAME", "STORE_NAME", "LOAD_ATTR", "STORE_ATTR")}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted({i.argval for i in dis.get_instructions(compile("a = b.c\\nimpo...')
