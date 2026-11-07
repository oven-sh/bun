# Who makes the instances of a class is not worked out from what __new__ is found at the moment: a class takes it from __base__ when it is made, and
# it changes only when __new__ is set or deleted through the class or __bases__ is assigned to. What has once been a function of the program's
# stays "look it up".
import collections, datetime, gc, io, os, struct, sys, time, types, typing


def tell(value):
    if type(value).__repr__ is object.__repr__:
        return 'a ' + type(value).__name__
    return (type(value).__name__, repr(value)[:70])


def show(label, function, *args):
    try:
        result = tell(function(*args))
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, '->', result)


print('--- a function of the program is written, and taken away again')


class C(dict):
    pass


show('fresh', C)
C.__new__ = lambda cls, *a: dict.__new__(cls)
show('a function', C)
C.__new__ = object.__new__
show("then object's", C)
C.__new__ = dict.__new__
show("then dict's", C)
del C.__new__
show('then nothing', C)
show('dict.__new__(C)', dict.__new__, C)
show('object.__new__(C)', object.__new__, C)


class D(dict):
    __new__ = object.__new__


show("object's in the class statement", D)
D.__new__ = int.__new__
show("int's written", D)
D.__new__ = staticmethod(dict.__new__)
show("dict's in a staticmethod", D)
D.__new__ = object.__new__
show("object's after that", D)


class E:
    pass


show('arguments, fresh', E, 1)
E.__new__ = lambda cls, *a: object.__new__(cls)
show('arguments, a function', E, 1)
del E.__new__
show('arguments, deleted', E, 1)
show('no arguments, deleted', E)

print('--- the classes derived from it follow, as far as they have none of their own')


class G:
    pass


class H(G):
    pass


class Own(G):
    __new__ = object.__new__


class BelowOwn(Own):
    pass


class HasInit(G):
    def __init__(self, *a):
        pass


for K in (G, H, Own, BelowOwn, HasInit):
    show('before ' + K.__name__, K, 1)
G.__new__ = lambda cls, *a: ('made by G.__new__ for', cls.__name__)
for K in (G, H, Own, BelowOwn, HasInit):
    show('written ' + K.__name__, K, 1)
del G.__new__
for K in (G, H, Own, BelowOwn, HasInit):
    show('deleted ' + K.__name__, K, 1)


class Late(G):
    pass


show('made afterwards', Late, 1)
show('made afterwards', Late)

print('--- __bases__')


class P:
    def __new__(cls, *a):
        return object.__new__(cls)


class Q:
    pass


class R(P):
    pass


class BelowR(R):
    pass


class S(Q):
    pass


class BelowS(S):
    pass


R.__bases__ = (Q,)
show('from one with a __new__ to one without', R, 1)
show('below it', BelowR, 1)
S.__bases__ = (P,)
show('from one without to one with', S, 1)
show('below it', BelowS, 1)
S.__bases__ = (Q,)
show('and back', S, 1)
show('below it', BelowS, 1)

print('--- what is written into the dict behind the back of the class')


def real(cls):
    return gc.get_referents(cls.__dict__)[0]


class T(dict):
    pass


real(T)['__new__'] = object.__new__
show("object's", T)


class U:
    pass


real(U)['__new__'] = staticmethod(lambda cls, *a: 42)
show('a function', U)
U.x = 1
show('after another attribute was written', U)
U.__init__ = lambda self: None
show('after __init__ was written', U)
show('U.__new__(U)', lambda: U.__new__(U))


class V(U):
    pass


show('a class made afterwards', V)

print('--- T.__new__(S)')


class W(dict):
    def __new__(cls):
        return dict.__new__(cls)


class X(W):
    pass


class Y(dict):
    pass


