# One instruction that reads an attribute, or looks up a method to call, sees objects of many kinds in turn.
import functools
import types


class Plain:
    k = 'Plain.k'

    def __init__(self, *names):
        for name in names:
            setattr(self, name, (name, len(names)))

    def m(self):
        return ('Plain.m', type(self).__name__)


class Derived(Plain):
    def m(self):
        return ('Derived.m', type(self).__name__)


class WithProperty:
    @property
    def a(self):
        return 'property a'

    @property
    def m(self):
        return lambda: 'property m'

    k = 'WithProperty.k'


class RaisingProperty:
    @property
    def a(self):
        raise AttributeError('no a today')

    @property
    def m(self):
        raise AttributeError('no m today')

    k = property(lambda self: 1 / 0)


class Slots:
    __slots__ = ('a', 'k', 'm')


class SlotsAndDict:
    __slots__ = ('a', '__dict__')


class Fallback:
    def __getattr__(self, name):
        return ('fallback', name)


class OwnGetAttribute:
    def __getattribute__(self, name):
        return ('own', name)


class Static:
    @staticmethod
    def m():
        return 'static m'

    @classmethod
    def a(cls):
        return ('class a', cls.__name__)

    k = staticmethod(lambda: 'static k')


class NonData:
    def __get__(self, obj, cls):
        return ('non-data', type(obj).__name__, cls.__name__)


class Data(NonData):
    def __set__(self, obj, value):
        raise AssertionError


class WithDescriptors:
    a = NonData()
    k = Data()
    m = NonData()


class Meta(type):
    a = 'Meta.a'

    def m(cls):
        return ('Meta.m', cls.__name__)


class OfMeta(metaclass=Meta):
    k = 'OfMeta.k'


class Tuple(tuple):
    a = 'Tuple.a'


def filled_slots():
    s = Slots()
    s.a = 'slot a'
    s.k = 'slot k'
    s.m = lambda: 'slot m'
    return s


def with_dict(*names):
    p = Plain(*names)
    p.__dict__
    return p


def slots_and_dict():
    s = SlotsAndDict()
    s.a = 'slot a'
    s.k = 'dict k'
    s.m = lambda: 'dict m'
    return s


def shadowing():
    p = Plain('a', 'k')
    p.m = lambda: 'instance m'
    return p


module = types.ModuleType('module')
module.a = 'module a'
module.m = lambda: 'module m'

namespace = types.SimpleNamespace(a='namespace a', m=lambda: 'namespace m')

def with_dict_shadowing():
    p = shadowing()
    p.__dict__
    return p


def with_odd_key(*names):
    p = Plain(*names)
    p.__dict__[7] = 'seven'
    return p


def with_another_dict():
    p = Plain('z')
    p.__dict__ = {'a': 'a of another dict', 'm': lambda: 'm of another dict'}
    return p


def with_dict_deleted():
    p = Plain('a', 'k')
    del p.__dict__
    p.k = 'k set afterwards'
    return p


def with_many(count, *deleted):
    p = Plain(*('n%d' % i for i in range(count)), 'a', 'k')
    for name in deleted:
        delattr(p, name)
    return p


class Restless(Plain):
    pass


for i in range(1100):
    Restless.counter = i


class ListWithAttributes(list):
    k = 'ListWithAttributes.k'

    def m(self):
        return 'ListWithAttributes.m'


class DictWithAttributes(dict):
    def m(self):
        return 'DictWithAttributes.m'


def builtin_with_attributes(cls, *names):
    o = cls()
    for name in names:
        setattr(o, name, 'own ' + name)
    return o


def function_with_attributes():
    def f():
        pass
    f.a = 'a of a function'
    f.m = lambda: 'm of a function'
    return f


class OddProperties:
    a = property(functools.partial(lambda self: 'partial getter'))
    k = property()
    m = property(lambda self, extra='default': lambda: 'getter with a default')


class PropertyAndDict(WithProperty):
    def __init__(self):
        self.__dict__.update(a='a in the dict', m='m in the dict', k='k in the dict')


class DescriptorsAndDict(WithDescriptors):
    def __init__(self):
        self.__dict__.update(a='a in the dict', m=lambda: 'm in the dict', k='k in the dict')


