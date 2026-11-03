def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

MISSING = sentinel("MISSING")
print(MISSING, repr(MISSING), str(MISSING), format(MISSING), f"{MISSING} {MISSING!r} {MISSING!s}", "%s %r" % (MISSING, MISSING), [MISSING], {"k": MISSING}, type(MISSING), type(MISSING).__name__, sentinel.__module__, sentinel.__mro__, isinstance(MISSING, sentinel), isinstance(sentinel, type), MISSING.__name__, MISSING.__module__, MISSING.__class__)
print(MISSING is MISSING, MISSING == MISSING, MISSING != MISSING, bool(MISSING), not MISSING, hash(MISSING) == hash(MISSING), {MISSING: 1}[MISSING], MISSING in [MISSING], MISSING in {MISSING}, MISSING == "MISSING", MISSING == None, MISSING is None)
other = sentinel("MISSING"); print(other is MISSING, other == MISSING, other != MISSING, repr(other) == repr(MISSING), len({other, MISSING}))
print(sentinel("a.b"), repr(sentinel("")), sentinel("é😀"), sentinel("with space"), sentinel("X", repr="<X>"), repr(sentinel("X", repr="<X>")), str(sentinel("X", repr="<X>")), sentinel("X", repr="<X>").__name__, sentinel("X", repr=""), sentinel("line\nbreak"))
t(lambda: sentinel()); t(lambda: sentinel(1)); t(lambda: sentinel(None)); t(lambda: sentinel(b"a")); t(lambda: sentinel("a", "b")); t(lambda: sentinel(name="a")); t(lambda: sentinel("a", repr=1)); t(lambda: sentinel("a", repr=None)); t(lambda: sentinel("a", nope=1)); t(lambda: sentinel("a", module_name="m")); t(lambda: type("X", (sentinel,), {}))
t(lambda: MISSING()); t(lambda: MISSING.x); t(lambda: MISSING < MISSING); t(lambda: MISSING <= 1); t(lambda: MISSING + 1); t(lambda: len(MISSING)); t(lambda: iter(MISSING)); t(lambda: MISSING[0]); t(lambda: int(MISSING)); t(lambda: MISSING.__dict__); t(lambda: format(MISSING, ">10")); t(lambda: -MISSING); t(lambda: MISSING & 1)
def s1(): MISSING.x = 1
def s2(): MISSING.__name__ = "other"
def s3(): del MISSING.__name__
def s4(): MISSING.__module__ = "m"
def s5(): MISSING.__class__ = object
for s in (s1, s2, s3, s4, s5): t(s)
# In type expressions.
print(MISSING | int, int | MISSING, MISSING | None, None | MISSING, MISSING | MISSING, (int | MISSING).__args__, MISSING | other, list[MISSING], dict[str, MISSING], type(MISSING | int).__name__, MISSING | int | str, (MISSING | int) == (int | MISSING))
t(lambda: MISSING | 1); t(lambda: 1 | MISSING); t(lambda: MISSING | "s"); t(lambda: isinstance(MISSING, MISSING | int)); t(lambda: isinstance(1, int | MISSING))
# Copying and pickling support preserve identity.
print(MISSING.__copy__() is MISSING, MISSING.__deepcopy__({}) is MISSING, MISSING.__reduce__(), MISSING.__reduce_ex__(4)); t(lambda: MISSING.__deepcopy__()); t(lambda: MISSING.__copy__(1))
# Typical uses.
def get(d, k, default=MISSING):
    if k in d: return d[k]
    if default is MISSING: raise KeyError(k)
    return default
print(get({"a": 1}, "a"), get({}, "a", None), get({}, "a", 5)); t(lambda: get({}, "a"))
def f(x=MISSING): return "not given" if x is MISSING else ("given", x)
print(f(), f(None), f(MISSING), f.__defaults__)
match MISSING:
    case sentinel(): print("class pattern")
class NS: M = MISSING
def m(v):
    match v:
        case NS.M: return "value pattern"
        case _: return "other"
print(m(MISSING), m(other), m(None))
def in_function():
    local = sentinel("local")
    return local, local.__module__, local.__name__
print(in_function())
class K:
    S = sentinel("K.S")
print(K.S, K.S.__name__, K.S.__module__, K().S is K.S)
print(exec("s = sentinel('X'); print(s.__module__)", {"__name__": "other_mod"}), exec("s = sentinel('X'); print(s.__module__)", {}))
print(sorted(n for n in dir(MISSING) if not n.startswith("__")), [n for n in ("__name__", "__module__", "__copy__", "__deepcopy__", "__or__", "__ror__", "__reduce__", "__hash__", "__eq__", "__bool__", "__call__", "__dict__", "__weakref__") if hasattr(MISSING, n)])
print(sorted([sentinel("b"), sentinel("a")], key=repr), max([sentinel("b"), sentinel("a")], key=lambda s: s.__name__))
sentinel_backup = sentinel
sentinel = "the name can be rebound"; print(sentinel); del sentinel; print(sentinel is sentinel_backup)
