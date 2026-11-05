# hash() by all the ways it can be come by, for every built-in type that has a hash of its own.
import collections, datetime, functools, operator, os, sys, types, weakref

class O: pass
def f(): pass
o = O()
D = datetime
VALUES = {
    str: ['', 'a', 'abc' * 30, '€', '\U0001f600' * 3], bytes: [b'', b'a', b'abc' * 30], int: [0, 1, -1, 2 ** 61 - 1, 2 ** 64, -10 ** 30], float: [0.0, 1.5, -1.5, 1e300, float('inf'), float('nan')],
    complex: [1j, 1 + 2j], tuple: [(), (1,), ('a', 2.5, (None,)), tuple(range(50))], range: [range(0), range(5), range(1, 10, 3), range(10 ** 30)], slice: [slice(None), slice(1, 2, 3), slice('a', (1,), None)],
    frozenset: [frozenset(), frozenset('abc'), frozenset([frozenset([1]), 2])], object: [object(), o, f, sys], types.MethodType: [o.__init__, [].append.__self__.__class__.append.__get__([]), types.MethodType(f, 1)][2:],
    weakref.ref: [weakref.ref(o), weakref.ref(O)], D.date: [D.date(2024, 2, 29)], D.time: [D.time(1, 2, 3), D.time(1, tzinfo=D.timezone.utc)], D.datetime: [D.datetime(2024, 2, 29, 12), D.datetime(2024, 2, 29, tzinfo=D.timezone.utc)],
    D.timedelta: [D.timedelta(0), D.timedelta(-1, 5, 7)], D.timezone: [D.timezone.utc, D.timezone(D.timedelta(hours=5))], type(None): [None], types.MappingProxyType: [types.MappingProxyType('abc'), types.MappingProxyType(b'ab')],
}
for cls, values in VALUES.items():
    plain = [hash(v) for v in values]
    ways = {
        'method': [v.__hash__() for v in values],
        'of the class': [cls.__hash__(v) for v in values],
        'map': list(map(cls.__hash__, values)),
        'map hash': list(map(hash, values)),
        'methodcaller': [operator.methodcaller('__hash__')(v) for v in values],
        'partial': [functools.partial(cls.__hash__, v)() for v in values],
        'sorted': sorted(values, key=cls.__hash__) == sorted(values, key=hash),
        'min': min(values, key=cls.__hash__) is min(values, key=hash),
        'reduce': functools.reduce(lambda a, v: a ^ cls.__hash__(v), values, 0) == functools.reduce(lambda a, v: a ^ hash(v), values, 0),
        'filter': len(list(filter(cls.__hash__, values))) == sum(1 for h in plain if h),
        'getattr': [getattr(v, '__hash__')() for v in values],
        'star': [cls.__hash__(*[v]) for v in values],
        'wrapper': [cls.__hash__.__get__(v, cls)() if v is not None else hash(v) for v in values],
        'call': [cls.__hash__.__call__(v) for v in values],
        'object': [object.__hash__(v) == object.__hash__(v) for v in values] == [True] * len(values),
        'super': [super(cls, v).__hash__() == object.__hash__(v) for v in values] == [True] * len(values) if cls.__mro__[1:2] == (object,) and cls is not type(None) else True,
        'in a set': all(v in {v} and v in frozenset([v]) for v in values),
        'in a dict': all({v: 1}[v] == 1 and collections.Counter([v, v])[v] == 2 for v in values),
        'lru_cache': [functools.lru_cache(maxsize=None)(lambda x, y: 1)(v, v) for v in values] == [1] * len(values),
        'ints': all(type(h) is int and h != -1 and -2 ** 63 <= h < 2 ** 63 for h in plain),
    }
    print(cls.__name__, [name for name, got in ways.items() if got is not True and got != plain])
for cls in VALUES:
    for wrong in (1, 'a', None, ()):
        if isinstance(wrong, cls) or cls is object: continue
        try: cls.__hash__(wrong); print(cls.__name__, 'takes', wrong)
        except TypeError: pass
    for arguments in ((), (VALUES[cls][0], 1)):
        try: cls.__hash__(*arguments); print(cls.__name__, 'takes', len(arguments))
        except TypeError: pass

# What is hashed by hashing what it holds, 100,000 deep: a number comes out, or RecursionError, but the process goes on.
def deep(kind, n):
    keep = []
    if kind == 'slice':
        s = slice(None)
        for _ in range(n): s = slice(s)
    elif kind == 'slice stop':
        s = slice(None)
        for _ in range(n): s = slice(1, s)
    elif kind == 'mappingproxy':
        s = types.MappingProxyType('abc')
        for _ in range(n): s = types.MappingProxyType(s)
    elif kind == 'method':
        s = f
        for _ in range(n): s = types.MethodType(s, 1)
    elif kind == 'tuple':
        s = ()
        for _ in range(n): s = (s,)
    elif kind == 'weakref':
        class R(weakref.ref): pass
        keep.append(O())
        for _ in range(n): keep.append(R(keep[-1]))
        s = keep[-1]
    elif kind == 'slice and tuple':
        s = ()
        for _ in range(n): s = (slice(s),)
    elif kind == 'all':
        s = ()
        for i in range(n): s = [lambda s: (s,), slice, lambda s: types.MethodType(types.MethodType(f, 1), s), lambda s: (1, s)][i % 4](s)
    return s, keep
everything = []
for kind in ('slice', 'slice stop', 'mappingproxy', 'method', 'tuple', 'weakref', 'slice and tuple', 'all'):
    s, keep = deep(kind, 100_000)
    everything.append((s, keep))
    outcomes = []
    for use in (hash, lambda s: {s}, lambda s: {s: 1}, lambda s: s in {1}, lambda s: {1: 2}.get(s), lambda s: s.__hash__(), lambda s: frozenset([s]), lambda s: collections.Counter([s])):
        try: use(s); outcomes.append(True)
        except RecursionError: outcomes.append(True)
    print(kind, all(outcomes), kind == 'weakref' or hash(deep(kind, 50)[0]) == hash(deep(kind, 50)[0]))
sys.stdout.flush()
os._exit(0)           # (To free such chains is another matter.)
