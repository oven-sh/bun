# Data and programs nested so deep that a function in C++ that calls itself for each level would run out of stack.
# Each case must end in a result or an exception (RecursionError, MemoryError, SyntaxError...), never in a crash.
import sys, collections, functools, itertools, operator, types, copy, json, pickle, marshal, ast, re, io, reprlib, pprint, weakref, threading

GROUP = sys.argv[1] if len(sys.argv) > 1 else None
N = 200_000
def outcome(f):
    try:
        r = f()
        return "ok " + type(r).__name__
    except (RecursionError, MemoryError) as e:
        return type(e).__name__
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:80]
CASES = []
def case(name):
    def register(f):
        CASES.append((name, f))
        return f
    return register

def nested_list(n=N):
    x = []
    for _ in range(n): x = [x]
    return x
def nested_tuple(n=N):
    x = ()
    for _ in range(n): x = (x,)
    return x
def nested_dict(n=N):
    x = {}
    for _ in range(n): x = {"k": x}
    return x
def nested_set(n=N):
    x = frozenset()
    for _ in range(n): x = frozenset([x])
    return x

for kind, make in (("list", nested_list), ("tuple", nested_tuple), ("dict", nested_dict), ("frozenset", nested_set)):
    case("repr " + kind)(lambda make=make: repr(make()))
    case("str " + kind)(lambda make=make: str(make()))
    case("== " + kind)(lambda make=make: make() == make())
    case("< " + kind)(lambda make=make: make() < make())
    case("hash " + kind)(lambda make=make: hash(make()))
    case("deepcopy " + kind)(lambda make=make: copy.deepcopy(make()))
    case("pickle " + kind)(lambda make=make: pickle.dumps(make()))
    case("pickle0 " + kind)(lambda make=make: pickle.dumps(make(), 0))
    case("marshal " + kind)(lambda make=make: marshal.dumps(make()))
    case("json " + kind)(lambda make=make: json.dumps(make()))
    case("json indent " + kind)(lambda make=make: json.dumps(make(), indent=1))
    case("format " + kind)(lambda make=make: "%s %r {}".format(make()) % (1, make()))
    case("fstring " + kind)(lambda make=make: f"{make()!r}")
    case("print " + kind)(lambda make=make: print(make(), file=io.StringIO()))
    case("pprint " + kind)(lambda make=make: pprint.pformat(make()))
    case("reprlib " + kind)(lambda make=make: reprlib.repr(make()))
    case("in " + kind)(lambda make=make: make() in [make()])
    case("dict key " + kind)(lambda make=make: {make(): 1})
    case("sorted " + kind)(lambda make=make: sorted([make(), make()]))
    case("drop " + kind)(lambda make=make: [make() for _ in range(3)] and None)

case("json loads [")(lambda: json.loads("[" * N + "]" * N))
case("json loads {")(lambda: json.loads('{"a":' * N + "1" + "}" * N))
case("pickle loads")(lambda: pickle.loads(b"\x80\x04" + b"]" + b"\x85" * N + b"."))
case("marshal loads")(lambda: marshal.loads(b"(\x01\x00\x00\x00" * N + b"N"))
case("literal_eval (")(lambda: ast.literal_eval("(" * N + ")" * N))
case("literal_eval [")(lambda: ast.literal_eval("[" * N + "]" * N))

