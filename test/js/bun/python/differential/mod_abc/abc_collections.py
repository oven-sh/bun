import abc, _abc, collections, collections.abc as cabc, numbers, io, typing

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e)

names = ['Awaitable', 'Coroutine', 'AsyncIterable', 'AsyncIterator', 'AsyncGenerator', 'Hashable', 'Iterable', 'Iterator', 'Generator',
         'Reversible', 'Sized', 'Container', 'Callable', 'Collection', 'Set', 'MutableSet', 'Mapping', 'MutableMapping', 'MappingView',
         'KeysView', 'ItemsView', 'ValuesView', 'Sequence', 'MutableSequence', 'Buffer']
def g(): yield
async def co(): pass
async def ag(): yield
c = co()
values = [1, 1.5, 'x', b'x', bytearray(b'x'), [], (), {}, set(), frozenset(), range(3), iter([]), g(), c, ag(), len, lambda: 0, None, int,
          {}.keys(), {}.values(), {}.items(), collections.deque(), collections.OrderedDict(), collections.defaultdict(int), collections.Counter(),
          collections.ChainMap(), collections.UserDict(), collections.UserList(), collections.UserString('x'), memoryview(b'x'), type, object(),
          reversed([]), enumerate([]), zip(), map(len, []), io.StringIO(), slice(1), NotImplemented, ..., 1j, True]
for n in names:
    T = getattr(cabc, n)
    print(n, ''.join('1' if isinstance(v, T) else '0' for v in values), ''.join('1' if issubclass(type(v), T) else '0' for v in values))
    print(n, sorted(T.__abstractmethods__))
c.close()
for n in ('Number', 'Complex', 'Real', 'Rational', 'Integral'):
    T = getattr(numbers, n)
    print(n, ''.join('1' if isinstance(v, T) else '0' for v in values))

# Pattern matching goes by the flags that _abc_init and _abc_register set
def kind(x):
    match x:
        case [*_]: return 'seq'
        case {}: return 'map'
        case _: return 'other'
class MySeq(cabc.Sequence):
    def __getitem__(self, i): raise IndexError
    def __len__(self): return 0
class MyMap(cabc.Mapping):
    def __getitem__(self, k): raise KeyError
    def __len__(self): return 0
    def __iter__(self): return iter(())
class SubSeq(MySeq): pass
class SubMap(MyMap): pass
class Reg: 
    def __len__(self): return 0
    def __getitem__(self, i): raise IndexError
class RegSub(Reg): pass
print(kind(MySeq()), kind(MyMap()), kind(SubSeq()), kind(SubMap()), kind(Reg()), kind(RegSub()))
cabc.Sequence.register(Reg)
class RegSub2(Reg): pass
print(kind(Reg()), kind(RegSub()), kind(RegSub2()))
class RegM:
    def keys(self): return []
    def __getitem__(self, k): raise KeyError
    def get(self, k, d=None): return d
    def __len__(self): return 0
cabc.Mapping.register(RegM)
print(kind(RegM()))
cabc.Sequence.register(RegM)   # the last one wins
print(kind(RegM()))
print(kind([]), kind(()), kind({}), kind('x'), kind(b'x'), kind(bytearray()), kind(range(2)), kind(collections.deque()), kind(collections.OrderedDict()),
      kind(collections.UserList()), kind(collections.UserDict()), kind(memoryview(b'')), kind(set()), kind(collections.ChainMap()), kind(collections.UserString('')))
print('__abc_tpflags__' in cabc.Sequence.__dict__, '__abc_tpflags__' in cabc.Mapping.__dict__, hasattr(cabc.Sequence, '__abc_tpflags__'))
class Flag1(abc.ABC):
    __abc_tpflags__ = 1 << 5
class Flag2(abc.ABC):
    __abc_tpflags__ = 1 << 6
class Flag0(abc.ABC):
    __abc_tpflags__ = 'x'
class Flag3(abc.ABC):
    __abc_tpflags__ = 1 << 7
print(hasattr(Flag1, '__abc_tpflags__'), hasattr(Flag0, '__abc_tpflags__'), hasattr(Flag3, '__abc_tpflags__'))
try:
    class FlagBoth(abc.ABC):
        __abc_tpflags__ = (1 << 5) | (1 << 6)
except TypeError as e:
    print('TypeError', e)
try:
    class FlagBig(abc.ABC):
        __abc_tpflags__ = 2 ** 70
except OverflowError as e:
    print('OverflowError', e)
class F1(Flag1):
    def __len__(self): return 0
    def __getitem__(self, i): raise IndexError
class F2(Flag2):
    def keys(self): return []
    def __len__(self): return 0
print(kind(F1()), kind(F2()))

# update_abstractmethods
class U(abc.ABC):
    @abc.abstractmethod
    def f(self): pass
class V(U): pass
print(sorted(V.__abstractmethods__))
V.f = lambda self: 1
print(sorted(V.__abstractmethods__), abc.update_abstractmethods(V) is V, sorted(V.__abstractmethods__))
print(V().f())
show(abc.update_abstractmethods, int)

# A metaclass derived from ABCMeta; other namespaces
class Meta(abc.ABCMeta):
    def __new__(mcls, name, bases, ns, **kw):
        cls = super().__new__(mcls, name, bases, ns)
        cls.tag = kw.get('tag')
        return cls
class WithMeta(metaclass=Meta, tag=5):
    @abc.abstractmethod
    def m(self): pass
print(WithMeta.tag, sorted(WithMeta.__abstractmethods__), type(WithMeta))
show(WithMeta)
class IsAbs:
    __isabstractmethod__ = True
class IsAbsBad:
    @property
    def __isabstractmethod__(self): raise KeyError('abs')
class NS(abc.ABC):
    x = IsAbs()
    y = 5
print(sorted(NS.__abstractmethods__))
try:
    class NS2(abc.ABC):
        x = IsAbsBad()
except KeyError as e:
    print('KeyError', e)
class Truthy:
    __isabstractmethod__ = [1]
class Falsy:
    __isabstractmethod__ = []
class NS3(abc.ABC):
    a = Truthy(); b = Falsy()
print(sorted(NS3.__abstractmethods__))

# typing's protocols and generics ride on it
@typing.runtime_checkable
class Proto(typing.Protocol):
    def meth(self) -> int: ...
class Impl:
    def meth(self): return 1
print(isinstance(Impl(), Proto), isinstance(1, Proto), issubclass(Impl, Proto))
print(isinstance([], typing.Sequence), isinstance({}, typing.Mapping), issubclass(list, typing.Iterable))

# functools.singledispatch uses the cache token
import functools
@functools.singledispatch
def sd(x): return 'object'
@sd.register(cabc.Sized)
def _(x): return 'sized'
class Late: pass
print(sd(1), sd([]), sd(Late()))
cabc.Sized.register(Late)
print(sd(Late()))
