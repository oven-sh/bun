# One instruction that sets an attribute sees objects of many kinds in turn, and finds many kinds of thing under the name in the class.
import collections
import functools
import re
import sys
import types
import warnings
warnings.simplefilter('ignore')

log = []


class SlotOwner:
    __slots__ = ('x', 'y')


class SetLogs:
    def __set__(self, obj, value):
        log.append(('__set__', type(obj).__name__, value))


class DeleteOnly:
    def __delete__(self, obj):
        log.append(('__delete__', type(obj).__name__))


class GetOnly:
    def __get__(self, obj, cls):
        return 'from __get__'


class SetRaises:
    def __init__(self, error):
        self.error = error

    def __set__(self, obj, value):
        raise self.error


class MetaSets(type):
    def __set__(cls, obj, value):
        log.append(('__set__ of the metaclass', cls.__name__, type(obj).__name__, value))


class MetaDeletes(type):
    def __delete__(cls, obj):
        log.append(('__delete__ of the metaclass', cls.__name__, type(obj).__name__))


class MetaGets(type):
    def __get__(cls, obj, owner):
        return 'from __get__ of the metaclass'


def sets(base, *args):
    return type(base.__name__.capitalize() + 'Sets', (base,), {'__set__': SetLogs.__set__})(*args)


Pair = collections.namedtuple('Pair', 'first second third')


def plain_function(*a):
    return 'plain_function'


found = {
    'nothing': None,
    'a number': 5,
    'None': (None,),
    'function': plain_function,
    'method of str': str.upper,
    'slot wrapper of object': object.__repr__,
    'class method of dict': dict.__dict__['fromkeys'],
    'staticmethod': staticmethod(plain_function),
    'classmethod': classmethod(plain_function),
    'slot of another class': SlotOwner.__dict__['x'],
    'second slot of another class': SlotOwner.__dict__['y'],
    'getset of int': int.__dict__['real'],
    'getset of function': types.FunctionType.__dict__['__code__'],
    'writable getset of function': types.FunctionType.__dict__['__name__'],
    'member of function': types.FunctionType.__dict__['__globals__'],
    '__dict__ of another class': SetLogs.__dict__['__dict__'],
    '__weakref__ of another class': SetLogs.__dict__['__weakref__'],
    'field of a named tuple': Pair.__dict__['third'],
    'property()': property(),
    'property without a setter': property(plain_function),
    'property with a setter': property(plain_function, lambda self, value: log.append(('setter', type(self).__name__, value))),
    'property with a native setter': property(None, isinstance),
    'property whose setter raises': property(None, lambda self, value: 1 / 0),
    '__set__': SetLogs(),
    '__delete__ only': DeleteOnly(),
    '__get__ only': GetOnly(),
    '__set__ raises AttributeError': SetRaises(AttributeError('no')),
    '__set__ raises TypeError': SetRaises(TypeError('no')),
    'cached_property': functools.cached_property(plain_function),
    'partialmethod': functools.partialmethod(plain_function),
    'class': SetLogs,
    'class whose class has __set__': MetaSets('ClassThatSets', (), {}),
    'class whose class has __delete__': MetaDeletes('ClassThatDeletes', (), {}),
    'class whose class has __get__': MetaGets('ClassThatGets', (), {}),
    'list with __set__': sets(list, [1]),
    'tuple with __set__': sets(tuple, (1,)),
    'dict with __set__': sets(dict, {1: 2}),
    'str with __set__': sets(str, 'text'),
    'int with __set__': sets(int, 5),
    'float with __set__': sets(float, 1.5),
    'exception with __set__': sets(ValueError, 'x'),
    'module with __set__': sets(types.ModuleType, 'mod'),
    'module': types,
}


