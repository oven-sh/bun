# feature_version, the module of a syntax warning, what a deep recursion says.
import warnings, ast, sys
def attempt(thunk):
    try:
        return thunk()
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)
def nested(make, n=500000):
    t = make(None)
    for i in range(n):
        t = make(t)
    return t
t = nested(lambda x: (x,))
print(attempt(lambda: hash(t)).partition(' while ')[::2][1])
f = nested(lambda x: frozendict(a=x))
print(attempt(lambda: hash(f)).partition(' while ')[::2][1])
del t, f

# The module a syntax warning is attributed to
def compiled(source, **kw):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("error", SyntaxWarning)
        warnings.filterwarnings("always", module=r"package\.module\z")
        r = attempt(lambda: compile(source, "file.py", "exec", **kw) and "compiled")
    return r, [(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w]
print(compiled("1 is 1"))
print(compiled("1 is 1", module="package.module"))
print(compiled("x = 1or 0", module="package.module"))
print(compiled("'\\e'", module="package.module"))
print(compiled("'\\e'"))
def parsed(source, **kw):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("error", SyntaxWarning)
        warnings.filterwarnings("always", module=r"package\.module\z")
        r = attempt(lambda: ast.parse(source, "file.py", **kw) and "parsed")
    return r, [(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w]
print(parsed("'\\e'", module="package.module"))
print(parsed("'\\e'"))
g = {"__name__": "package.module"}
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("error", SyntaxWarning)
    warnings.filterwarnings("always", module=r"package\.module\z")
    print(attempt(lambda: exec("1 is 1", g)), attempt(lambda: eval("1 is 1", g)), attempt(lambda: exec("1 is 1", {"__name__": "other"})))
print([(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w])

# feature_version
samples = [
 ("a @= b", 4), ("a @ b", 4), ("x: int = 1", 5), ("x.y: int", 5), ("type X = int", 11), ("def f[T](): pass", 11), ("class C[T]: pass", 11),
 ("def f[T = int](): pass", 12), ("async def f(): pass", 4), ("async def f():\n async for x in y: pass", 4), ("async def f():\n async with x: pass", 4),
 ("async def f():\n await x", 4), ("async def f():\n [x async for x in y]", 5), ("try: pass\nexcept A, B: pass", 13), ("try: pass\nexcept* A: pass", 10),
 ("def f(a, /): pass", 7), ("lambda a, /: 1", 7), ("match x:\n case 1: pass", 9), ("(a := 1)", 7), ("1_000", 5), ("t'x'", 13), ("f'{x}'", 5), ("with (a, b): pass", 8), ("with (a as b, c as d): pass", 8),
 ("@a.b[1]\ndef f(): pass", 8), ("f(**a, *b)", 4), ("print(*a, *b)", 4), ("{**a}", 4), ("return_ = [*a, *b]", 4), ("def f(): return *a, b", 7), ("x[*a]", 10), ("def f(*a: *b): pass", 10), ("for x in *a, b: pass", 8),
 ("def f(a, *, b): pass", 4), ("f'{x=}'", 7), ("f'{x!r:>{y}}'", 11), ("global_ = not_ = 1", 4), ("with a as (b, c): pass", 4), ("del (a), b", 4),
]
for source, version in samples:
    for v in (version, version + 1):
        try:
            ast.parse(source, feature_version=(3, v))
            print(repr(source), v, "ok")
        except SyntaxError as e:
            print(repr(source), v, e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
