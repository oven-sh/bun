# Wherever the program keeps a view, the exporter cannot be resized; once it lets go, it can.
import collections, functools, weakref, types, itertools, operator, gc
b = bytearray(b'abc')
def blocked():
    try:
        b.append(0)
    except BufferError:
        return True
    b.pop()
    return False
def check(name, make):
    holder = make()
    first = blocked()
    second = blocked() if name in ('variable', 'list', 'attribute', 'generator', 'closure') else None   # by now the view is old
    del holder
    if name in CYCLIC: gc.collect()     # CPython needs it for these
    print(name, first, second, blocked())
CYCLIC = ('class attribute', 'cycle', 'traceback', 'closure', 'default', 'keyword default', 'generator', 'generator temporary', 'coroutine', 'module')
V = lambda: memoryview(b)
class Plain: pass
class Slots:
    __slots__ = ('v',)
def attribute():
    o = Plain(); o.v = V(); return o
def slot():
    o = Slots(); o.v = V(); return o
def generator():
    def g():
        v = V()
        yield 1
        yield v
    it = g(); next(it); return it
def generator_temporary():
    def g():
        yield len(V()[(yield 1):])
    it = g(); next(it); return it
def coroutine():
    class Aw:
        def __await__(self): yield 1
    async def co():
        v = V()
        await Aw()
        return v
    c = co(); c.send(None); return c
def closure():
    v = V()
    return lambda: v
def default():
    def f(a=V()): pass
    return f
def kwdefault():
    def f(*, a=V()): pass
    return f
def class_attribute():
    class C: v = V()
    return C
def traceback_frame():
    def f():
        v = V()
        raise KeyError
    try: f()
    except KeyError as e: return e
def exception_args(): return ValueError(V())
def cycle():
    o = Plain(); o.v = V(); o.me = o; return o
def nested(): return [({'k': [V()]},)]
def weak_only():
    v = V(); return weakref.ref(v)
def module():
    m = types.ModuleType('m'); m.v = V(); return m
CASES = (
    ('variable', V), ('slice', lambda: V()[1:]), ('cast', lambda: V().cast('b')), ('readonly', lambda: V().toreadonly()), ('view of view', lambda: memoryview(V())), ('__buffer__', lambda: V().__buffer__(0)),
    ('list', lambda: [V()]), ('tuple', lambda: (V(),)), ('dict value', lambda: {1: V()}), ('dict key', lambda: {V().toreadonly()[0:0]: 1} if False else {1: {2: V()}}), ('set', lambda: {id(1), Plain()} and [frozenset([Plain()]), V()]),
    ('deque', lambda: collections.deque([V()])), ('defaultdict', lambda: collections.defaultdict(list, a=V())), ('OrderedDict', lambda: collections.OrderedDict(a=V())), ('namedtuple', lambda: collections.namedtuple('N', 'v')(V())),
    ('attribute', attribute), ('slot', slot), ('class attribute', class_attribute), ('module', module), ('namespace', lambda: types.SimpleNamespace(v=V())),
    ('bound method', lambda: V().tobytes), ('iterator', lambda: iter(V())), ('reversed', lambda: reversed(V())), ('enumerate', lambda: enumerate(V())), ('zip', lambda: zip(V(), V())), ('map', lambda: map(int, V())), ('filter', lambda: filter(None, V())), ('chain', lambda: itertools.chain(V())), ('islice', lambda: itertools.islice(V(), 1)), ('repeat', lambda: itertools.repeat(V())),
    ('partial', lambda: functools.partial(len, V())), ('partial keyword', lambda: functools.partial(print, x=V())), ('itemgetter target', lambda: functools.partial(operator.itemgetter(0), V())), ('methodcaller', lambda: operator.methodcaller('x', V())),
    ('closure', closure), ('default', default), ('keyword default', kwdefault), ('generator', generator), ('generator temporary', generator_temporary), ('coroutine', coroutine),
    ('traceback', traceback_frame), ('exception', exception_args), ('cycle', cycle), ('nested', nested), ('slice object', lambda: slice(V())), ('property', lambda: property(V())), ('staticmethod', lambda: staticmethod(V())), ('cell', lambda: types.CellType(V())), ('method', lambda: types.MethodType(len, V())), ('mappingproxy', lambda: types.MappingProxyType({1: V()})),
    ('weak reference only', weak_only),
)
for name, make in CASES[0::3]:
    check(name, make)
