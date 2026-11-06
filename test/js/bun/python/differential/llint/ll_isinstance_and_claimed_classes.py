# isinstance() of an object whose type is not derived from the class goes by what the object gives as its __class__.
import abc
import collections.abc
import gc
import types
import unittest.mock
import weakref


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


def check(o, cls):
    return isinstance(o, cls)


def thrice(label, o, *classes):
    for turn in range(3):
        show('%s %d' % (label, turn), lambda: [check(o, cls) for cls in classes])


class A:
    pass


class B(A):
    pass


class Unrelated:
    pass


print('--- nothing is claimed')
for o in (A(), B(), Unrelated(), 1, 1.5, True, None, 'text', b'bytes', [1], (1,), {1: 2}, {1}, len, check, A, type, object(), 2 ** 70, 1j, range(3), ...):
    print(type(o).__name__, [check(o, cls) for cls in (A, B, Unrelated, int, float, bool, str, list, tuple, dict, object, type, (A, int), (str, (list, B)))])

print('--- a property of the class')


class Claims:
    @property
    def __class__(self):
        print('asked')
        return A


thrice('property', Claims(), A, B, Unrelated, Claims, object)
print(type(Claims()).__name__, Claims().__class__.__name__)


class ClaimsNothingUseful:
    __class__ = property(lambda self: 5)


thrice('no class', ClaimsNothingUseful(), A, int, ClaimsNothingUseful)


class Raises:
    @property
    def __class__(self):
        raise ValueError('not telling')


thrice('raises', Raises(), A, Raises)


class RaisesAttributeError:
    @property
    def __class__(self):
        raise AttributeError('no __class__')


thrice('raises AttributeError', RaisesAttributeError(), A, RaisesAttributeError)

print('--- a plain value in the class')


class Plain:
    __class__ = A


thrice('value', Plain(), A, B, Plain)
# (These go to the __class__ of the class itself.)
show('deleted from the class', delattr, Plain, '__class__')
show('set in the class', setattr, Plain, '__class__', property(lambda self: B))
thrice('value', Plain(), A, B, Plain)

print('--- given later, by other bases')


class Base:
    pass


class Middle(Base):
    pass


class Leaf(Middle):
    pass


class ClaimsA:
    __class__ = property(lambda self: A)


class ClaimsUnrelated:
    __class__ = property(lambda self: Unrelated)


leaf = Leaf()
thrice('before', leaf, A, Base, Leaf)
Base.__bases__ = (ClaimsA,)
thrice('a base has a property', leaf, A, Base, Leaf)
Middle.__bases__ = (ClaimsUnrelated, Base)
thrice('a nearer base has one', leaf, A, Unrelated, Base, Leaf)
Middle.__bases__ = (Base,)
thrice('the nearer one is gone', leaf, A, Unrelated, Base, Leaf)
Base.__bases__ = (Unrelated,)
thrice('both are gone', leaf, A, Unrelated, Base, Leaf)

print('--- __getattribute__')


class Own:
    def __getattribute__(self, name):
        if name == '__class__':
            print('__getattribute__', name)
            return A
        return object.__getattribute__(self, name)


thrice('own', Own(), A, B, Own)
thrice('before', leaf, A)
Base.__getattribute__ = lambda self, name: A if name == '__class__' else object.__getattribute__(self, name)
thrice('given to a base', leaf, A, Leaf)
del Base.__getattribute__
thrice('taken away', leaf, A, Leaf)
Base.__getattribute__ = object.__getattribute__
thrice("object's own, set by hand", leaf, A, Leaf)
del Base.__getattribute__

print('--- what is not asked')


class Hook:
    def __getattr__(self, name):
        print('__getattr__', name)
        return A


thrice('__getattr__', Hook(), A, Hook)
in_dict = Unrelated()
in_dict.__dict__['__class__'] = A
thrice('in the dict of the object', in_dict, A, Unrelated)
print(in_dict.__class__.__name__)