class FallbackAndDict(Fallback):
    def __init__(self):
        self.__dict__['a'] = 'a in the dict'


class DerivedProperty(property):
    def __get__(self, obj, cls=None):
        return 'its own __get__'


class WithDerivedProperty:
    a = DerivedProperty(lambda self: 'never')
    k = DerivedProperty(lambda self: 'never')


def builtin_that_lost_its_attributes(cls):
    o = builtin_with_attributes(cls, 'a', 'm')
    del o.a, o.m
    return o


MAKERS = [
    lambda: builtin_with_attributes(DictWithAttributes), lambda: builtin_with_attributes(DictWithAttributes, 'm'), lambda: builtin_that_lost_its_attributes(DictWithAttributes),
    lambda: builtin_with_attributes(ListWithAttributes, 'm', 'k'), lambda: builtin_that_lost_its_attributes(ListWithAttributes), lambda: builtin_that_lost_its_attributes(ValueError),
    with_dict_shadowing, lambda: with_odd_key('a'), lambda: with_odd_key(), with_another_dict, with_dict_deleted, lambda: with_many(200), lambda: with_many(200, 'a', 'n3'),
    lambda: with_many(20, 'n3', 'k'), lambda: Restless('a'), lambda: Restless('k', 'a'), lambda: builtin_with_attributes(ListWithAttributes, 'a'), lambda: builtin_with_attributes(ListWithAttributes),
    lambda: builtin_with_attributes(DictWithAttributes, 'k', 'a'), lambda: builtin_with_attributes(ValueError, 'a', 'k'), lambda: builtin_with_attributes(Tuple, 'k'), function_with_attributes,
    OddProperties, PropertyAndDict, DescriptorsAndDict, FallbackAndDict, WithDerivedProperty, lambda: staticmethod(len), lambda: Static.__dict__['m'], lambda: property(len),
    lambda: Plain('a'), lambda: Plain('a', 'k'), lambda: Plain('k', 'a'), lambda: Plain('z', 'a'), lambda: Plain(), lambda: Derived('a'),
    lambda: Derived('k', 'z', 'a'), WithProperty, RaisingProperty, Slots, filled_slots, slots_and_dict, SlotsAndDict, Fallback, OwnGetAttribute, Static,
    WithDescriptors, lambda: OfMeta, lambda: Plain, lambda: Static, lambda: with_dict('a'), lambda: with_dict('k', 'a'), lambda: with_dict(),
    shadowing, lambda: module, lambda: namespace, lambda: Tuple((1, 2)), lambda: 'text', lambda: [1], lambda: 7, lambda: None, lambda: 2 ** 70,
    lambda: 1.5, lambda: len, lambda: shadowing,
]


def show(value):
    return 'function' if isinstance(value, (types.FunctionType, types.MethodType, types.BuiltinFunctionType)) else repr(value)


def read_a(o):
    try:
        return show(o.a)
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def read_k(o):
    try:
        return show(o.k)
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def call_m(o):
    try:
        return show(o.m())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


print('--- every kind after every other')
lines = 0
seen = {}
for i, first in enumerate(MAKERS):
    for j, second in enumerate(MAKERS):
        x, y = first(), second()
        got = []
        for o in (x, x, y, y, x, y):
            got.append((read_a(o), read_k(o), call_m(o)))
        assert got[0] == got[1] == got[4], (i, j, got)
        assert got[2] == got[3] == got[5], (i, j, got)
        for index, result in ((i, got[0]), (j, got[2])):
            assert seen.setdefault(index, result) == result, (i, j, index, result, seen[index])
        lines += 1
for index in sorted(seen):
    print(index, *seen[index], sep=' | ')
print(lines, 'pairs')

print('--- the class changes between two reads by the same instruction')


class Changing:
    def __init__(self):
        self.a = 'instance a'

    def m(self):
        return 'first m'


class Other(Changing):
    pass


objects = [Changing(), Other(), Changing(), Other()]
objects[2].z = 1
objects[3].z = 1


def all_of_them():
    return [(read_a(o), call_m(o)) for o in objects]


