# What CPython makes at run time, as a class statement would: the exceptions of modules, struct sequences, most types outside builtins.
try: import struct, binascii, _csv, _pickle, _queue, signal, socket, termios, zlib, sqlite3, _hashlib, time, os, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import struct, binascii, _csv, _pickle, _queue, signal, socket, termi...')
try: import xml.parsers.expat as expat
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import xml.parsers.expat as expat')
try: import compression.zstd as zstd
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import compression.zstd as zstd')
try: L = [struct.error, binascii.Error, binascii.Incomplete, _csv.Error, _pickle.PickleError, _pickle.PicklingError, _pickle.UnpicklingError, _queue.Empty,
     signal.ItimerError, socket.herror, socket.gaierror, termios.error, zlib.error, sqlite3.Error, sqlite3.Warning, sqlite3.DatabaseError, sqlite3.IntegrityError,
     _hashlib.UnsupportedDigestmodError, expat.ExpatError, zstd.ZstdError, ExceptionGroup, BaseExceptionGroup, time.struct_time, os.stat_result, os.terminal_size]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L = [struct.error, binascii.Error, binascii.Incomplete, _csv.Error, _...')
try:
    for t in L:
        try:
            t.some_attribute = 1
            del t.some_attribute
            mutable = True
        except TypeError:
            mutable = False
        try:
            weakref.ref(t() if issubclass(t, BaseException) and not issubclass(t, BaseExceptionGroup) else t('x', [ValueError()]) if issubclass(t, BaseException) else t(range(t.n_fields)))
            weak = True
        except TypeError:
            weak = False
        try: print('t.__module__ [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', t.__module__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.__module__')
        try: print('t.__qualname__ [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', t.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.__qualname__')
        try: print("sorted(k for k in vars(t) if k in ('__weakref__', '__module__', '__di... [" + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', sorted(k for k in vars(t) if k in ('__weakref__', '__module__', '__dict__', '__doc__')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(k for k in vars(t) if k in ('__weakref__', '__module__', '__di...")
        try: print('mutable [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', mutable)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mutable')
        try: print('weak [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', weak)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: weak')
        try: print('t.__weakrefoffset__ != 0 [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', t.__weakrefoffset__ != 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.__weakrefoffset__ != 0')
        try: print('bool(t.__flags__ & (1 << 9)) [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', bool(t.__flags__ & (1 << 9)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(t.__flags__ & (1 << 9))')
        try: print('t.__base__.__name__ [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', t.__base__.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.__base__.__name__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for t in L:')

try: import array, collections, datetime, functools, itertools, re, sys, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import array, collections, datetime, functools, itertools, re, sys, t...')
# Their instances find __module__ in the class. Those of the types that are part of the interpreter do not.
try:
    for obj in (collections.deque(), functools.partial(len), itertools.count(), re.compile('x'), array.array('b'), struct.Struct('i'), time.gmtime(), struct.error(),
                1, 'x', [], {}, 1.5, collections.OrderedDict(), datetime.date(2000, 1, 1), types.SimpleNamespace(), sys.version_info, sys.flags, ValueError()):
        try: cls = type(obj)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls = type(obj)')
        try: print('cls.__module__ [' + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', cls.__module__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__module__')
        try: print('cls.__qualname__ [' + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', cls.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__qualname__')
        try: print("getattr(obj, '__module__', None) [" + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', getattr(obj, '__module__', None))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(obj, '__module__', None)")
        try: print("'__module__' in vars(cls) [" + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', '__module__' in vars(cls))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '__module__' in vars(cls)")
        try: print('bool(cls.__flags__ & (1 << 9)) [' + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', bool(cls.__flags__ & (1 << 9)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(cls.__flags__ & (1 << 9))')
        try: print('bool(cls.__flags__ & (1 << 8)) [' + 'obj=' + (repr(obj) if type(obj) in (str, int, float, bytes, bool, type(None)) or (type(obj) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in obj)) else obj.__name__ if type(obj) is type else type(obj).__name__) + '] =>', bool(cls.__flags__ & (1 << 8)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(cls.__flags__ & (1 << 8))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for obj in (collections.deque(), functools.partial(len), itertools.co...')
try:
    def g(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(): pass')
try: print(functools.wraps(functools.partial(len))(g).__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: functools.wraps(functools.partial(len))(g).__module__')
try: struct.error.__module__ = 'elsewhere'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: struct.error.__module__ = 'elsewhere'")
try: print('struct.error.__module__ =>', struct.error.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__module__')
try: print('repr(struct.error) =>', repr(struct.error))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(struct.error)')
try: struct.error.__module__ = 'struct'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: struct.error.__module__ = 'struct'")

# The struct sequences of sys.
try:
    for name in ('version_info', 'flags', 'float_info', 'int_info', 'hash_info', 'thread_info'):
        try: value = getattr(sys, name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: value = getattr(sys, name)')
        try:
            print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
            print('type(value)(tuple(value)) == value [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', type(value)(tuple(value)) == value)
        except TypeError as e:
            print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
            print('e [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', e)
        try:
            type(value).x = 1
        except TypeError as e:
            print('   ', 'e [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('version_info', 'flags', 'float_info', 'int_info', 'hash...")

# A type with one comparison has all six, of its own.
try:
    for cls in (dict, frozendict, complex, range, type(None), sentinel, types.SimpleNamespace, types.GenericAlias, type(len), type(g.__code__), re.Pattern, slice, set, int, str, list, tuple, object,
                collections.deque, collections.OrderedDict, datetime.date, types.MappingProxyType, type, type(g), BaseException, memoryview, bytes):
        try: print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', cls.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__name__')
        try: print("[name for name in ('__eq__', '__ne__', '__lt__', '__le__', '__gt__', ... [" + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', [name for name in ('__eq__', '__ne__', '__lt__', '__le__', '__gt__', '__ge__', '__hash__') if name in vars(cls)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: [name for name in ('__eq__', '__ne__', '__lt__', '__le__', '__gt__', ...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (dict, frozendict, complex, range, type(None), sentinel, t...')
try: print('dict.__lt__({}, {}) =>', dict.__lt__({}, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict.__lt__({}, {})')
try: print('complex.__ge__(1j, 1j) =>', complex.__ge__(1j, 1j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: complex.__ge__(1j, 1j)')
try: print('range.__le__(range(1), range(1)) =>', range.__le__(range(1), range(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: range.__le__(range(1), range(1))')
try: print('repr(dict.__lt__) =>', repr(dict.__lt__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(dict.__lt__)')
try: print('dict.__lt__.__doc__ =>', dict.__lt__.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict.__lt__.__doc__')
try: print('dict.__lt__.__objclass__.__name__ =>', dict.__lt__.__objclass__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict.__lt__.__objclass__.__name__')
try:
    @functools.total_ordering
    class OrderedByLength(dict):
        def __lt__(self, other): return len(self) < len(other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OrderedByLength(dict):')
try:
    for op in (lambda a, b: a < b, lambda a, b: a <= b, lambda a, b: a > b, lambda a, b: a >= b):
        try:
            print('op(OrderedByLength(), OrderedByLength(a=1)) [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', op(OrderedByLength(), OrderedByLength(a=1)))
        except TypeError as e:
            print('e [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for op in (lambda a, b: a < b, lambda a, b: a <= b, lambda a, b: a > ...')

# And some repeat what object has.
try:
    for cls in (collections.deque, collections.defaultdict, functools.partial, itertools.chain, array.array, struct.Struct, dict, list, int, type, types.ModuleType, collections.OrderedDict):
        try: print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', cls.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__name__')
        try: print("[name for name in ('__getattribute__', '__setattr__', '__delattr__') ... [" + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', [name for name in ('__getattribute__', '__setattr__', '__delattr__') if name in vars(cls)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: [name for name in ('__getattribute__', '__setattr__', '__delattr__') ...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (collections.deque, collections.defaultdict, functools.par...')
try: print('repr(collections.deque.__getattribute__) =>', repr(collections.deque.__getattribute__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(collections.deque.__getattribute__)')
try: print("collections.deque.__getattribute__(collections.deque([1]), 'maxlen') =>", collections.deque.__getattribute__(collections.deque([1]), 'maxlen'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: collections.deque.__getattribute__(collections.deque([1]), 'maxlen')")
try: print("type(collections.deque.__dict__.get('__dict__')).__name__ =>", type(collections.deque.__dict__.get('__dict__')).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(collections.deque.__dict__.get('__dict__')).__name__")
try: print("BaseException.__dict__['__dict__'].__doc__ =>", BaseException.__dict__['__dict__'].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BaseException.__dict__['__dict__'].__doc__")
try: print("type(g).__dict__['__dict__'].__doc__ =>", type(g).__dict__['__dict__'].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(g).__dict__['__dict__'].__doc__")
try: print("builtins_doc := __import__('builtins').__doc__.splitlines()[0] =>", builtins_doc := __import__('builtins').__doc__.splitlines()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: builtins_doc := __import__('builtins').__doc__.splitlines()[0]")
try: print('|', 'sys.__doc__.splitlines()[0] =>', sys.__doc__.splitlines()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__doc__.splitlines()[0]')
try: print('_IncompleteInputError.__doc__ =>', _IncompleteInputError.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _IncompleteInputError.__doc__')
try: print('_IncompleteInputError.__name__ =>', _IncompleteInputError.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _IncompleteInputError.__name__')
try: print("__import__('math').comb.__doc__.splitlines()[0] =>", __import__('math').comb.__doc__.splitlines()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: __import__('math').comb.__doc__.splitlines()[0]")