show('date for datetime', datetime.date.__new__, datetime.datetime, 2020, 1, 1)
show('datetime for date', datetime.datetime.__new__, datetime.date, 2020, 1, 1)
show('int for bool', int.__new__, bool)
show('tzinfo for timezone', datetime.tzinfo.__new__, datetime.timezone)
show('object for X', object.__new__, X)
show('dict for X', dict.__new__, X)
show('object for Y', object.__new__, Y)
show('OrderedDict for Y', collections.OrderedDict.__new__, Y)
show('Exception for KeyError', Exception.__new__, KeyError)
show('Exception for OSError', Exception.__new__, OSError)
show('OSError for FileNotFoundError', OSError.__new__, FileNotFoundError)
show('BaseException for ExceptionGroup', BaseException.__new__, ExceptionGroup)
show('tuple for struct_time', tuple.__new__, time.struct_time)
show('object for NoneType', object.__new__, type(None))
show('object for a generator', object.__new__, types.GeneratorType)
show('object for a function', object.__new__, types.FunctionType)
show('object for an iterator', object.__new__, type(iter([])))
show('object for sys.flags', object.__new__, type(sys.flags))
show('tuple for sys.flags', tuple.__new__, type(sys.flags))
show('object for IOBase', object.__new__, io.IOBase)
show('object for Generic', object.__new__, typing.Generic)
show('no class', object.__new__)
show('no class', object.__new__, 5)

print('--- what an mro() names, and what it leaves out')


class Stranger:
    pass


class Names(type):
    def mro(cls):
        return [cls, Stranger, object]


class N1(metaclass=Names):
    pass


show('before', N1, 1)
Stranger.__new__ = lambda cls, *a: ('made by Stranger.__new__ for', cls.__name__)
show('the class is not told', N1, 1)
N1.x = 1
show('nor after a write to it', N1, 1)


class N2(metaclass=Names):
    pass


show('one made afterwards sees it', N2, 1)
del Stranger.__new__
show('and goes on looking', N2, 1)
show('the first', N1, 1)


class Alone(type):
    def mro(cls):
        return [cls]


class O(metaclass=Alone):
    pass


show('no object in the MRO', O)
show('object.__new__', object.__new__, O)
O.__new__ = lambda cls: 5
show('a function', O)
del O.__new__
show('deleted', O)


class A:
    pass


class Drops(type):
    def mro(cls):
        return [cls, A, object]


for base in (int, float, str, bytes, tuple, dict, list, Exception):
    Z = Drops('Z', (base,), {})
    show('without %s: ()' % base.__name__, lambda: type(Z()).__name__)
    show('without %s: (1)' % base.__name__, lambda: type(Z(1)).__name__)
    show('without %s: (a=1)' % base.__name__, lambda: type(Z(a=1)).__name__)
    show('without %s: its __new__' % base.__name__, base.__new__, Z)
    show('without %s: object.__new__' % base.__name__, object.__new__, Z)


def named(stranger, *bases):
    class Meta(type):
        def mro(cls):
            return [cls, stranger] + [c for b in bases for c in b.__mro__ if c is not object] + [object]
    return Meta('C', bases, {})


for stranger in (type(None), type(NotImplemented), type(...), os.sched_param, os.terminal_size):
    for bases in ((), (tuple,)):
        label = '%s for %s' % (stranger.__name__, [b.__name__ for b in bases])
        try:
            K = named(stranger, *bases)
        except TypeError as error:
            print(label, 'no class:', error)
            continue
        show(label + ' ()', lambda: (type(K()).__name__, K() is None))
        show(label + ' ((1, 2))', lambda: type(K((1, 2))).__name__)
        show(label + ' its __new__', stranger.__new__, K)

print('--- built-in types that can be written to')
kept = os.terminal_size.__new__
show('kept', kept, os.terminal_size, (1, 2))
os.terminal_size.__new__ = dict.__new__
show("dict's written", os.terminal_size, (1, 2))
os.terminal_size.__new__ = lambda cls, *a: tuple.__new__(cls, a)
show('a function: two', os.terminal_size, 1, 2)
show('a function: one', lambda: (os.terminal_size(1), os.terminal_size(1).columns, os.terminal_size(1).lines))
show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))
show('kept', kept, os.terminal_size, (1, 2))
os.terminal_size.__new__ = kept
show('put back', os.terminal_size, (1, 2))
show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))
time.struct_time.__new__ = tuple.__new__
show("tuple's written", time.struct_time, (1,) * 9)
show("tuple's written", time.struct_time, ())