def receivers(value):
    body = {} if value is None else {'m': value[0] if isinstance(value, tuple) else value}

    def make(name, bases=(), **more):
        return type(name, bases, {**body, **more})

    Ordinary = make('Ordinary')
    Derived = type('Derived', (Ordinary,), {})
    OwnSetAttr = make('OwnSetAttr', __setattr__=lambda self, name, value: (log.append(('__setattr__', name, value)), object.__setattr__(self, name, value))[0])
    OwnDelAttr = make('OwnDelAttr', __delattr__=lambda self, name: log.append(('__delattr__', name)))
    Hook = make('Hook', __getattr__=lambda self, name: 'hook')
    SameSlots = make('SameSlots', __slots__=('x', 'y'))
    NoDict = make('NoDict', __slots__=())
    SlotsAndDict = make('SlotsAndDict', __slots__=('x', '__dict__'))
    OfOwner = make('OfOwner', (SlotOwner,))
    Text = make('Text', (str,))
    Items = make('Items', (list,))
    Mapping = make('Mapping', (dict,))
    Number = make('Number', (int,))
    Error = make('Error', (ValueError,))
    Module = make('Module', (types.ModuleType,))
    def asked():
        o = Ordinary()
        o.__dict__
        return o

    def has_it():
        o = Ordinary()
        o.__dict__['m'] = 'was there'
        return o

    def has_it_as_property():
        o = Ordinary()
        try:
            o.m = 'was there'
        except (AttributeError, TypeError, ZeroDivisionError):
            pass
        return o

    def full():
        o = Ordinary()
        for i in range(12):
            setattr(o, 'f%d' % i, i)
        return o

    def odd():
        o = Ordinary()
        o.__dict__[5] = 'no str'
        return o

    def thinned():
        o = Ordinary()
        for i in range(70):
            setattr(o, 't%d' % i, i)
        for i in range(69):
            delattr(o, 't%d' % i)
        return o

    return (Ordinary, Derived, OwnSetAttr, OwnDelAttr, Hook, SameSlots, NoDict, SlotsAndDict, OfOwner, lambda: Text('t'), Items, Mapping, lambda: Number(3), Error,
        lambda: Module('mod'), asked, has_it, has_it_as_property, full, odd, thinned, lambda: make('Ordinary'), lambda: type('Derived', (make('Ordinary'),), {}))


sites = '''
def store(o, v): o.m = v
def delete(o): del o.m
def augment(o): o.m += 1
'''


class Usual:
    pass


def state(o):
    if isinstance(o, type):
        value = o.__dict__.get('m', 'not in the class')
        return 'class: ' + (value if isinstance(value, str) else type(value).__name__)
    own = getattr(o, '__dict__', None)
    return 'no dict' if own is None else repr({k: v for k, v in own.items() if k == 'm' or k == 5})


def attempt(function, *arguments):
    log.clear()
    try:
        function(*arguments)
        result = 'done'
    except Exception as e:
        result = type(e).__name__ + ': ' + re.sub(' at 0x[0-9a-f]+', '', str(e))
    return result + (' ' + repr(log) if log else '')


for name, value in found.items():
    print(name)
    lines = {}
    for position, make_receiver in enumerate(receivers(value)):
        results = []
        # A site that has seen nothing else, and one that remembers an object of another class whenever this one comes by.
        for others in (0, 2):
            scope = {}
            exec(sites, scope)
            # A new object each time: what a store does depends on what the last one has left.
            for turn in range(3):
                o = make_receiver()
                for other in range(others):
                    usual = Usual()
                    scope['store'](usual, 1), scope['augment'](usual), scope['delete'](usual)
                record = [attempt(scope['store'], o, 'stored'), state(o), attempt(scope['store'], o, 'again'), state(o), attempt(scope['delete'], o), state(o), attempt(scope['delete'], o)]
                o = make_receiver()
                # (What a module says of an attribute that a descriptor of its class refuses to give is another matter.)
                if not isinstance(o, types.ModuleType):
                    record += [attempt(scope['augment'], o), state(o)]
                results.append(tuple(record))
        o = make_receiver()
        who = (o.__name__ + ' itself') if isinstance(o, type) else type(o).__name__ + ('' if position < 15 else ' #%d' % position)
        if len(set(results)) != 1:
            print('  NOT THE SAME EACH TIME', who, sorted(set(results)))
        lines.setdefault(results[0], []).append(who)
    for result, who in lines.items():
        print('  ', ', '.join(who))
        print('      ', ' | '.join(result))

