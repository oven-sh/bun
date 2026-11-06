# The mro() of a metaclass can put a class among the bases of another that does not derive from it. For a built-in type whose instances are
# more than those of its base that is refused: its methods would be handed something else.
import array, collections, contextvars, datetime, decimal, functools, io, itertools, operator, os, re, struct, sys, types, weakref


def generator():
    yield


async def coroutine():
    pass


async def async_generator():
    yield


class Slots:
    __slots__ = ('x',)


try:
    raise ValueError
except ValueError as error:
    traceback = error.__traceback__
closed = coroutine()
closed.close()

TYPES = [
    types.CodeType, types.FrameType, types.FunctionType, types.GeneratorType, types.CoroutineType, types.AsyncGeneratorType, types.MethodType, types.BuiltinFunctionType,
    types.WrapperDescriptorType, types.MethodWrapperType, types.MethodDescriptorType, types.ClassMethodDescriptorType, types.GetSetDescriptorType, types.MemberDescriptorType,
    types.MappingProxyType, types.TracebackType, types.CellType, types.SimpleNamespace, types.ModuleType, types.GenericAlias, types.UnionType, types.CapsuleType,
    range, slice, memoryview, property, staticmethod, classmethod, super, enumerate, zip, map, filter, reversed,
    int, float, complex, str, bytes, bytearray, list, tuple, dict, set, frozenset, type, BaseException, Exception, OSError, SyntaxError, StopIteration, KeyError,
    type({}.keys()), type({}.values()), type({}.items()), type(iter([])), type(iter(())), type(iter({})), type(iter(set())), type(iter('')), type(iter(b'')), type(iter(range(1))),
    type(reversed([])), type(iter(lambda: 0, 0)),
    contextvars.Context, contextvars.ContextVar, contextvars.Token,
    collections.deque, collections.defaultdict, collections.OrderedDict, functools.partial, type(functools.lru_cache(len)), itertools.count, itertools.chain, itertools.islice,
    operator.itemgetter, operator.attrgetter, operator.methodcaller, io.BytesIO, io.StringIO, io.FileIO, io.BufferedReader, io.TextIOWrapper, io.IOBase,
    re.Pattern, re.Match, datetime.date, datetime.time, datetime.datetime, datetime.timedelta, datetime.timezone, datetime.tzinfo, decimal.Decimal, decimal.Context,
    array.array, struct.Struct, os.DirEntry, weakref.ref, weakref.ProxyType, weakref.CallableProxyType,
]
# What waits, or ends the program.
LEFT_OUT = {'__new__', '__init_subclass__', '__class__', '__del__', 'read', 'readline', 'readlines', 'readall', 'readinto', 'readinto1', 'read1', 'peek', 'write', 'writelines', 'flush', 'close', '__enter__',
    '__exit__', 'run', 'send', 'throw', '__await__', '__next__', '__iter__', 'detach', 'truncate', 'seek', 'tell', 'fileno', 'isatty'}


def name_of(t):
    return '%s.%s' % (t.__module__, t.__qualname__)


for T in TYPES:
    base = T.__base__
    while not base.__flags__ & 1 << 10:
        base = base.__base__

    class Meta(type(T)):
        def mro(cls):
            return [cls, T, *T.__mro__[1:]]
    try:
        C = Meta('C', (base,), {})
    except TypeError as error:
        print(name_of(T), 'refused:', error)
        continue
    made = []
    for make in (lambda: base.__new__(C), lambda: C(), lambda: object.__new__(C)):
        try:
            made.append(make())
        except Exception:
            pass
    calls = 0
    for o in made:
        for name in sorted(vars(T)):
            if name in LEFT_OUT:
                continue
            try:
                value = getattr(o, name)
            except Exception:
                continue
            if not callable(value) or isinstance(value, type):
                continue
            for args in ((), (0,), (o,), ('a',), (0, 0), (o, o), (None, None, None)):
                calls += 1
                try:
                    value(*args)
                except Exception:
                    pass
    print(name_of(T), 'accepted, with', name_of(base), 'for a base:', [type(o) is C for o in made], calls > 0)
