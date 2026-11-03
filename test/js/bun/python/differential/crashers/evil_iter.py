# Iterables, iterators, __len__, __length_hint__, __repr__, __str__, __buffer__, __bool__ and the like that change what is being built, read or shown.
import array, collections, itertools, functools, operator, io, struct, sys, json, pickle, copy, types, re, csv, heapq, string

GROUP = sys.argv[1] if len(sys.argv) > 1 else None
def show(f):
    try:
        r = f()
        s = repr(r)
        return s if len(s) < 100 else s[:97] + "..."
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:100]
CASES = []
def case(name, f): CASES.append((name, f))

class Hint:
    "An iterable of n items that claims to have `hint`."
    def __init__(self, n, hint, use_len=False): self.n, self.hint, self.use_len = n, hint, use_len
    def __iter__(self): return Hint.It(self)
    def __len__(self):
        if not self.use_len: raise TypeError("no len")
        if isinstance(self.hint, BaseException): raise self.hint
        return self.hint
    class It:
        def __init__(self, o): self.o, self.i = o, 0
        def __iter__(self): return self
        def __next__(self):
            if self.i >= self.o.n: raise StopIteration
            self.i += 1
            return self.i % 200
        def __length_hint__(self):
            if isinstance(self.o.hint, BaseException): raise self.o.hint
            return self.o.hint
CONSUMERS = {
    "list": list, "tuple": tuple, "set": set, "frozenset": frozenset, "bytes": bytes, "bytearray": bytearray, "deque": collections.deque, "array": lambda it: array.array("i", it), "sorted": sorted,
    "dict.fromkeys": dict.fromkeys, "list.extend": lambda it: [1].extend(it), "list +=": lambda it: [1].__iadd__(it), "bytearray.extend": lambda it: bytearray(b"a").extend(it), "array.extend": lambda it: array.array("i", [1]).extend(it),
    "deque.extend": lambda it: collections.deque([1]).extend(it), "deque.extendleft": lambda it: collections.deque([1], 3).extendleft(it), "slice assign": lambda it: [1, 2, 3].__setitem__(slice(1, 2), it),
    "bytearray slice": lambda it: bytearray(b"abc").__setitem__(slice(1, 2), it), "star call": lambda it: (lambda *a: len(a))(*it), "unpack": lambda it: (lambda a, *b: len(b))(*it), "star list": lambda it: len([*it, *it]),
    "join": lambda it: ",".join(map(str, it)), "bytes.join": lambda it: b",".join(bytes([v]) for v in it), "sum": sum, "min": min, "max": max, "any": any, "all": all, "zip": lambda it: len(list(zip(it, it))), "map": lambda it: len(list(map(abs, it))),
    "enumerate": lambda it: len(list(enumerate(it))), "Counter": lambda it: len(collections.Counter(it)), "length_hint": operator.length_hint, "heapify": lambda it: heapq.nsmallest(2, it), "tee": lambda it: len(list(itertools.tee(it)[1])),
    "product": lambda it: sum(1 for _ in itertools.islice(itertools.product(it, repeat=2), 10)), "permutations": lambda it: sum(1 for _ in itertools.islice(itertools.permutations(it, 2), 10)), "batched": lambda it: len(list(itertools.batched(it, 3))),
    "set.update": lambda it: {1}.update(it), "set &": lambda it: len({1, 2}.intersection(it)), "str.maketrans": lambda it: len(str.maketrans(dict.fromkeys(it))), "struct": lambda it: len(struct.pack("3i", *itertools.islice(it, 3))),
}
for cname, consume in CONSUMERS.items():
    for n in (0, 3, 1000):
        for hint in (0, 1, 5, 10 ** 6, 2 ** 31, 2 ** 62, 2 ** 63 - 1, 2 ** 64, -1, -2 ** 63, 1.5, "x", None, NotImplemented, TypeError("t"), ValueError("v"), MemoryError(), KeyboardInterrupt()):
            for use_len in (False, True):
                case("hint " + cname, lambda consume=consume, n=n, hint=hint, use_len=use_len: ((n, repr(hint)[:20], use_len), show(lambda: (lambda r: len(r) if hasattr(r, "__len__") else r)(consume(Hint(n, hint, use_len))))))

class Mutator:
    "An iterator that, at its k-th item, does something to the target."
    def __init__(self, target, action, k=2, n=6): self.target, self.action, self.k, self.n, self.i = target, action, k, n, 0
    def __iter__(self): return self
    def __next__(self):
        self.i += 1
        if self.i == self.k: self.action(self.target)
        if self.i > self.n: raise StopIteration
        return self.i