print('--- an exception that C++ raises, whose type makes something else')
struct.error.__new__ = lambda cls, *a: 42
show('an int', struct.pack, 'i', 'x')
struct.error.__new__ = lambda cls, *a: {}
show('a dict', struct.pack, 'i', 'x')
struct.error.__new__ = lambda cls, *a: ValueError('another', *a)
show('another exception', struct.pack, 'i', 'x')
kept = ValueError('kept')
struct.error.__new__ = lambda cls, *a: kept
for again in range(2):
    try:
        struct.pack('i', 'x')
    except ValueError:
        # Nothing here has asked for it, and it is the program's all the same.
        print('one that the program has:', sum(o is kept for o in gc.get_objects()), sys.exception() is kept, kept.__traceback__.tb_frame is sys._getframe())
        try:
            struct.pack('i', 'x')
        except ValueError:
            print('raised again while it is handled:', sum(o is kept for o in gc.get_objects()), kept.__context__)
del struct.error.__new__
show('deleted', struct.pack, 'i', 'x')

print('--- and one that the program gets hold of while it is made, by an __init__ written in C++')
import csv


def names(e):
    found, entry = [], e.__traceback__
    while entry:
        found.append(entry.tb_frame.f_code.co_name)
        entry = entry.tb_next
    return found


def inner():
    csv.get_dialect('none')


def outer():
    inner()


def catches():
    try:
        inner()
    except csv.Error:
        return


held = []
csv.Error.__init__ = BaseException.add_note
csv.Error.__notes__ = property(lambda self: (held.append(self), [])[1])
try:
    outer()
except csv.Error:
    pass
print(len(held), held[0].args, names(held[0]), sum(o is held[0] for o in gc.get_objects()))
del held[:]
catches()
print(len(held), names(held[0]), held[0].__traceback__.tb_frame.f_back.f_code.co_name)
del held[:], csv.Error.__init__, csv.Error.__notes__
show('deleted', inner)

print('--- the type changes while its __new__ runs')


class L(list):
    def __iter__(self):
        ExceptionGroup.__init__ = replacement
        return list.__iter__(self)


replacement = lambda self, *a: print('   an __init__ of the program:', a)
show('a function', ExceptionGroup, 'm', L([ValueError()]))
del ExceptionGroup.__init__
replacement = dict.__init__
show("dict's", ExceptionGroup, 'm', L([ValueError()]))
del ExceptionGroup.__init__
show('as before', ExceptionGroup, 'm', [ValueError()])

print('--- a base that brings a __new__ of another kind to a built-in type that can be written to')
import binascii


class Slotless(tuple):
    __slots__ = ()


binascii.Error.__bases__ = (ValueError, datetime.tzinfo)
binascii.Error.__new__ = datetime.tzinfo.__new__
x = binascii.Error('a')
show('made', lambda: x)
x.args = (1, 2)
x.__cause__ = KeyError()
x.add_note('a note')
show('used', lambda: (x.args, x.__cause__, x.__notes__, x.utcoffset.__name__))
show('raised by C++', binascii.unhexlify, 'x')
os.times_result.__bases__ = (Slotless, datetime.tzinfo)
os.times_result.__new__ = datetime.tzinfo.__new__
show('a struct sequence', os.times_result, (1, 2, 3, 4, 5))
show('a struct sequence', lambda: os.times_result((1, 2, 3, 4, 5)).elapsed)
show('a struct sequence', os.times_result)
show('made by C++', lambda: type(os.times()).__name__)
import zlib
zlib.error.__bases__ = (datetime.tzinfo, Exception)
show('found first', lambda: zlib.error('a').args)
show('found first, raised by C++', zlib.decompress, b'x')
show('found first, a class derived from it', lambda: type('D', (zlib.error,), {})('b').args)
zlib.error.__bases__ = (Exception,)
show('as before', zlib.decompress, b'x')