print(all_of_them())
print(all_of_them())
Changing.a = property(lambda self: 'property a')
print(all_of_them())
del Changing.a
print(all_of_them())
Changing.m = lambda self: 'second m'
print(all_of_them())
Other.m = lambda self: 'm of Other'
print(all_of_them())
Other.a = Data()
print(all_of_them())
del Other.a
Changing.__getattr__ = lambda self, name: ('fallback', name)
for o in objects[:2]:
    del o.a
print(all_of_them())
del Changing.__getattr__
print(all_of_them())
Changing.__getattribute__ = lambda self, name: (lambda: 'everything') if name == 'm' else 'everything'
print(all_of_them())
del Changing.__getattribute__
print(all_of_them())
objects[2].__class__ = Other
objects[3].__class__ = Changing
print(all_of_them())
for o in objects:
    o.m = lambda: 'instance m'
print(all_of_them())
for o in objects:
    del o.m
print(all_of_them())
for o in objects[2:]:
    o.__dict__ = {'a': 'from another dict'}
print(all_of_them())
for o in objects[2:]:
    o.__dict__['m'] = lambda: 'm in the dict'
print(all_of_them())
for o in objects[2:]:
    del o.__dict__
print(all_of_them())
for o in objects[2:]:
    o.a = 'set again'
print(all_of_them())

print('--- slots that are set and deleted')
slotted = [filled_slots(), Slots(), filled_slots()]
print([(read_a(o), call_m(o)) for o in slotted])
del slotted[0].a, slotted[2].m
slotted[1].a = 'late'
print([(read_a(o), call_m(o)) for o in slotted])
print([(read_a(o), call_m(o)) for o in slotted])

print('--- dir() of an instance')


class HasDictProperty:
    def __init__(self):
        self.real = 1

    @property
    def __dict__(self):
        return {'pretended': 1}


class DictRaises:
    def __init__(self):
        self.real = 1

    @property
    def __dict__(self):
        raise AttributeError('hidden')


class DictIsNoDict:
    __dict__ = 5


class Watching:
    def __getattribute__(self, name):
        asked.append(name)
        return object.__getattribute__(self, name)


def own(names, cls=object):
    return [name for name in names if name not in dir(cls)]


asked = []
p = Plain('b', 'a', 'c')
print(own(dir(p)), own(object.__dir__(p)))
del p.a
p.a = 1
p.d = 2
print(own(dir(p)), own(object.__dir__(p)))
print(read_a(p), p.b, p.__dict__, own(dir(p)))
p.__dict__[3] = 4
print(own(object.__dir__(p)))
try:
    dir(p)
except TypeError as e:
    print('TypeError', e)
print(own(dir(Plain())), own(dir(with_dict('x'))), own(dir(slots_and_dict())), own(dir(filled_slots())), own(dir(SlotsAndDict())))
print(own(dir(HasDictProperty())), own(dir(DictRaises())), own(dir(DictIsNoDict())))
w = Watching()
w.x = 1
print(own(dir(w)), asked)
print(own(dir(Fallback())), own(dir(shadowing())), own(dir(Tuple())), own(dir(OfMeta)))
e = ValueError()
e.x = 1
print(own(dir(e), ValueError), own(dir(namespace)), own(dir(module), types.ModuleType))

print('--- a str, a list and an instance at one call')


class Stripping:
    def strip(self):
        return 'Stripping.strip'

    def copy(self):
        return 'Stripping.copy'


def strips(o):
    return o.strip()


def copies(o):
    return o.copy()


print([strips(o) for o in (' a ', Stripping(), ' b ', b' c ', Stripping(), bytearray(b' d '), ' e ')])
print([copies(o) for o in ([1], Stripping(), {2: 3}, [4], {5}, Stripping(), bytearray(b'6'), [7])])

print('--- with, where the managers are of many kinds')
import contextlib


class Manager:
    def __enter__(self):
        return 'Manager'

    def __exit__(self, *args):
        return False


class CallableEnter:
    class Enter:
        def __call__(self):
            return 'CallableEnter'

    __enter__ = Enter()

    def __exit__(self, *args):
        return False


@contextlib.contextmanager
def generator_manager():
    yield 'generator'


def entered(manager):
    with manager as value:
        return value


print([entered(m) for m in (Manager(), CallableEnter(), Manager(), generator_manager(), contextlib.nullcontext('null'), Manager(), CallableEnter())])

