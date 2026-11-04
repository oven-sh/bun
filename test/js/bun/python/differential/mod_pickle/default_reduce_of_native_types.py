# object.__reduce_ex__ and copyreg applied to instances of built-in types, and of classes derived from them: which hold something that
# __new__ without arguments could not bring back.
import ast, bz2, collections, contextvars, copy, datetime, decimal, fractions, functools, hashlib, io, itertools, lzma, operator, pickle, random, re
import struct, threading, types, weakref, zlib, array, queue, csv, json, uuid, _thread, enum, inspect, string, codecs, selectors, mmap, unicodedata


def generator():
    yield


async def coroutine():
    pass


class FromTzinfo(datetime.tzinfo):
    __reduce__ = object.__reduce__


class FromTzinfoWithSlots(datetime.tzinfo):
    __slots__ = ("a",)
    __reduce__ = object.__reduce__


class FromNamespace(types.SimpleNamespace):
    __reduce__ = object.__reduce__


class FromAst(ast.AST):
    __reduce__ = object.__reduce__


class FromLocal(threading.local):
    pass


class FromRandom(random.Random):
    __reduce__ = object.__reduce__
    __getstate__ = object.__getstate__


class FromPartial(functools.partial):
    __reduce__ = object.__reduce__


class FromDeque(collections.deque):
    __reduce__ = object.__reduce__


class FromIOBase(io.IOBase):
    pass


class FromBytesIO(io.BytesIO):
    __getstate__ = object.__getstate__


class FromException(Exception):
    __reduce__ = object.__reduce__


class FromProperty(property):
    pass


class FromDate(datetime.date):
    __reduce__ = object.__reduce__
    __reduce_ex__ = object.__reduce_ex__


class FromStruct(struct.Struct):
    pass


class FromContextVarToken:
    pass


a_coroutine = coroutine()
values = [
    object(), bz2.BZ2Compressor(), bz2.BZ2Decompressor(), lzma.LZMACompressor(), lzma.LZMADecompressor(), zlib.compressobj(), zlib.decompressobj(),
    hashlib.sha3_256(), hashlib.sha256(), hashlib.md5(), hashlib.blake2b(), types.MappingProxyType({}), generator(), a_coroutine, iter([]).__class__,
    memoryview(b""), (lambda: 0).__code__, threading.Lock(), threading.RLock(), _thread.allocate_lock(), threading.local(), FromLocal(),
    contextvars.ContextVar("v"), contextvars.copy_context(), re.compile("a").scanner("a"), re.match("a", "a"), struct.Struct("i"), FromStruct("i"),
    weakref.ref(generator), weakref.proxy(generator), io.StringIO(), io.BytesIO(), FromBytesIO(), io.IOBase(), FromIOBase(),
    datetime.tzinfo(), FromTzinfo(), FromTzinfoWithSlots(), types.SimpleNamespace(a=1), FromNamespace(a=1), ast.AST(), FromAst(), ast.Name("x"),
    FromRandom(), FromPartial(len), FromDeque([1]), FromException(1), FromProperty(), FromDate(2000, 1, 1), property(), staticmethod(len), classmethod(len),
    types.MethodType(len, 1), len, [].append, str.join, int.__add__, (1).__add__, type.__dict__["__name__"], functools.lru_cache(len),
    functools.cached_property(len), operator.itemgetter(1), operator.attrgetter("a"), operator.methodcaller("a"), itertools.count(), itertools.chain(),
    zip(), map(len, []), filter(None, []), enumerate([]), reversed([]), range(1), slice(1), iter(range(1)), {}.keys(), {}.values(), {}.items(),
    NotImplemented, Ellipsis, None, super(FromDate, FromDate(2000, 1, 1)), types.GenericAlias(list, int), int | str, queue.SimpleQueue(),
    csv.writer(io.StringIO()), json.JSONDecoder().scan_once, codecs.getincrementaldecoder("utf-8")(), string.Formatter(), decimal.Context(), decimal.Decimal(1),
    fractions.Fraction(1), uuid.UUID(int=1), array.array("i"), bytearray(), frozenset(), set(), collections.OrderedDict(), collections.defaultdict(),
    types.CellType(1), inspect.currentframe(), unicodedata.ucd_3_2_0, collections.deque().__iter__(), random.Random(1).__class__, selectors.DefaultSelector(),
]


def outcome(call):
    try:
        result = call()
    except Exception as e:
        return type(e).__name__ + ": " + re.sub(r" at 0x[0-9a-f]+", "", str(e))
    return "ok"


for value in values:
    name = type(value).__module__ + "." + type(value).__qualname__
    print(name)
    for protocol in (0, 2, 4):
        print("   object.__reduce_ex__", protocol, outcome(lambda: object.__reduce_ex__(value, protocol)))
    print("    __reduce_ex__(4)", outcome(lambda: value.__reduce_ex__(4)))
    print("    pickle.dumps", outcome(lambda: pickle.dumps(value)))
    print("    copy.copy", outcome(lambda: copy.copy(value)))
    print("    copy.deepcopy", outcome(lambda: copy.deepcopy(value)))
    print("    object.__getstate__", outcome(lambda: object.__getstate__(value)))
a_coroutine.close()
