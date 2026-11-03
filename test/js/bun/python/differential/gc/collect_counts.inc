import gc, sys, io, re, collections, functools, itertools, weakref, types, operator, contextlib, threading, array, struct, json, datetime, decimal, enum, dataclasses, inspect, traceback, tempfile, os, asyncio, contextvars, pickle, copy, queue, random, hashlib, csv, string, typing, abc

class Plain: pass
class Slotted: __slots__ = ("a", "b")
class WithDel:
    def __del__(self): pass
class ListSub(list): pass
class DictSub(dict): pass
class TupleSub(tuple): pass
class IntSub(int): pass
class StrSub(str): pass
def function(a=1, *, b=2): return a
def closure():
    x = []
    def inner(): return x
    return inner
def generator():
    x = yield 1
    yield x
async def coroutine(): return 1
async def async_generator(): yield 1
def started(g): next(g); return g
def with_frame(g): g.gi_frame; return g
def raised():
    try: raise ValueError("x")
    except ValueError as e: return e
def raised_deep():
    def f(): g()
    def g(): raise KeyError("k")
    try: f()
    except KeyError as e: return e
def chained():
    try:
        try: raise ValueError(1)
        except ValueError as e: raise TypeError(2) from e
    except TypeError as e: return e
def attr(o, **kw):
    for k, v in kw.items(): setattr(o, k, v)
    return o
def cycle_instance(): o = Plain(); o.me = o; return o
def cycle_list(): l = []; l.append(l); return l
def cycle_two(): a = Plain(); b = Plain(); a.b = b; b.a = a; return a
def cycle_hanging(): a = Plain(); a.me = a; a.x = [Plain(), {1: Plain()}]; return a
def cycle_closure():
    def f(): return f
    return f
def cycle_method(): o = Plain(); o.m = o.__init__; return o
def cycle_generator():
    def g():
        me = yield
        yield me
    it = g(); next(it); it.send(it); return it
def cycle_exception():
    try: raise ValueError("x")
    except ValueError as e:
        keep = e
        return e
def cycle_del(): o = WithDel(); o.me = o; return o
def new_class():
    class C: pass
    return C
def new_class_with_methods():
    class C:
        x = 1
        def m(self): return __class__
    return C
@dataclasses.dataclass
class Data: x: int = 0
class Color(enum.Enum): RED = 1
def closed_coroutine(): c = coroutine(); c.close(); return c
def temp_file():
    f = tempfile.TemporaryFile(); f.write(b"x"); return f
def loop_and_task():
    loop = asyncio.new_event_loop()
    async def main(): await asyncio.sleep(0); return 1
    loop.run_until_complete(main()); loop.close(); return loop

