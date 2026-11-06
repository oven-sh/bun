# The mro() of a metaclass can put a class among the bases of another that does not derive from it. For a built-in type whose instances are
# more than those of its base that is refused: its methods would be handed something else.
try: import array, collections, contextvars, datetime, decimal, functools, io, itertools, operator, os, re, struct, sys, types, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import array, collections, contextvars, datetime, decimal, functools,...')


try:
    def generator():
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator():')


try:
    async def coroutine():
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def coroutine():')


try:
    async def async_generator():
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def async_generator():')


try:
    class Slots:
        __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slots:')


try:
    try:
        raise ValueError
    except ValueError as error:
        traceback = error.__traceback__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: closed = coroutine()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: closed = coroutine()')
try: closed.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: closed.close()')

try: TYPES = [
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TYPES = [ types.CodeType, types.FrameType, types.FunctionType, types....')
# What waits, or ends the program.
try: LEFT_OUT = {'__new__', '__init_subclass__', '__class__', '__del__', 'read', 'readline', 'readlines', 'readall', 'readinto', 'readinto1', 'read1', 'peek', 'write', 'writelines', 'flush', 'close', '__enter__',
    '__exit__', 'run', 'send', 'throw', '__await__', '__next__', '__iter__', 'detach', 'truncate', 'seek', 'tell', 'fileno', 'isatty'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LEFT_OUT = {'__new__', '__init_subclass__', '__class__', '__del__', '...")


try:
    def name_of(t):
        return '%s.%s' % (t.__module__, t.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def name_of(t):')


try:
    for T in TYPES:
        try: base = T.__base__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base = T.__base__')
        while not base.__flags__ & 1 << 10:
            try: base = base.__base__
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base = base.__base__')

        class Meta(type(T)):
            def mro(cls):
                return [cls, T, *T.__mro__[1:]]
        try:
            C = Meta('C', (base,), {})
        except TypeError as error:
            print('name_of(T) [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', name_of(T))
            print('refused:', 'error [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', error)
            continue
        try: made = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: made = []')
        for make in (lambda: base.__new__(C), lambda: C(), lambda: object.__new__(C)):
            try:
                made.append(make())
            except Exception:
                pass
        try: calls = 0
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls = 0')
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
                    try: calls += 1
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls += 1')
                    try:
                        value(*args)
                    except Exception:
                        pass
        try: print('name_of(T) [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', name_of(T))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name_of(T)')
        try: print('accepted, with', 'name_of(base) [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', name_of(base))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name_of(base)')
        try: print('for a base:', '[type(o) is C for o in made] [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', [type(o) is C for o in made])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(o) is C for o in made]')
        try: print('calls > 0 [' + 'T=' + (repr(T) if type(T) in (str, int, float, bytes, bool, type(None)) or (type(T) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in T)) else T.__name__ if type(T) is type else type(T).__name__) + '] =>', calls > 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls > 0')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for T in TYPES:')