print('--- what is found in the class belongs to another one, or cannot be bound')
import collections
import re


class SlotOwner:
    __slots__ = ('x', 'y')


class Raises:
    def __init__(self, error):
        self.error = error

    def __get__(self, obj, cls):
        raise self.error


class RaisesData(Raises):
    def __set__(self, obj, value):
        raise self.error


class Gives:
    def __get__(self, obj, cls):
        return lambda *a: ('given', type(obj).__name__, cls.__name__, a)


Pair = collections.namedtuple('Pair', 'first second third')


def plain_function(*a):
    return ('plain_function', [type(x).__name__ for x in a])


def gives(base, *args, **more):
    return type(base.__name__.capitalize() + 'Gives', (base,), {'__get__': Gives.__get__, **more})(*args)


found = {
    'method of str': str.upper,
    'method of list': list.append,
    'method of object': object.__dict__['__reduce__'],
    'slot wrapper of list': list.__len__,
    'slot wrapper of str': str.__len__,
    'slot wrapper of object': object.__repr__,
    'class method of dict': dict.__dict__['fromkeys'],
    'class method of int': int.__dict__['from_bytes'],
    'class method of object': object.__dict__['__init_subclass__'],
    'static method of str': str.__dict__['maketrans'],
    'slot of another class': SlotOwner.__dict__['x'],
    'second slot of another class': SlotOwner.__dict__['y'],
    'getset of int': int.__dict__['real'],
    'getset of function': types.FunctionType.__dict__['__code__'],
    'getset of type': type.__dict__['__name__'],
    'member of function': types.FunctionType.__dict__['__globals__'],
    '__dict__ of another class': Plain.__dict__['__dict__'],
    '__weakref__ of another class': Plain.__dict__['__weakref__'],
    'field of a named tuple': Pair.__dict__['third'],
    'first field of a named tuple': Pair.__dict__['first'],
    'staticmethod(None)': staticmethod(None),
    'staticmethod(str.upper)': staticmethod(str.upper),
    'staticmethod(function)': staticmethod(plain_function),
    'classmethod(None)': classmethod(None),
    'classmethod(str.upper)': classmethod(str.upper),
    'classmethod(function)': classmethod(plain_function),
    'classmethod(property)': classmethod(property(plain_function)),
    'property()': property(),
    'property(str.upper)': property(str.upper),
    'property(len)': property(len),
    'property(function)': property(plain_function),
    'property that raises TypeError': property(lambda self: 1 + ''),
    '__get__ raises TypeError': Raises(TypeError('no binding')),
    '__get__ raises AttributeError': Raises(AttributeError('no binding')),
    '__get__ raises KeyError': Raises(KeyError('no binding')),
    'data, __get__ raises TypeError': RaisesData(TypeError('no binding')),
    'data, __get__ raises AttributeError': RaisesData(AttributeError('no binding')),
    '__get__ gives': Gives(),
    'function': plain_function,
    'lambda': lambda self, *a: ('lambda', type(self).__name__, a),
    'builtin function': len,
    'bound method': 'abc'.upper,
    'bound method of Python': Plain().m,
    'MethodType on a number': types.MethodType(plain_function, 5),
    'partial': functools.partial(plain_function, 1),
    'partialmethod': functools.partialmethod(plain_function, 1),
    'class': Plain,
    'class whose class has __get__': gives(type, 'ClassThatGives', (), {}),
    'class whose class has __get__ and __set__': gives(type, 'ClassThatGivesAndSets', (), {}, __set__=lambda *a: None),
    'class whose class has __set__': type('MetaSets', (type,), {'__set__': lambda *a: None})('ClassThatSets', (), {}),
    'list with __get__': gives(list, [1]),
    'list with __get__ and __set__': gives(list, [1], __set__=lambda *a: None),
    'tuple with __get__': gives(tuple, (1,)),
    'dict with __get__': gives(dict, {1: 2}),
    'str with __get__': gives(str, 'text'),
    'int with __get__': gives(int, 5),
    'module with __get__': gives(types.ModuleType, 'mod'),
    '__get__ is a staticmethod': type('StaticGet', (), {'__get__': staticmethod(plain_function)})(),
    '__get__ is a classmethod': type('ClassGet', (), {'__get__': classmethod(plain_function)})(),
    '__get__ is a partial': type('PartialGet', (), {'__get__': functools.partial(plain_function, 1)})(),
    'None': None,
    'number': 5,
}