print('--- the class of the object is changed')
changing = Unrelated()
thrice('before', changing, A, Unrelated)
changing.__class__ = B
thrice('after', changing, A, B, Unrelated)
changing.__class__ = Unrelated
thrice('back', changing, A, B, Unrelated)

print('--- proxies and mocks')
target = B()
proxy = weakref.proxy(target)
thrice('weakref.proxy', proxy, A, B, Unrelated, weakref.ProxyType)
print(type(proxy).__name__, proxy.__class__.__name__)
del target
gc.collect()
thrice('dead proxy', proxy, A, weakref.ProxyType)
mock = unittest.mock.Mock(spec=B)
thrice('Mock(spec=B)', mock, A, B, Unrelated, unittest.mock.Mock)
thrice('Mock()', unittest.mock.Mock(), A, unittest.mock.Mock)
mock = unittest.mock.MagicMock(spec=[1])
thrice('MagicMock(spec=a list)', mock, list, tuple)
thrice('mappingproxy', types.MappingProxyType({}), dict, types.MappingProxyType, collections.abc.Mapping)

print('--- metaclasses')


class Meta(type):
    def __instancecheck__(cls, o):
        print('__instancecheck__', cls.__name__, type(o).__name__)
        return type(o) is int


class WithMeta(metaclass=Meta):
    pass


thrice('metaclass', 1, WithMeta)
thrice('metaclass', 'x', WithMeta)
thrice('the very type: not asked', WithMeta(), WithMeta)
thrice('in a tuple', 'x', (str, WithMeta), (WithMeta, str), (A, WithMeta))
thrice('claims, and a metaclass', Claims(), WithMeta)


class MetaWithoutHook(type):
    pass


class PlainMeta(metaclass=MetaWithoutHook):
    pass


thrice('a metaclass without the method', Claims(), PlainMeta)
thrice('a metaclass without the method', PlainMeta(), PlainMeta, A)
MetaWithoutHook.__instancecheck__ = lambda cls, o: 'yes'
thrice('given later', 1, PlainMeta)
del MetaWithoutHook.__instancecheck__
thrice('taken away', 1, PlainMeta)


class Abstract(abc.ABC):
    pass


Abstract.register(Unrelated)
thrice('registered', Unrelated(), Abstract)
thrice('not registered', A(), Abstract)
thrice('claims a registered class', type('C', (), {'__class__': property(lambda self: Unrelated)})(), Abstract)
thrice('abc', [1], collections.abc.Sequence, collections.abc.Mapping, collections.abc.Sized)

print('--- what is no class')


class HasBases:
    __bases__ = (A,)


thrice('an object with __bases__', A(), HasBases())
thrice('an object with __bases__', Claims(), HasBases())
thrice('not a class', A(), 5)
thrice('not a class', A(), (A, 5))
thrice('not a class', A(), (5, A))
thrice('union', 1, int | str, A | None, list[int] | int)
thrice('union', None, A | None)
thrice('generic alias', [1], list[int])

print('--- issubclass goes by the classes')
for pair in ((B, A), (A, B), (Claims, A), (Plain, A), (bool, int), (int, (str, object))):
    show('issubclass', issubclass, *pair)

print("--- object's getter in a class that object is no base of any more")


class Short(type):
    short = False

    def mro(cls):
        return [cls] if Short.short else type.mro(cls)


class Cut(metaclass=Short):
    __class__ = object.__dict__['__class__']
    __getattribute__ = object.__getattribute__


cut = Cut()
thrice('in line', cut, int, Cut, object)
Short.short = True
Cut.__bases__ = (A,)
print(Cut.__mro__)
# (Which of the two is refused first is another matter.)
for cls in (int, Cut, object):
    try:
        print('cut off', check(cut, cls))
    except TypeError:
        print('cut off', 'TypeError')
Short.short = False
Cut.__bases__ = (B,)
thrice('in line again', cut, int, Cut, A, object)