for name, source in [
    ("parens", "(" * N + "1" + ")" * N), ("brackets", "[" * N + "]" * N), ("braces", "{" * N + "}" * N), ("calls", "f(" * N + ")" * N), ("subscripts", "x" + "[0]" * N), ("attributes", "x" + ".a" * N),
    ("call chain", "f" + "()" * N), ("plus", "1" + "+1" * N), ("minus unary", "-" * N + "1"), ("not", "not " * N + "1"), ("invert", "~" * N + "1"), ("power", "2" + "**2" * N), ("and", "1" + " and 1" * N),
    ("compare", "1" + " < 1" * N), ("ternary", "1 if 1 else " * N + "1"), ("lambda", "lambda: " * N + "1"), ("await", "await " * N + "x"), ("star", "*" * N + "x"), ("tuple nest", "(" * N + "1," + ")," * N),
    ("comprehension", "[x " + "for x in y " * N + "]"), ("nested comprehension", "[" * 5000 + "x" + " for x in y]" * 5000), ("fstring nest", 'f"{' * 200 + "1" + '}"' * 200), ("string concat", "'a' " * N), ("dict nest", "{1:" * N + "1" + "}" * N),
    ("walrus", "(x:=" * N + "1" + ")" * N), ("slices", "x[" * N + "0" + "]" * N), ("if nest", "".join(" " * i + "if 1:\n" for i in range(3000)) + " " * 3000 + "pass"), ("elif chain", "if 1: pass\n" + "elif 1: pass\n" * N),
    ("def nest", "".join(" " * i + "def f():\n" for i in range(3000)) + " " * 3000 + "pass"), ("class nest", "".join(" " * i + "class C:\n" for i in range(3000)) + " " * 3000 + "pass"),
    ("try nest", "".join(" " * i + "try:\n" for i in range(1000)) + " " * 1000 + "pass\n" + "".join(" " * i + "finally: pass\n" for i in reversed(range(1000)))), ("with nest", "".join(" " * i + "with x:\n" for i in range(3000)) + " " * 3000 + "pass"),
    ("for nest", "".join(" " * i + "for x in y:\n" for i in range(3000)) + " " * 3000 + "pass"), ("while nest", "".join(" " * i + "while x:\n" for i in range(3000)) + " " * 3000 + "pass"), ("decorators", "@f\n" * N + "def g(): pass"),
    ("match nest", "match x:\n case " + "[" * 20000 + "]" * 20000 + ": pass"), ("match or", "match x:\n case " + "1|" * N + "1: pass"), ("annotation", "x: " + "list[" * N + "int" + "]" * N), ("type alias", "type X = " + "list[" * N + "int" + "]" * N),
    ("many statements", "x = 1\n" * N), ("many args", "f(" + "1," * N + ")"), ("many targets", "x = " * N + "1"), ("global many", "def f():\n global " + ",".join("a%d" % i for i in range(N))), ("long tuple", "(" + "1," * N + ")"), ("import dots", "import " + ".".join(["a"] * N)),
    ("backslash", "x = 1 \\\n" * 1 + "+ 1 \\\n" * N + "+ 1"), ("semicolons", "x;" * N), ("del nest", "del " + "(" * N + "x" + ")" * N), ("assign nest", "(" * N + "x" + ")" * N + " = 1"), ("starred assign", "[" * N + "x" + "]" * N + " = y"),
]:
    case("compile " + name)(lambda source=source: compile(source, "<deep>", "exec"))
    case("ast.parse " + name)(lambda source=source: ast.parse(source))
case("ast compile deep")(lambda: compile(functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e), range(N), ast.Constant(1)) and ast.fix_missing_locations(ast.Expression(functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e, lineno=1, col_offset=0), range(N), ast.Constant(1, lineno=1, col_offset=0)))), "<ast>", "eval"))
case("ast.unparse deep")(lambda: ast.unparse(functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e), range(N), ast.Constant(1))))
case("ast.dump deep")(lambda: ast.dump(functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e), range(N), ast.Constant(1))))
case("ast repr deep")(lambda: repr(functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e), range(N), ast.Constant(1))))
case("ast compare deep")(lambda: ast.compare(*[functools.reduce(lambda e, _: ast.UnaryOp(ast.USub(), e), range(N), ast.Constant(1)) for _ in range(2)]))
case("eval deep result")(lambda: eval("+".join(["1"] * 3000)))

def chain(wrap, start, n=N):
    x = start
    for _ in range(n): x = wrap(x)
    return x