print('--- attributes set in many orders by the same lines')


class Shape:
    pass


def set_a(o, v): o.a = v
def set_b(o, v): o.b = v
def set_c(o, v): o.c = v


setters = {'a': set_a, 'b': set_b, 'c': set_c}
for round in range(3):
    for order in ('abc', 'acb', 'bac', 'bca', 'cab', 'cba', 'aab', 'abab', 'ccc'):
        o = Shape()
        for i, letter in enumerate(order):
            setters[letter](o, (round, i))
        print(order, vars(o), end='; ')
    print()

print('--- as many as there is room for, and more')


def set_many(o, i, v):
    setattr(o, 'n%d' % i, v)


class Roomy:
    def fill(self, v):
        self.r0 = v; self.r1 = v; self.r2 = v; self.r3 = v; self.r4 = v; self.r5 = v; self.r6 = v; self.r7 = v; self.r8 = v; self.r9 = v


def late(o, v):
    o.late0 = v; o.late1 = v; o.late2 = v; o.late3 = v; o.late4 = v; o.late5 = v; o.late6 = v; o.late7 = v


for turn in range(4):
    o = Roomy()
    o.fill(turn)
    late(o, turn)
    late(o, turn + 10)
    o.fill(turn + 20)
    print(len(vars(o)), sum(vars(o).values()), list(vars(o))[-2:])

print('--- the class changes between two stores by the same instruction')


class Changing:
    pass


def store_x(o, v): o.x = v


for step in ('plain', 'property', 'plain again', '__setattr__', 'plain once more', 'slot of a base', '__set__ in a base'):
    if step == 'property':
        Changing.x = property(lambda self: 'p', lambda self, v: log.append(('setter', v)))
    elif step == 'plain again':
        del Changing.x
    elif step == '__setattr__':
        Changing.__setattr__ = lambda self, name, v: log.append(('__setattr__', name, v))
    elif step == 'plain once more':
        del Changing.__setattr__
    elif step == '__set__ in a base':
        Changing.__bases__ = (type('Base', (), {'x': SetLogs()}),)
    log.clear()
    objects = [Changing(), Changing(), Changing()]
    for i, o in enumerate(objects):
        store_x(o, i)
    print(step, [vars(o) for o in objects], log)

print('--- __class__, __dict__ and the object in between')


class First:
    pass


class Second:
    y = property(lambda self: 'p', lambda self, v: log.append(('setter of Second', v)))


def store_y(o, v): o.y = v


log.clear()
o = First()
store_y(o, 1); store_y(First(), 1); store_y(First(), 1)
o.__class__ = Second
store_y(o, 2)
print(vars(o), log)
o.__class__ = First
store_y(o, 3)
print(vars(o), log)
d = o.__dict__
store_y(o, 4)
print(d, d is o.__dict__)
o.__dict__ = {'other': 1}
store_y(o, 5)
print(vars(o), d)
del o.__dict__
store_y(o, 6)
print(vars(o))

print('--- modules, functions, exceptions, classes')
mod = types.ModuleType('mod')


def store_z(o, v): o.z = v


def a_function(): pass


targets = [mod, a_function, ValueError('e'), Shape, Shape(), functools.partial(a_function), types.SimpleNamespace(), mod, a_function]
for turn in range(3):
    for target in targets:
        try:
            store_z(target, turn)
        except (AttributeError, TypeError) as e:
            print(type(e).__name__, e)
    print([getattr(target, 'z', 'none') for target in targets], 'z' in mod.__dict__, 'z' in a_function.__dict__)
for target in (5, 'text', None, (1,), [1], {1: 2}, object(), 1.5, len, str.upper, 'abc'.upper, int):
    for turn in range(2):
        try:
            store_z(target, 1)
            print('stored')
        except (AttributeError, TypeError) as e:
            print(type(e).__name__, e)

print('--- a key that is no str, in the dict of a class, does things while the name is looked up')


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