def receivers(value):
    class Ordinary:
        m = value

    class Hook:
        m = value

        def __getattr__(self, name):
            return lambda *a: ('from __getattr__', name)

    class HookRaises:
        m = value

        def __getattr__(self, name):
            raise AttributeError('hook: ' + name)

    class Own:
        m = value

        def __getattribute__(self, name):
            return object.__getattribute__(self, name)

    class SameSlots:
        __slots__ = ('x', 'y')
        m = value

        def __init__(self):
            self.x = 'my x'
            self.y = 'my y'

    class OfOwner(SlotOwner):
        m = value

        def __init__(self):
            self.x = 'x of the base'

    class Text(str):
        m = value

    class Items(list):
        m = value

    class Short(tuple):
        m = value

    class Number(int):
        m = value

    class Meta(type):
        def __getattr__(cls, name):
            raise AttributeError('meta hook: ' + name)

    class WithMeta(metaclass=Meta):
        m = value

    asked = Ordinary()
    asked.__dict__
    shadowed = Ordinary()
    try:
        shadowed.m = lambda *a: ('of the instance', a)
    except (TypeError, AttributeError):
        shadowed.__dict__['m'] = lambda *a: ('of the instance', a)
    return (Ordinary(), Hook(), HookRaises(), Own(), SameSlots(), OfOwner(), Text('text'), Items([1, 2]), Short((1,)), Short((1, 2, 3)), Number(7),
        WithMeta(), asked, shadowed, Ordinary, Hook, Text, WithMeta)


sites = '''
def read(o): return o.m
def call(o): return o.m()
def call_with(o, f): return o.m(f())
'''


class Usual:
    def m(self, *a):
        return 'Usual.m'


def shown(value):
    if isinstance(value, (types.FunctionType, types.MethodType, types.BuiltinFunctionType, types.MethodWrapperType, types.MethodDescriptorType,
            types.WrapperDescriptorType, types.ClassMethodDescriptorType, types.MemberDescriptorType, types.GetSetDescriptorType, functools.partial,
            types.CodeType, staticmethod, classmethod, property, dict, Raises, Gives, functools.partialmethod)) or type(value).__name__ == '_tuplegetter':
        return '<' + type(value).__name__ + '>'
    return re.sub(' at 0x[0-9a-f]+', '', repr(value))


def attempt(function, *arguments):
    evaluated.clear()
    try:
        result = shown(function(*arguments))
    except Exception as e:
        result = type(e).__name__ + ': ' + str(e)
    return result, 'the argument first' if evaluated else 'the attribute first'


evaluated = []


def argument():
    evaluated.append(1)
    return 'arg'


for name, value in found.items():
    print(name)
    lines = {}
    for position, o in enumerate(receivers(value)):
        results = []
        # A site that has seen nothing else, and one that remembers an object of another class whenever this one comes by.
        for others in ((), (Usual(), Usual())):
            scope = {}
            exec(sites, scope)
            for turn in range(3):
                for other in others:
                    scope['read'](other), scope['call'](other), scope['call_with'](other, argument)
                result, order = attempt(scope['call_with'], o, argument)
                record = (attempt(scope['read'], o)[0], attempt(scope['call'], o)[0], result, order)
                # Where one kind of object comes by again and again, CPython's instruction changes, and with it, in some cases, the order
                # and the words of the message.
                if turn and not others and [part.split(':')[0] for part in record[:3]] == [part.split(':')[0] for part in results[0][:3]]:
                    record = results[0]
                results.append(record)
        who = (o.__name__ + ' itself') if isinstance(o, type) else type(o).__name__ + ('' if position < 8 else ' #%d' % position)
        if len(set(results)) != 1:
            print('  NOT THE SAME EACH TIME', who, results)
        lines.setdefault(results[0], []).append(who)
    for result, who in lines.items():
        print('  ', ', '.join(who))
        for part in result:
            print('      ', part)

print('--- a key that is no str, in the dict of a class, does things while a name is looked up')
import sys
import warnings
warnings.simplefilter('ignore')