print('--- the metaclass that wins')


class M1(type):
    pass


class B1(metaclass=M1):
    pass


M1.__new__ = dict.__new__
show("dict's written", lambda: type(type('X', (B1,), {})).__name__)
M1.__new__ = lambda *a: 5
show('a function', type, 'X', (B1,), {})
M1.__new__ = dict.__new__
show("dict's after that", type, 'X', (B1,), {})
M1.__new__ = type.__new__
show("type's after that", lambda: type(type('X', (B1,), {})).__name__)

print('--- a class that looks __new__ up asks for it as for any attribute of the class')


class Asked(type):
    def __getattribute__(cls, name):
        if name == '__new__':
            print('   the metaclass is asked for', name)
        return type.__getattribute__(cls, name)


class A1(metaclass=Asked):
    def __new__(cls):
        return object.__new__(cls)


class A2(metaclass=Asked):
    pass


show('with a __new__ in Python', A1)
show('without', A2)


class Gives(type):
    def __getattr__(cls, name):
        print('   __getattr__ of the metaclass:', name)
        if name == '__new__':
            return lambda cls: 'from the metaclass'
        raise AttributeError(name)

    def mro(cls):
        return [cls]


class A3(metaclass=Gives):
    def __new__(cls):
        return 5


show('found', A3)
del real(A3)['__new__']
type.__dict__['__abstractmethods__'].__set__(A3, ())
show('taken out of the dict behind its back', A3)
A3.__new__ = lambda cls: 6
show('written', A3)
del A3.__new__
show('deleted', A3)


class Name(str):
    pass


class A4:
    pass


type.__setattr__(A4, Name('__new__'), lambda cls: 7)
show('the name is of a class derived from str', A4)

import abc


class Quiet(type):
    pass


class A5(metaclass=Quiet):
    def __new__(cls):
        return 'what A5 has'


class A6(abc.ABC):
    def __new__(cls):
        return 'what A6 has'


class Data:
    def __get__(self, cls, metaclass=None):
        return lambda *a: 'what the data descriptor of the metaclass gives'

    def __set__(self, cls, value):
        pass


class Refuses:
    def __get__(self, o, cls=None):
        raise AttributeError('refused')


show('a metaclass that has nothing to say', A5)
show('abc.ABC', A6)
Quiet.__getattribute__ = lambda cls, name: (lambda *a: 'what __getattribute__ gives') if name == '__new__' else type.__getattribute__(cls, name)
show('the metaclass is given a __getattribute__', A5)
del Quiet.__getattribute__
show('and loses it', A5)
Quiet.__new__ = Data()
show('a data descriptor in the metaclass', A5)
del Data.__set__
show('that is one no longer', A5)
del Quiet.__new__
show('and is gone', A5)
A5.__new__ = Refuses()
show('a descriptor that refuses', A5)
Quiet.__getattr__ = lambda cls, name: lambda *a: 'what __getattr__ gives for ' + name
show('a descriptor that refuses, and a __getattr__ in the metaclass', A5)
del Quiet.__getattr__
show('a descriptor that refuses', A5)

print('--- a key that is no str changes the class while __new__ is looked for')


class Key:
    def __init__(self, action):
        self.action = action

    def __hash__(self):
        return hash('__new__')

    def __eq__(self, other):
        action, self.action = self.action, None
        if action:
            action()
        return False


import warnings
warnings.simplefilter('ignore')
made = []
Base = type('Base', (), {Key(lambda: made and setattr(made[0], '__new__', lambda cls, *a: 'written by the key')): 1})
K1 = type('K1', (Base,), {})
made.append(K1)
show('before', K1)
Base.__new__ = object.__new__
show('after', K1)
show('after', K1, 1)