def odd_class():
    middle = type('Middle', (), {OddKey(name): 1 for name in ('w', '__setattr__', '__set__', '__delete__')})
    return type('Odd', (middle,), {})


class Elsewhere:
    pass


def rebind():
    frame = sys._getframe(2)
    if 'o' in frame.f_locals:
        frame.f_locals['o'] = Elsewhere()


for what in ('the class is given a property', 'the object is given attributes', 'the object loses what it has', 'the object is asked for its __dict__',
        'the class of the object is changed', 'the class is given a __setattr__', 'the local is bound to another object', 'much is collected'):
    for warm in (False, True):
        Odd = odd_class()
        o = Odd()
        o.own = 1
        scope = {}
        exec('def store_w(o, v): o.w = v', scope)
        store_w = scope['store_w']
        if warm:
            store_w(Elsewhere(), 0), store_w(Elsewhere(), 0)

        def much():
            import gc
            for i in range(300):
                setattr(o, 'g%d' % i, i)
            gc.collect()
        action = {
            'the class is given a property': lambda: setattr(Odd, 'w', property(lambda self: 'p', lambda self, v: log.append(('setter', v)))),
            'the object is given attributes': lambda: (setattr(o, 'e1', 1), setattr(o, 'e2', 2)),
            'the object loses what it has': lambda: delattr(o, 'own'),
            'the object is asked for its __dict__': lambda: o.__dict__,
            'the class of the object is changed': lambda: setattr(o, '__class__', Elsewhere),
            'the class is given a __setattr__': lambda: setattr(Odd, '__setattr__', lambda self, name, v: log.append(('__setattr__', name, v))),
            'the local is bound to another object': rebind,
            'much is collected': much,
        }[what]
        log.clear()
        OddKey.names = ('w',)
        OddKey.action = action
        store_w(o, 'first')
        OddKey.action = None
        first = (o.__dict__.get('w'), list(log)) if what in ('the local is bound to another object', 'the object is given attributes', 'the object loses what it has', 'the object is asked for its __dict__', 'much is collected') else '...'
        log.clear()
        p, q = Odd(), Odd()
        store_w(o, 'second'), store_w(p, 'third'), store_w(q, 'fourth')
        # When the key is asked is not the same here and there, so where the first store went is not shown where it depends on that.
        print(what, '|', warm, first, o.__dict__.get('w') if first != '...' else '...', vars(p), vars(q), log)

print('--- what cannot be the __dict__ of an object')
for target in (Shape(), ValueError('e'), a_function):
    for value in (frozendict({'a': 1}), types.MappingProxyType({}), [], None, type('DictChild', (dict,), {})(b=2)):
        try:
            target.__dict__ = value
            store_z(target, 'stored')
            print(type(target).__name__, type(value).__name__, dict(target.__dict__), target.__dict__ is value)
        except (TypeError, AttributeError) as e:
            print(type(target).__name__, type(value).__name__, type(e).__name__, e)

print('--- static and class methods of built-in types')
for wrapper in (str.__dict__['maketrans'], bytes.__dict__['maketrans'], staticmethod(len), classmethod(len)):
    for turn in range(2):
        try:
            store_z(wrapper, turn)
            print(type(wrapper).__name__, wrapper.z, wrapper.__dict__.get('z'), wrapper.__name__)
        except (TypeError, AttributeError) as e:
            print(type(wrapper).__name__, type(e).__name__, e)

print('--- one object at a time, with a collection in between')
import gc


class Lonely:
    def __init__(self, v):
        self.a = v; self.b = v; self.c = v; self.d = v; self.e = v; self.f = v; self.g = v; self.h = v


for turn in range(6):
    o = Lonely(turn)
    print(sum(vars(o).values()), end=' ')
    del o
    gc.collect()
print()

print('--- a static method of a built-in type is given another __dict__ before anything has looked at the one it had')
wrapper = bytearray.__dict__['maketrans']
wrapper.__dict__ = {}
print(wrapper.__dict__, hasattr(wrapper, '__name__'))
store_z(wrapper, 1)
print(wrapper.__dict__)