ACTIONS = {"clear": lambda x: x.clear(), "grow": lambda x: (x.extend if hasattr(x, "extend") else x.update)(range(50, 400)), "pop": lambda x: x.pop(), "self": lambda x: (x.extend if hasattr(x, "extend") else x.update)(list(x))}
TARGETS = {"list": lambda: list(range(10)), "bytearray": lambda: bytearray(range(10)), "array": lambda: array.array("i", range(10)), "deque": lambda: collections.deque(range(10)), "deque3": lambda: collections.deque(range(3), 3), "set": lambda: set(range(10))}
OPS = {
    "extend": lambda x, it: x.extend(it), "+=": lambda x, it: x.__iadd__(it), "update": lambda x, it: x.update(it), "extendleft": lambda x, it: x.extendleft(it), "[2:4]=": lambda x, it: x.__setitem__(slice(2, 4), it),
    "[::2]=": lambda x, it: x.__setitem__(slice(None, None, 2), it), "[:]=": lambda x, it: x.__setitem__(slice(None), it), "__init__": lambda x, it: x.__init__(it), "|=": lambda x, it: x.__ior__(set(it)), "intersection_update": lambda x, it: x.intersection_update(it),
    "difference_update": lambda x, it: x.difference_update(it), "symmetric_difference_update": lambda x, it: x.symmetric_difference_update(it), "issuperset": lambda x, it: x.issuperset(it), "isdisjoint": lambda x, it: x.isdisjoint(it),
    "fromlist": lambda x, it: x.fromlist(list(it)), "zip self": lambda x, it: list(zip(x, it)), "map self": lambda x, it: list(map(lambda a, b: a, x, it)), "chain": lambda x, it: list(itertools.chain(x, it, x)),
    "join": lambda x, it: x.join(bytes([v]) for v in it), "== list": lambda x, it: [v for v in it] and x == x, "sum pairs": lambda x, it: sum(a + b for a, b in zip(it, x)), "reversed": lambda x, it: [v for v, _ in zip(reversed(x), it)],
    "iter": lambda x, it: [v for v, _ in zip(iter(x), it)], "enumerate": lambda x, it: [v for v, _ in zip(enumerate(x), it)], "sorted": lambda x, it: sorted(x, key=lambda v: next(it, 0)), "min key": lambda x, it: min(x, key=lambda v: next(it, 0)),
    "list()": lambda x, it: list(v for v, _ in zip(x, it)), "tuple(x) hint": lambda x, it: tuple(itertools.chain(it, x)), "copy": lambda x, it: copy.copy(x) and next(it) and copy.deepcopy(x), "pickle": lambda x, it: len(pickle.dumps([x, list(it), x])),
}
for tname, make in TARGETS.items():
    for aname, action in ACTIONS.items():
        for oname, op in OPS.items():
            def f(make=make, action=action, op=op):
                out = []
                for k in (1, 2, 4, 7):
                    x = make()
                    r = show(lambda: op(x, Mutator(x, action, k)))
                    if r.startswith("AttributeError"): return None
                    out.append((k, r, show(lambda: (len(x), list(x)[:5]))))
                return out
            case("mutate " + tname + " " + oname, lambda f=f, aname=aname: (aname, f()))

class Shower:
    "Its repr, str, hash... change the container that holds it."
    def __init__(self, action): self.action, self.target, self.done = action, None, False
    def fire(self):
        if not self.done and self.target is not None:
            self.done = True
            self.action(self.target)
    def __repr__(self): self.fire(); return "S"
    def __str__(self): self.fire(); return "s"
    def __format__(self, spec): self.fire(); return "f"
    def __bool__(self): self.fire(); return True
    def __len__(self): self.fire(); return 1
    def __int__(self): self.fire(); return 1
    def __float__(self): self.fire(); return 1.0
    def __index__(self): self.fire(); return 1
    def __bytes__(self): self.fire(); return b"b"
    def __reduce__(self): self.fire(); return (int, ())
    def __copy__(self): self.fire(); return 1
    def __deepcopy__(self, memo): self.fire(); return 1
    def __iter__(self): self.fire(); return iter((1, 2))
    def __neg__(self): self.fire(); return 1
    def __add__(self, o): self.fire(); return 1
    def __radd__(self, o): self.fire(); return 1
    def __fspath__(self): self.fire(); return "p"
    def __getitem__(self, k): self.fire(); raise IndexError
    def __call__(self, *a): self.fire(); return 1
    def keys(self): self.fire(); return ["a"]