case("partial call")(lambda: chain(functools.partial, int)())
case("partial repr")(lambda: repr(chain(lambda f: functools.partial(print, f), int)))
case("map next")(lambda: next(chain(lambda it: map(abs, it), iter([1]))))
case("filter next")(lambda: next(chain(lambda it: filter(None, it), iter([1]))))
case("zip next")(lambda: next(chain(lambda it: zip(it), iter([1]))))
case("enumerate next")(lambda: next(chain(enumerate, iter([1]))))
case("chain next")(lambda: next(chain(lambda it: itertools.chain(it), iter([1]))))
case("islice next")(lambda: next(chain(lambda it: itertools.islice(it, 5), iter([1]))))
case("tee next")(lambda: next(chain(lambda it: itertools.tee(it)[0], iter([1]))))
case("cycle next")(lambda: next(chain(itertools.cycle, iter([1]))))
case("accumulate next")(lambda: next(chain(itertools.accumulate, iter([1]))))
case("starmap next")(lambda: next(chain(lambda it: itertools.starmap(max, zip(it, it)), iter([1, 2]))))
case("takewhile next")(lambda: next(chain(lambda it: itertools.takewhile(bool, it), iter([1]))))
case("reversed list of")(lambda: next(chain(lambda it: reversed([it]), 1)))
case("iter iter")(lambda: next(chain(iter, iter([1]))))
case("genexp next")(lambda: next(chain(lambda it: (x for x in it), iter([1]))))
case("generator yield from")(lambda: next(chain(lambda it: (lambda it: (yield from it))(it), iter([1]))))
case("generator close")(lambda: chain(lambda it: (lambda it: (yield from it))(it), iter([1])).close())
case("method of method")(lambda: chain(lambda f: types.MethodType(f, 1), lambda *a: len(a))())
case("methodcaller")(lambda: chain(lambda f: operator.methodcaller("__call__", f), 1)(int))
case("itemgetter nest")(lambda: operator.itemgetter(*[0] * 1000)(nested_list(10)))
case("attrgetter dots")(lambda: operator.attrgetter(".".join(["real"] * N))(1))
case("staticmethod nest")(lambda: chain(staticmethod, int)())
case("classmethod nest")(lambda: repr(chain(classmethod, int)))
case("property nest")(lambda: chain(property, int).fget)
case("mappingproxy nest repr")(lambda: repr(chain(types.MappingProxyType, {})))
case("mappingproxy nest get")(lambda: chain(types.MappingProxyType, {1: 2})[1])
case("mappingproxy nest ==")(lambda: chain(types.MappingProxyType, {1: 2}) == chain(types.MappingProxyType, {1: 2}))
case("mappingproxy nest len")(lambda: len(chain(types.MappingProxyType, {1: 2})))
case("ChainMap nest")(lambda: chain(collections.ChainMap, {1: 2})[1])
case("deque nest repr")(lambda: repr(chain(lambda x: collections.deque([x]), 1)))
case("deque nest ==")(lambda: chain(lambda x: collections.deque([x]), 1) == chain(lambda x: collections.deque([x]), 1))
case("OrderedDict nest repr")(lambda: repr(chain(lambda x: collections.OrderedDict(a=x), 1)))
case("OrderedDict nest ==")(lambda: chain(lambda x: collections.OrderedDict(a=x), 1) == chain(lambda x: collections.OrderedDict(a=x), 1))
case("defaultdict nest repr")(lambda: repr(chain(lambda x: collections.defaultdict(None, a=x), 1)))
case("namespace nest repr")(lambda: repr(chain(lambda x: types.SimpleNamespace(a=x), 1)))
case("namespace nest ==")(lambda: chain(lambda x: types.SimpleNamespace(a=x), 1) == chain(lambda x: types.SimpleNamespace(a=x), 1))
case("slice nest repr")(lambda: repr(chain(lambda x: slice(x), 1)))
case("slice nest ==")(lambda: chain(lambda x: slice(x), 1) == chain(lambda x: slice(x), 1))
case("slice nest hash")(lambda: hash(chain(lambda x: slice(x), 1)))
case("range of index")(lambda: chain(lambda x: range(1)[x:], slice(None)))
case("GenericAlias nest repr")(lambda: repr(chain(lambda x: list[x], int)))
case("GenericAlias nest ==")(lambda: chain(lambda x: list[x], int) == chain(lambda x: list[x], int))
case("GenericAlias nest hash")(lambda: hash(chain(lambda x: list[x], int)))
case("GenericAlias params")(lambda: chain(lambda x: list[x], int, 3000).__parameters__)
case("union nest")(lambda: repr(chain(lambda x: list[x] | None, int, 3000)))
case("weakref proxy nest")(lambda: None)
case("memoryview nest")(lambda: bytes(chain(memoryview, b"abc")))
case("bytes of bytes")(lambda: chain(bytes, b"abc"))
case("exception cause chain print")(lambda: __import__("traceback").format_exception(chain(lambda e: (lambda n: (setattr(n, "__cause__", e), n)[1])(ValueError()), ValueError())))
case("exception context chain raise")(lambda: exec("e = None\nfor i in range(%d):\n    n = ValueError(i); n.__context__ = e; e = n\ntry:\n    raise e\nexcept ValueError:\n    try:\n        raise KeyError\n    except KeyError: pass" % N))
case("exception args nest repr")(lambda: repr(chain(lambda e: ValueError(e), 1)))
case("exception args nest str")(lambda: str(chain(lambda e: ValueError(e), 1)))
case("exception group nest")(lambda: chain(lambda e: ExceptionGroup("g", [e]), ValueError()))
case("exception group nest split")(lambda: chain(lambda e: ExceptionGroup("g", [e]), ValueError()).split(ValueError))
case("exception group nest subgroup")(lambda: chain(lambda e: ExceptionGroup("g", [e]), ValueError()).subgroup(KeyError))
case("exception group nest repr")(lambda: repr(chain(lambda e: ExceptionGroup("g", [e]), ValueError())))
case("exception group nest str")(lambda: str(chain(lambda e: ExceptionGroup("g", [e]), ValueError())))
case("exception group except*")(lambda: exec("try:\n    raise g\nexcept* ValueError: pass", {"g": chain(lambda e: ExceptionGroup("g", [e]), ValueError())}))
case("exception group print")(lambda: __import__("traceback").format_exception(chain(lambda e: ExceptionGroup("g", [e]), ValueError(), 5000)))
case("isinstance nested tuple")(lambda: isinstance(1, nested_tuple()))
case("issubclass nested tuple")(lambda: issubclass(int, nested_tuple()))
case("isinstance nested tuple hit")(lambda: isinstance(1, chain(lambda t: (t,), (int,))))
case("except nested tuple")(lambda: exec("try:\n    raise ValueError\nexcept t: pass", {"t": chain(lambda t: (t,), (ValueError,))}))
case("str.startswith nested")(lambda: "a".startswith(nested_tuple()))
case("class chain")(lambda: chain(lambda c: type("C", (c,), {}), object, 3000))
case("class chain mro attr")(lambda: chain(lambda c: type("C", (c,), {}), object, 3000)().x)
case("class chain subclasses change")(lambda: (lambda base: (chain(lambda c: type("C", (c,), {}), base, 20000), setattr(base, "x", 1)))(type("B", (), {})))
case("metaclass chain")(lambda: chain(lambda m: type("M", (m,), {}), type, 2000)("X", (), {}))
case("__getattr__ self")(lambda: type("A", (), {"__getattr__": lambda self, n: getattr(self, n)})().x)
case("__repr__ self")(lambda: repr(type("A", (), {"__repr__": lambda self: repr(self)})()))
case("__str__ repr")(lambda: str(type("A", (), {"__repr__": lambda self: str(self)})()))
case("__eq__ self")(lambda: type("A", (), {"__eq__": lambda self, o: self == o})() == 1)
case("__hash__ self")(lambda: hash(type("A", (), {"__hash__": lambda self: hash(self)})()))
case("__len__ self")(lambda: len(type("A", (), {"__len__": lambda self: len(self)})()))
case("__bool__ self")(lambda: bool(type("A", (), {"__bool__": lambda self: bool(self)})()))
case("__iter__ self")(lambda: iter(type("A", (), {"__iter__": lambda self: iter(self)})()))
case("__index__ self")(lambda: operator.index(type("A", (), {"__index__": lambda self: operator.index(self)})()))
case("__call__ instance")(lambda: (lambda A: (setattr(A, "__call__", A()), A()())[1])(type("A", (), {})))
case("__add__ instance")(lambda: (lambda A: (setattr(A, "__add__", A()), A() + 1)[1])(type("A", (), {})))
case("__getitem__ instance")(lambda: (lambda A: (setattr(A, "__getitem__", A()), A()[1])[1])(type("A", (), {})))
case("__get__ chain")(lambda: (lambda A: (setattr(A, "__get__", A()), type("B", (), {"x": A()})().x)[1])(type("A", (), {})))
case("__class_getitem__ self")(lambda: type("A", (), {"__class_getitem__": classmethod(lambda cls, k: cls[k])})[1])
case("__instancecheck__ self")(lambda: (lambda M: isinstance(1, M("A", (), {})))(type("M", (type,), {"__instancecheck__": lambda cls, o: isinstance(o, cls)})))
case("__subclasscheck__ self")(lambda: (lambda M: issubclass(int, M("A", (), {})))(type("M", (type,), {"__subclasscheck__": lambda cls, o: issubclass(o, cls)})))
case("__missing__ self")(lambda: type("D", (dict,), {"__missing__": lambda self, k: self[k]})()[1])
case("__format__ self")(lambda: format(type("A", (), {"__format__": lambda self, s: format(self, s)})()))
case("__del__ chain")(lambda: chain(lambda x: type("A", (), {"__del__": lambda self: None, "__init__": lambda self, x: setattr(self, "x", x)})(x), None, 50000) and None)
case("__mro_entries__ self")(lambda: type("A", (), {"__mro_entries__": lambda self, b: (self,)})() and exec("class B(a): pass", {"a": type("A", (), {"__mro_entries__": lambda self, b: (self,)})()}))
case("__set_name__ deep")(lambda: None)
case("__wrapped__ cycle signature")(lambda: (lambda f: (setattr(f, "__wrapped__", f), __import__("inspect").signature(f))[1])(lambda: None))
case("default_factory self")(lambda: (lambda d: (setattr(d, "default_factory", lambda: d[1]), d[1])[1])(collections.defaultdict()))
case("sort key recursion")(lambda: (lambda l: l.sort(key=lambda v: l.sort()))([1, 2]))
case("recursive function")(lambda: (lambda f: f(f))(lambda f: f(f)))
case("recursive generator")(lambda: (lambda g: next(g(g)))(lambda g: (yield from g(g))))
case("recursive lambda in map")(lambda: (lambda f: f(f))(lambda f: list(map(f, [f]))))
case("recursive sorted key")(lambda: (lambda f: f(f))(lambda f: sorted([1], key=lambda v: f(f))))
case("recursive reduce")(lambda: (lambda f: f(f))(lambda f: functools.reduce(lambda a, b: f(f), [1, 2])))
case("recursive lru_cache")(lambda: (lambda: (lambda f: f(10 ** 6))(functools.lru_cache(None)(lambda n: n and globals()["_cached"](n - 1))))() if globals().__setitem__("_cached", functools.lru_cache(None)(lambda n: n and _cached(n - 1))) is None else None)
case("recursive re")(lambda: re.compile("(" * 5000 + "a" + ")" * 5000))
case("re deep match")(lambda: re.match("(a|b)*c", "ab" * N))
case("re deep lazy")(lambda: re.match("(?:a|b)*?c", "ab" * N + "c"))
case("format nested spec")(lambda: "{:{:{:{}}}}".format(1, 2, 3, 4))
case("format deep attr")(lambda: ("{0" + ".real" * N + "}").format(1))
case("format deep index")(lambda: ("{0" + "[0]" * N + "}").format(nested_list()))
case("percent many")(lambda: ("%s" * N) % ((1,) * N))
case("setrecursionlimit high")(lambda: (sys.setrecursionlimit(10 ** 8), (lambda f: f(f))(lambda f: f(f)))[1])
case("setrecursionlimit high repr")(lambda: (sys.setrecursionlimit(10 ** 8), repr(nested_list()))[1])
case("setrecursionlimit high c calls")(lambda: (sys.setrecursionlimit(10 ** 8), (lambda f: f(f))(lambda f: list(map(f, [f]))))[1])
case("setrecursionlimit high getattr")(lambda: (sys.setrecursionlimit(10 ** 8), type("A", (), {"__getattr__": lambda self, n: getattr(self, n)})().x)[1])
case("setrecursionlimit high generator")(lambda: (sys.setrecursionlimit(10 ** 8), (lambda g: next(g(g)))(lambda g: (yield from g(g))))[1])
case("setrecursionlimit high class init")(lambda: (sys.setrecursionlimit(10 ** 8), exec("class Node:\n    def __init__(self): Node()\nNode()", {}))[1])
case("setrecursionlimit high property")(lambda: (sys.setrecursionlimit(10 ** 8), type("A", (), {"x": property(lambda self: self.x)})().x)[1])
case("setrecursionlimit high import")(lambda: (sys.setrecursionlimit(10 ** 8), exec("import builtins\ndef imp(*a): return __import__(*a)\nbuiltins.__import__ = imp\nimport os", {"__builtins__": {"__import__": lambda *a: __import__(*a)}}))[1])

if GROUP == "--list":
    for name, f in CASES: print(name)
else:
    for name, f in CASES:
        if GROUP is None or GROUP == name:
            print(name, "->", outcome(f), flush=True)
