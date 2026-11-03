# What CPython makes at run time, as a class statement would: the exceptions of modules, struct sequences, most types outside builtins.
import struct, binascii, _csv, _pickle, _queue, signal, socket, termios, zlib, sqlite3, _hashlib, time, os, weakref
import xml.parsers.expat as expat
import compression.zstd as zstd
L = [struct.error, binascii.Error, binascii.Incomplete, _csv.Error, _pickle.PickleError, _pickle.PicklingError, _pickle.UnpicklingError, _queue.Empty,
     signal.ItimerError, socket.herror, socket.gaierror, termios.error, zlib.error, sqlite3.Error, sqlite3.Warning, sqlite3.DatabaseError, sqlite3.IntegrityError,
     _hashlib.UnsupportedDigestmodError, expat.ExpatError, zstd.ZstdError, ExceptionGroup, BaseExceptionGroup, time.struct_time, os.stat_result, os.terminal_size]
for t in L:
    try:
        t.some_attribute = 1; del t.some_attribute; mutable = True
    except TypeError:
        mutable = False
    try:
        weakref.ref(t() if issubclass(t, BaseException) and not issubclass(t, BaseExceptionGroup) else t('x', [ValueError()]) if issubclass(t, BaseException) else t(range(t.n_fields))); weak = True
    except TypeError:
        weak = False
    print(t.__module__, t.__qualname__, sorted(k for k in vars(t) if k in ('__weakref__', '__module__', '__dict__', '__doc__')), mutable, weak, t.__weakrefoffset__ != 0, bool(t.__flags__ & (1 << 9)), t.__base__.__name__)

import array, collections, datetime, functools, itertools, re, sys, types
# Their instances find __module__ in the class. Those of the types that are part of the interpreter do not.
for obj in (collections.deque(), functools.partial(len), itertools.count(), re.compile('x'), array.array('b'), struct.Struct('i'), time.gmtime(), struct.error(),
            1, 'x', [], {}, 1.5, collections.OrderedDict(), datetime.date(2000, 1, 1), types.SimpleNamespace(), sys.version_info, sys.flags, ValueError()):
    cls = type(obj)
    print(cls.__module__, cls.__qualname__, getattr(obj, '__module__', None), '__module__' in vars(cls), bool(cls.__flags__ & (1 << 9)), bool(cls.__flags__ & (1 << 8)))
def g(): pass
print(functools.wraps(functools.partial(len))(g).__module__)
struct.error.__module__ = 'elsewhere'
print(struct.error.__module__, repr(struct.error))
struct.error.__module__ = 'struct'

# The struct sequences of sys.
for name in ('version_info', 'flags', 'float_info', 'int_info', 'hash_info', 'thread_info'):
    value = getattr(sys, name)
    try:
        print(name, type(value)(tuple(value)) == value)
    except TypeError as e:
        print(name, e)
    try:
        type(value).x = 1
    except TypeError as e:
        print('   ', e)

# A type with one comparison has all six, of its own.
for cls in (dict, frozendict, complex, range, type(None), sentinel, types.SimpleNamespace, types.GenericAlias, type(len), type(g.__code__), re.Pattern, slice, set, int, str, list, tuple, object,
            collections.deque, collections.OrderedDict, datetime.date, types.MappingProxyType, type, type(g), BaseException, memoryview, bytes):
    print(cls.__name__, [name for name in ('__eq__', '__ne__', '__lt__', '__le__', '__gt__', '__ge__', '__hash__') if name in vars(cls)])
print(dict.__lt__({}, {}), complex.__ge__(1j, 1j), range.__le__(range(1), range(1)), repr(dict.__lt__), dict.__lt__.__doc__, dict.__lt__.__objclass__.__name__)
@functools.total_ordering
class OrderedByLength(dict):
    def __lt__(self, other): return len(self) < len(other)
for op in (lambda a, b: a < b, lambda a, b: a <= b, lambda a, b: a > b, lambda a, b: a >= b):
    try:
        print(op(OrderedByLength(), OrderedByLength(a=1)))
    except TypeError as e:
        print(e)

# And some repeat what object has.
for cls in (collections.deque, collections.defaultdict, functools.partial, itertools.chain, array.array, struct.Struct, dict, list, int, type, types.ModuleType, collections.OrderedDict):
    print(cls.__name__, [name for name in ('__getattribute__', '__setattr__', '__delattr__') if name in vars(cls)])
print(repr(collections.deque.__getattribute__), collections.deque.__getattribute__(collections.deque([1]), 'maxlen'))
print(type(collections.deque.__dict__.get('__dict__')).__name__, BaseException.__dict__['__dict__'].__doc__, type(g).__dict__['__dict__'].__doc__)
print(builtins_doc := __import__('builtins').__doc__.splitlines()[0], '|', sys.__doc__.splitlines()[0])
print(_IncompleteInputError.__doc__, _IncompleteInputError.__name__, __import__('math').comb.__doc__.splitlines()[0])
