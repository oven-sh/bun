# feature_version, the module of a syntax warning, what a deep recursion says.
try: import warnings, ast, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings, ast, sys')
try:
    def attempt(thunk):
        try:
            return thunk()
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(thunk):')
try:
    def nested(make, n=500000):
        t = make(None)
        for i in range(n):
            t = make(t)
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(make, n=500000):')
try: t = nested(lambda x: (x,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = nested(lambda x: (x,))')
try: print(attempt(lambda: hash(t)).partition(' while ')[::2][1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: hash(t)).partition(' while ')[::2][1]")
try: f = nested(lambda x: frozendict(a=x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = nested(lambda x: frozendict(a=x))')
try: print(attempt(lambda: hash(f)).partition(' while ')[::2][1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: hash(f)).partition(' while ')[::2][1]")
try: del t, f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del t, f')

# The module a syntax warning is attributed to
try:
    def compiled(source, **kw):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("error", SyntaxWarning)
            warnings.filterwarnings("always", module=r"package\.module\z")
            r = attempt(lambda: compile(source, "file.py", "exec", **kw) and "compiled")
        return r, [(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def compiled(source, **kw):')
try: print(compiled("1 is 1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compiled("1 is 1")')
try: print(compiled("1 is 1", module="package.module"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compiled("1 is 1", module="package.module")')
try: print(compiled("x = 1or 0", module="package.module"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compiled("x = 1or 0", module="package.module")')
try: print(compiled("'\\e'", module="package.module"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compiled("\'\\\\e\'", module="package.module")')
try: print(compiled("'\\e'"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compiled("\'\\\\e\'")')
try:
    def parsed(source, **kw):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("error", SyntaxWarning)
            warnings.filterwarnings("always", module=r"package\.module\z")
            r = attempt(lambda: ast.parse(source, "file.py", **kw) and "parsed")
        return r, [(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def parsed(source, **kw):')
try: print(parsed("'\\e'", module="package.module"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parsed("\'\\\\e\'", module="package.module")')
try: print(parsed("'\\e'"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parsed("\'\\\\e\'")')
try: g = {"__name__": "package.module"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = {"__name__": "package.module"}')
try:
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("error", SyntaxWarning)
        warnings.filterwarnings("always", module=r"package\.module\z")
        print('attempt(lambda: exec("1 is 1", g)) =>', attempt(lambda: exec("1 is 1", g)))
        print('attempt(lambda: eval("1 is 1", g)) =>', attempt(lambda: eval("1 is 1", g)))
        print('attempt(lambda: exec("1 is 1", {"__name__": "other"})) =>', attempt(lambda: exec("1 is 1", {"__name__": "other"})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as w:')
try: print([(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w]')

# feature_version
try: samples = [
 ("a @= b", 4), ("a @ b", 4), ("x: int = 1", 5), ("x.y: int", 5), ("type X = int", 11), ("def f[T](): pass", 11), ("class C[T]: pass", 11),
 ("def f[T = int](): pass", 12), ("async def f(): pass", 4), ("async def f():\n async for x in y: pass", 4), ("async def f():\n async with x: pass", 4),
 ("async def f():\n await x", 4), ("async def f():\n [x async for x in y]", 5), ("try: pass\nexcept A, B: pass", 13), ("try: pass\nexcept* A: pass", 10),
 ("def f(a, /): pass", 7), ("lambda a, /: 1", 7), ("match x:\n case 1: pass", 9), ("(a := 1)", 7), ("1_000", 5), ("t'x'", 13), ("f'{x}'", 5), ("with (a, b): pass", 8), ("with (a as b, c as d): pass", 8),
 ("@a.b[1]\ndef f(): pass", 8), ("f(**a, *b)", 4), ("print(*a, *b)", 4), ("{**a}", 4), ("return_ = [*a, *b]", 4), ("def f(): return *a, b", 7), ("x[*a]", 10), ("def f(*a: *b): pass", 10), ("for x in *a, b: pass", 8),
 ("def f(a, *, b): pass", 4), ("f'{x=}'", 7), ("f'{x!r:>{y}}'", 11), ("global_ = not_ = 1", 4), ("with a as (b, c): pass", 4), ("del (a), b", 4),
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: samples = [ ("a @= b", 4), ("a @ b", 4), ("x: int = 1", 5), ("x.y: in...')
try:
    for source, version in samples:
        for v in (version, version + 1):
            try:
                ast.parse(source, feature_version=(3, v))
                print('repr(source) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', repr(source))
                print('v [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', v)
                print("ok")
            except SyntaxError as e:
                print('repr(source) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', repr(source))
                print('v [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', v)
                print('e.msg [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', e.msg)
                print('e.lineno [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', e.lineno)
                print('e.offset [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', e.offset)
                print('e.end_lineno [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', e.end_lineno)
                print('e.end_offset [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'version=' + (repr(version) if type(version) in (str, int, float, bytes, bool, type(None)) or (type(version) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in version)) else version.__name__ if type(version) is type else type(version).__name__) + ", " + 'v=' + (repr(v) if type(v) in (str, int, float, bytes, bool, type(None)) or (type(v) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in v)) else v.__name__ if type(v) is type else type(v).__name__) + '] =>', e.end_offset)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source, version in samples:')