print('--- copies and pickles do not go by who makes the instances')
import copy, pickle


class OfGeneric(typing.Generic[typing.TypeVar('T')]):
    def __init__(self):
        self.a = 1


class OfIOBase(io.IOBase):
    def __init__(self):
        self.a = 1


show('before', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle.dumps(OfGeneric())).a, copy.copy(OfIOBase()).a))
typing.Generic.__new__ = lambda cls, *a, **k: object.__new__(cls)
del typing.Generic.__new__
show('after', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle.dumps(OfGeneric())).a))
show('no instances from Python', lambda: copy.copy(iter([])).__class__.__name__)
show('no instances from Python', lambda: (x for x in ()).__reduce_ex__(2))

print('--- a built-in type that can be written to is given a class for a base')


class Plain:
    pass


binascii.Incomplete.__bases__ = (Plain, Exception)
show('__dict__', lambda: binascii.Incomplete('a').__dict__)
i = binascii.Incomplete('a')
i.x = 1
show('__dict__', lambda: (i.__dict__, vars(i), i.args))
i.__dict__ = {'y': 2}
show('__dict__', lambda: (i.y, i.__dict__))

print('--- behind the back of types that cannot be written to')


class Door:
    def __ror__(self, other):
        return other


forget = type.__dict__['__abstractmethods__'].__set__


def written(cls, name, value, *uses):
    d = cls.__dict__ | Door()
    missing = object()
    old = d.get(name, missing)
    if value is missing_value:
        del d[name]
    else:
        d[name] = value
    forget(cls, ())
    del d['__abstractmethods__']
    try:
        for label, use in uses:
            show(label, use)
    finally:
        if old is missing:
            del d[name]
        else:
            d[name] = old
        forget(cls, ())
        del d['__abstractmethods__']


missing_value = object()
o = object()
written(object, '__eq__', missing_value, ('no object.__eq__: !=', lambda: (o != 1, o != o)), ('no object.__eq__: in', lambda: o in [1, o]))
for label, value in (("bytearray's", bytearray.__init__), ('a function that raises', lambda self, *a: 1 / 0), ('5', 5), ('its own __repr__', BaseException.__repr__), ("object's __eq__", object.__eq__),
                     ("object's __setattr__", object.__setattr__), ('its own __reduce__', BaseException.__reduce__), ('its own __new__', BaseException.__new__)):
    written(BaseException, '__init__', value,
        ('BaseException.__init__ is %s: what C++ raises' % label, lambda: 1 / 0),
        ('and', lambda: int('x')),
        ('and', lambda: [].pop()),
        ('and', lambda: {}['k']),
        ('and', lambda: open('/nonexistent/file')),
        ('and', lambda: next(iter(()))))
written(datetime.datetime, '__new__', missing_value, ('no datetime.__new__', lambda: datetime.datetime(2020, 1, 2)))
written(dict, '__new__', lambda cls, *a: 5, ('dict.__new__ is a function', lambda: (dict(a=1), types.SimpleNamespace({'a': 1}))))
written(ValueError, '__new__', lambda cls, *a: 5, ('ValueError.__new__ is a function', lambda: int('x')))
import ctypes


def simple():
    class I(ctypes._SimpleCData):
        _type_ = 'i'
    return I.__name__, I.__ctype_be__.__name__, I.__ctype_le__ is I, I(5).value


written(type, '__new__', lambda *a: 5, ('type.__new__ is a function', lambda: type('X', (), {}).__name__), ('and a class for which C++ makes a second one', simple))
deep = []
for i in range(200000):
    deep = [deep]


def use_up_the_stack():
    try:
        repr(deep)
    except RecursionError as error:
        return type(error).__name__, len(error.args)


for cls in (RecursionError, RuntimeError, BaseException):
    written(cls, '__init__', object.__init__, ("%s.__init__ is object's, and the stack is used up" % cls.__name__, use_up_the_stack))