class OddKey:
    action = None
    names = ()

    def __init__(self, name):
        self.name = name

    def __hash__(self):
        return hash(self.name)

    def __eq__(self, other):
        action = OddKey.action
        if action and other in OddKey.names:
            OddKey.action = None
            action()
        return False


def arm(names, action):
    OddKey.names = names
    OddKey.action = action


def odd_classes():
    base = type('Base', (), {'x': 'old x', 'm': lambda self: 'old m', 'p': property(lambda self: ('p of', type(self).__name__))})
    middle = type('Middle', (base,), {OddKey(name): 1 for name in ('x', 'm', 'p', '__getattr__', '__getattribute__', '__get__', '__set__', '__delete__')})
    return type('Odd', (middle,), {})


odd_sites = '''
def read_x(o): return o.x
def read_p(o): return o.p
def call_m(o): return o.m()
'''


class Other:
    x = 'x of Other'
    p = 'p of Other'

    def m(self):
        return 'm of Other'


def rebind():
    frame = sys._getframe(2)
    if 'o' in frame.f_locals:
        frame.f_locals['o'] = Other()


# When the key is asked is not the same here and there, so the first answer is not shown where it depends on that.
for names in (('x',), ('m',), ('p',), ('__getattr__',), ('__getattribute__',), ('__get__', '__set__', '__delete__')):
    for what in ('the class is given the names', 'a base is given the names', 'the object is given the names', 'the object loses what it has',
            'the object is asked for its __dict__', 'the class of the object is changed', 'the class is given a __getattr__', 'the local is bound to another object'):
        for warm in (False, True):
            Odd = odd_classes()
            Odd2 = odd_classes()
            o = Odd()
            o.own = 1
            scope = {}
            exec(odd_sites, scope)
            if warm:
                for function in scope.values():
                    if callable(function) and function.__name__ != 'OddKey':
                        function(Other()), function(Other())
            shows_first = what == 'the local is bound to another object'
            action = {
                'the class is given the names': lambda: (setattr(Odd, 'x', 'new x'), setattr(Odd, 'm', lambda self: 'new m'), setattr(Odd, 'p', 'new p')),
                'a base is given the names': lambda: (setattr(Odd.__mro__[1], 'x', 'new x'), setattr(Odd.__mro__[1], 'm', lambda self: 'new m'), setattr(Odd.__mro__[1], 'p', 'new p')),
                'the object is given the names': lambda: (setattr(o, 'x', 'own x'), setattr(o, 'm', lambda: 'own m')),
                'the object loses what it has': lambda: delattr(o, 'own'),
                'the object is asked for its __dict__': lambda: o.__dict__,
                'the class of the object is changed': lambda: setattr(o, '__class__', Other),
                'the class is given a __getattr__': lambda: setattr(Odd, '__getattr__', lambda self, name: 'hook'),
                'the local is bound to another object': rebind,
            }[what]
            results = []
            for name in ('read_x', 'read_p', 'call_m'):
                arm(names, action)
                first = scope[name](o)
                arm((), None)
                results.append((first if shows_first else '...', scope[name](o), scope[name](o), scope[name](Odd()), scope[name](Odd2())))
            agree = (scope['read_x'](o) == getattr(o, 'x'), scope['read_p'](o) == getattr(o, 'p'), scope['call_m'](o) == getattr(o, 'm')())
            # CPython does not look for the special methods by name when an attribute is read.
            if names[0].startswith('__') and not shows_first:
                results = '...'
            print(names[0], '|', what, '|', warm, results, agree)

print('--- a class as an attribute of a class, whose own class is given a __get__ later')


class MetaOfValue(type):
    pass


class Value(metaclass=MetaOfValue):
    pass


class MetaHolder(type):
    x = Value


class Holder(metaclass=MetaHolder):
    x = 'own'
    y = Value


def holder_x(c): return c.x
def holder_y(c): return c.y


print(holder_x(Holder), holder_x(Holder), holder_y(Holder) is Value, holder_y(Holder()) is Value, holder_y(Holder()) is Value)
MetaOfValue.__get__ = lambda self, obj, cls=None: 'got'
MetaOfValue.__set__ = lambda self, obj, value: None
print(holder_x(Holder) == getattr(Holder, 'x'), holder_y(Holder) == getattr(Holder, 'y'), holder_y(Holder()) == getattr(Holder(), 'y'))