kinds = [
    ("object", object), ("plain", Plain), ("plain with attributes", lambda: attr(Plain(), a=1, b=[2], c={3: 4})), ("plain with __dict__", lambda: attr(Plain(), a=1).__dict__),
    ("slotted", lambda: attr(Slotted(), a=[1])), ("with __del__", WithDel),
    ("list", lambda: [[1], [2, [3]]]), ("tuple", lambda: ([1], (2, [3]))), ("dict", lambda: {1: {2: [3]}}), ("set", lambda: {(1, 2), frozenset([3])}),
    ("list subclass", lambda: ListSub([[1]])), ("dict subclass", lambda: DictSub(a=[1])), ("tuple subclass", lambda: TupleSub([[1]])), ("int subclass", lambda: IntSub(5)), ("str subclass", lambda: StrSub("x")),
    ("bytes", lambda: b"x" * 100), ("bytearray", lambda: bytearray(10)), ("memoryview", lambda: memoryview(bytearray(10))), ("memoryview slice", lambda: memoryview(bytearray(10))[2:4]),
    ("range", lambda: range(10 ** 30)), ("slice", lambda: slice([1], [2])), ("complex", lambda: 1j), ("big int", lambda: 10 ** 50),
    ("lambda", lambda: (lambda: 1)), ("closure", closure), ("bound method", lambda: Plain().__init__), ("bound python method", lambda: Data().__repr__), ("builtin method", lambda: [].append),
    ("partial", lambda: functools.partial(function, [1])), ("cached", lambda: functools.lru_cache(maxsize=2)(lambda x: x)), ("property", lambda: property(function)),
    ("staticmethod", lambda: staticmethod(lambda: 1)), ("classmethod", lambda: classmethod(lambda c: 1)), ("cell", lambda: closure().__closure__[0]), ("code", lambda: compile("x = 1", "<s>", "exec")),
    ("generator", generator), ("generator started", lambda: started(generator())), ("generator with frame", lambda: with_frame(generator())), ("generator started with frame", lambda: with_frame(started(generator()))),
    ("generator expression", lambda: (x for x in [1])), ("coroutine closed", closed_coroutine), ("async generator", async_generator),
    ("list iterator", lambda: iter([1])), ("dict views", lambda: ({1: 2}.keys(), {1: 2}.items(), iter({1: 2}.values()))), ("enumerate zip map filter", lambda: (enumerate([1]), zip([1], [2]), map(str, [1]), filter(None, [1]), reversed([1]))),
    ("itertools", lambda: (itertools.chain([1], [2]), itertools.count(), itertools.cycle([1]), itertools.product([1], [2]), itertools.groupby([1]), itertools.tee([1]), itertools.islice([1], 1), itertools.accumulate([1]))),
    ("exception", lambda: ValueError("x", [1])), ("exception raised", raised), ("exception raised deep", raised_deep), ("exception chained", chained), ("exception group", lambda: ExceptionGroup("g", [ValueError(1)])),
    ("traceback", lambda: raised().__traceback__), ("frame", lambda: raised().__traceback__.tb_frame), ("frame locals", lambda: raised_deep().__traceback__.tb_next.tb_frame.f_locals), ("current frame", sys._getframe),
    ("traceback exception", lambda: traceback.TracebackException.from_exception(raised())),
    ("weakref", lambda: weakref.ref(Plain)), ("weakref with callback", lambda: weakref.ref(Plain, print)), ("proxy", lambda: weakref.proxy(Plain)), ("weak dicts", lambda: (weakref.WeakValueDictionary(), weakref.WeakKeyDictionary(), weakref.WeakSet())),
    ("weak method", lambda: weakref.WeakMethod(Data().__repr__)), ("weakly referenced", lambda: (lambda o: (o, weakref.ref(o)))(Plain())),
    ("deque", lambda: collections.deque([[1]])), ("defaultdict", lambda: collections.defaultdict(list, a=[1])), ("OrderedDict", lambda: collections.OrderedDict(a=[1])), ("Counter", lambda: collections.Counter("ab")),
    ("ChainMap", lambda: collections.ChainMap({1: 2})), ("namedtuple instance", lambda: sys.version_info), ("SimpleNamespace", lambda: types.SimpleNamespace(a=[1])), ("mappingproxy", lambda: types.MappingProxyType({1: 2})),
    ("module", lambda: types.ModuleType("m")), ("generic alias", lambda: list[int]), ("union", lambda: int | str), ("type var", lambda: typing.TypeVar("T")),
    ("itemgetter", lambda: (operator.itemgetter(1), operator.attrgetter("a"), operator.methodcaller("m"))),
    ("BytesIO", lambda: io.BytesIO(b"x")), ("StringIO", lambda: io.StringIO("x")), ("BytesIO buffer", lambda: io.BytesIO(b"x").getbuffer()), ("temporary file", temp_file), ("text wrapper", lambda: io.TextIOWrapper(io.BytesIO())),
    ("buffered", lambda: io.BufferedReader(io.BytesIO())), ("pattern", lambda: re.compile("a(b)" + "c")), ("match", lambda: re.match("a", "a")), ("scanner", lambda: re.finditer("a", "aa")),
    ("lock", lambda: (threading.Lock(), threading.RLock())), ("condition event", lambda: (threading.Condition(), threading.Event(), threading.Semaphore())), ("thread local", threading.local), ("thread object", lambda: threading.Thread(target=print)),
    ("queue", lambda: (queue.Queue(), queue.SimpleQueue())), ("array", lambda: array.array("i", [1])), ("Struct", lambda: struct.Struct("i")), ("json", lambda: (json.JSONEncoder(), json.JSONDecoder())),
    ("datetime", lambda: (datetime.datetime(2020, 1, 1), datetime.timedelta(1), datetime.timezone.utc)), ("decimal", lambda: (decimal.Decimal(1), decimal.Context())), ("random", random.Random), ("hash", lambda: hashlib.sha256(b"x")),
    ("dataclass instance", Data), ("enum member", lambda: Color.RED), ("context var", lambda: (contextvars.ContextVar("v"), contextvars.copy_context())), ("exit stack", contextlib.ExitStack),
    ("context manager", lambda: contextlib.contextmanager(generator)()), ("signature", lambda: inspect.signature(function)), ("pickler", lambda: (pickle.Pickler(io.BytesIO()), pickle.Unpickler(io.BytesIO()))),
    ("csv", lambda: (csv.reader([]), csv.writer(io.StringIO()))), ("formatter template", lambda: (string.Formatter(), string.Template("x"))), ("copies", lambda: (copy.copy(ListSub([1])), copy.deepcopy({1: [2]}))),
    ("future", lambda: asyncio.Future(loop=LOOP)), ("event loop run", loop_and_task),
    ("cycle: instance", cycle_instance), ("cycle: list", cycle_list), ("cycle: two", cycle_two), ("cycle: hanging", cycle_hanging), ("cycle: closure", cycle_closure), ("cycle: method", cycle_method),
    ("cycle: generator", cycle_generator), ("cycle: exception", cycle_exception), ("cycle: __del__", cycle_del), ("class", new_class), ("class with methods", new_class_with_methods),
    ("class instance and class", lambda: new_class()()), ("type()", lambda: type("T", (Plain,), {})), ("namedtuple class", lambda: collections.namedtuple("N", "a b")), ("enum class", lambda: enum.Enum("E", "A B")),
    ("abc class", lambda: abc.ABCMeta("A", (), {})), ("dataclass class", lambda: dataclasses.make_dataclass("D", ["x"])),
]
LOOP = asyncio.new_event_loop()
import warnings; warnings.simplefilter("ignore")
# How much is found of these depends on how the classes are put together inside, or on what is written in C there and in Python here.
roughly = {"cached", "namedtuple class", "abc class", "enum class", "dataclass class"}
def run(part, parts):
    gc.disable()
    for name, make in kinds[part::parts]:
        make(); gc.collect()  # What is made once and kept (caches) is made now.
        o = make()
        del o
        found = gc.collect()
        print(name, "whatever" if name in roughly else found, gc.collect())
    LOOP.close()