deep = None

Simple = type(ctypes.c_int)
handed = []


class Hands(Simple):
    def __new__(metaclass, *a, **k):
        return handed[0] if handed else super().__new__(metaclass, *a, **k)


B2 = Hands('B2', (ctypes._SimpleCData,), {'_type_': 'i'})
for victim in (io.IOBase.__base__, os.terminal_size, int):
    T2 = type.__new__(Simple, 'T2', (ctypes._SimpleCData,), {'_type_': 'q'})
    handed.append(victim)
    show('the metaclass that wins hands back %r for the second class' % (victim,), Simple.__init__, T2, 'T2', (B2,), {})
    handed.clear()
show('and these are as they were', lambda: (io.BytesIO(b'x').read(), os.terminal_size.n_fields, int('7')))
show('all is as it was', lambda: (o != 1, datetime.datetime(2020, 1, 2), dict(a=1), len(collections.OrderedDict(a=1))))

print('--- one function that makes cells of two sizes goes by __base__ as well')
import asyncio, _asyncio


class LeavesTaskOut(type):
    def mro(cls):
        return [cls, _asyncio.Future, object]


class NamesTask(type):
    def mro(cls):
        return [cls, _asyncio.Task, _asyncio.Future, object]


class PlainTask(_asyncio.Task):
    pass


class SlotsTask(_asyncio.Task):
    __slots__ = ('a',)


async def two():
    return 2


loop = asyncio.new_event_loop()
x = LeavesTaskOut('X', (_asyncio.Task,), {})(loop=loop)
x.__class__ = PlainTask
show('a task after all', lambda: (type(x).__name__, x.set_name('a name'), x.get_name(), x.cancel(), x.cancelling(), x.get_coro(), x.done()))
show('a class that only names Task', NamesTask, 'Z', (_asyncio.Future,), {})
show('with __slots__', lambda: loop.run_until_complete(SlotsTask(two(), loop=loop)))
for metaclass, namespace in ((type(ctypes.Structure), {}), (type(ctypes.Union), {'_fields_': []}), (type(ctypes.c_int), {'_type_': 'i'}), (type(ctypes.Array), {'_type_': ctypes.c_int, '_length_': 1})):
    # These keep what they know of a class in the class.
    F = metaclass('F', (_asyncio.Future,), namespace)
    show('a Future whose class is of %s' % metaclass.__name__, lambda: (F(loop=loop).cancel(), F(loop=loop).get_loop() is loop))
loop.close()

print('--- a lattice of classes, and a long chain: each class is told once, whatever the ways that lead to it')


class Base:
    pass


level = [type('A0', (Base,), {}), type('B0', (Base,), {})]
lattice = list(level)
for i in range(1, 14):
    level = [type('A%d' % i, tuple(level), {}), type('B%d' % i, tuple(level), {})]
    lattice += level


def outcomes():
    found = []
    for c in [Base] + lattice:
        try:
            made = c(1)
            found.append('i' if type(made) is c else 'o')
        except TypeError:
            found.append('-')
    return ''.join(found)


print(outcomes())
Base.__new__ = lambda cls, *a: object.__new__(cls)
print(outcomes())
lattice[9].__new__ = lambda cls, *a: 'its own'
print(outcomes())
del Base.__new__
print(outcomes())
Base.__new__ = lambda cls, *a: object.__new__(cls)
del lattice[9].__new__
print(outcomes())
del Base.__new__
print(outcomes())


class Short(type):
    def mro(cls):
        return [cls, object]


class Root(metaclass=Short):
    pass


chain = [Root]
for i in range(3000):
    chain.append(Short('C', (chain[-1],), {}))
Root.__new__ = lambda cls, *a: object.__new__(cls)


def refused(c):
    try:
        c(1)
    except TypeError:
        return True
    return False


print(refused(Root), sum(refused(c) for c in chain[1:]))
del Root.__new__
print(refused(Root), sum(refused(c) for c in chain[1:]))