print('--- such a key changes the class on one occasion and gives it the name on the next')
# How often the key is asked differs, so each goes on until the class has the name, and what is shown is what happens after that.


def staged(name, install):
    state = {'asked': 0, 'armed': False}

    class StagedKey:
        def __hash__(self):
            return hash(name)

        def __eq__(self, other):
            if state['armed']:
                state['asked'] += 1
                if state['asked'] % 2:
                    Last.touched = state['asked']
                else:
                    install(Last)
            return False

    First = type('First', (), {'__enter__': lambda self: 'old enter', '__exit__': lambda self, *a: None, 'attr': 'old attr', 'meth': lambda self: 'old meth'})
    Middle = type('Middle', (First,), {StagedKey(): 1})
    Last = type('Last', (Middle,), {})
    return Last, state


staged_sites = '''
def store(o, v): o.stored = v
def read(o): return o.attr
def call(o): return o.meth()
def enter(o):
    with o as x: return x
'''
setter_log = []
for name, site, install in (
        ('stored', lambda scope, o: scope['store'](o, 1), lambda cls: setattr(cls, 'stored', property(lambda self: 'property', lambda self, v: setter_log.append(v)))),
        ('attr', lambda scope, o: scope['read'](o), lambda cls: setattr(cls, 'attr', 'new attr')),
        ('meth', lambda scope, o: scope['call'](o), lambda cls: setattr(cls, 'meth', lambda self: 'new meth')),
        ('__enter__', lambda scope, o: scope['enter'](o), lambda cls: setattr(cls, '__enter__', lambda self: 'new enter'))):
    Last, state = staged(name, install)
    scope = {}
    exec(staged_sites, scope)
    state['armed'] = True
    for attempt_number in range(20):
        site(scope, Last())
        if name in Last.__dict__:
            break
        Last.again = attempt_number
    state['armed'] = False
    setter_log.clear()
    o = Last()
    print(name, name in Last.__dict__, [site(scope, o), site(scope, Last()), site(scope, Last())], setter_log, vars(o))

print('--- a built-in type that can be changed is given a __get__, then a __set__')
import ast
import struct


class HoldsBuiltins:
    x = struct.error('e')
    y = ast.AST()


def read_hx(o): return o.x
def read_hy(o): return o.y
def read_hcx(): return HoldsBuiltins.x
def store_hx(o, v): o.x = v


o = HoldsBuiltins()
for turn in range(3):
    print(type(read_hx(o)).__name__, type(read_hy(o)).__name__, type(read_hcx()).__name__)
store_hx(HoldsBuiltins(), 1)
store_hx(HoldsBuiltins(), 2)
struct.error.__get__ = lambda self, obj, cls: 'got x'
ast.AST.__get__ = lambda self, obj, cls: 'got y'
for turn in range(3):
    print(read_hx(o), read_hy(o), read_hcx(), getattr(o, 'x'))
struct.error.__set__ = lambda self, obj, value: print('set', value)
o = HoldsBuiltins()
store_hx(o, 3)
print(vars(o))
del struct.error.__get__, struct.error.__set__, ast.AST.__get__

print('--- a module found in a class is given another class')
held = types.ModuleType('held')


class HoldsModule:
    x = held


def module_read(o): return o.x
def module_read_class(): return HoldsModule.x
def module_store(o, v): o.x = v


o = HoldsModule()
# (Read from the class more than once, CPython's instruction goes on giving the module.)
print([module_read(o) is held for turn in range(3)], module_read_class() is held)
module_store(HoldsModule(), 1)
module_store(HoldsModule(), 2)


class ModuleWithGet(types.ModuleType):
    def __get__(self, obj, cls):
        return 'got'


held.__class__ = ModuleWithGet
print(module_read(o), module_read_class(), getattr(o, 'x'))


class ModuleWithSet(ModuleWithGet):
    def __set__(self, obj, value):
        print('set', value)


held.__class__ = ModuleWithSet
o = HoldsModule()
module_store(o, 3)
print(vars(o))