HOLDERS = {
    "list": (lambda s: [0, s, 2, 3, s, 5], {"clear": lambda x: x.clear(), "grow": lambda x: x.extend(range(500)), "pop": lambda x: x.pop(0)}),
    "dict": (lambda s: {0: 0, 1: s, 2: 2, 3: s}, {"clear": lambda x: x.clear(), "grow": lambda x: x.update(zip(range(10, 500), range(500))), "pop": lambda x: x.pop(0)}),
    "deque": (lambda s: collections.deque([0, s, 2, 3, s]), {"clear": lambda x: x.clear(), "grow": lambda x: x.extend(range(500)), "pop": lambda x: x.popleft()}),
    "OrderedDict": (lambda s: collections.OrderedDict({0: 0, 1: s, 2: 2, 3: s}), {"clear": lambda x: x.clear(), "grow": lambda x: x.update(zip(range(10, 500), range(500))), "pop": lambda x: x.pop(0), "move": lambda x: x.move_to_end(0)}),
    "defaultdict": (lambda s: collections.defaultdict(int, {0: 0, 1: s, 2: 2}), {"clear": lambda x: x.clear(), "grow": lambda x: x.update(zip(range(10, 500), range(500)))}),
    "namespace": (lambda s: types.SimpleNamespace(a=0, b=s, c=2, d=s), {"clear": lambda x: x.__dict__.clear(), "grow": lambda x: x.__dict__.update(("k%d" % i, i) for i in range(500))}),
}
USES = {
    "repr": repr, "str": str, "format": lambda x: "{} {!r} {!s}".format(x, x, x), "percent": lambda x: "%s %r" % (x, x), "fstring": lambda x: f"{x} {x!r}", "print": lambda x: print(x, file=io.StringIO()), "json": lambda x: json.dumps(x, default=lambda o: repr(o)),
    "json indent": lambda x: json.dumps(x, default=str, indent=2), "pickle": lambda x: len(pickle.dumps(x)), "pickle py": lambda x: len(pickle._dumps(x)), "copy": lambda x: len(repr(copy.copy(x))), "deepcopy": lambda x: len(repr(copy.deepcopy(x))), "any": lambda x: any(x), "all": lambda x: all(x),
    "filter": lambda x: len(list(filter(None, x))), "sum": lambda x: sum(x), "join str": lambda x: ",".join(map(str, x)), "map int": lambda x: list(map(int, x)), "bytes()": lambda x: bytes(x), "bytearray()": lambda x: bytearray(x), "array": lambda x: array.array("i", x),
    "struct": lambda x: struct.pack("%di" % len(x), *x), "values repr": lambda x: repr(x.values()), "items repr": lambda x: repr(x.items()), "keys repr": lambda x: repr(x.keys()), "list(values)": lambda x: [str(v) for v in x.values()], "dict(x)": lambda x: len(dict(x)),
    "sorted key": lambda x: sorted(x, key=str), "max key": lambda x: max(x, key=str), "tuple repr": lambda x: repr(tuple(x)), "set of str": lambda x: len({str(v) for v in x}), "csv": lambda x: csv.writer(io.StringIO()).writerow(x), "writelines": lambda x: io.StringIO().writelines(map(str, x)),
    "reversed": lambda x: [str(v) for v in reversed(x)], "enumerate": lambda x: [str(v) for i, v in enumerate(x)], "zip": lambda x: [str(a) for a, b in zip(x, x)], "star": lambda x: (lambda *a: [str(v) for v in a])(*x), "**": lambda x: (lambda **k: len(k))(**{str(k): v for k, v in x.items()}),
    "unpack": lambda x: (lambda a, b, *c: str(b))(*x), "==": lambda x: x == copy.copy(x), "count": lambda x: x.count(1), "index": lambda x: x.index(5), "in": lambda x: 5 in x, "reduce": lambda x: functools.reduce(operator.add, x), "accumulate": lambda x: list(itertools.accumulate(x)),
    "Template": lambda x: string.Template("$a").substitute(a=x), "format_map": lambda x: "{0}".format_map({"0": x}), "vars repr": lambda x: repr(vars(x)), "os.fspath": lambda x: [__import__("os").fspath(v) for v in x if not isinstance(v, int)],
}
for hname, (make, actions) in HOLDERS.items():
    for uname, use in USES.items():
        def f(make=make, actions=actions, use=use):
            out = []
            for aname, action in actions.items():
                s = Shower(action)
                x = make(s)
                s.target = x
                out.append((aname, show(lambda: use(x)), show(lambda: len(x) if hasattr(x, "__len__") else len(vars(x)))))
            return out
        case("show " + hname + " " + uname, f)

if GROUP == "--list":
    for name in dict.fromkeys(name for name, f in CASES): print(name)
else:
    for name, f in CASES:
        if GROUP is None or GROUP == name:
            print(name, "->", f(), flush=True)
