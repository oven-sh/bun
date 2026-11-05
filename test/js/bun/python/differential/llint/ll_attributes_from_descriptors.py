# Attributes that are what a descriptor gives for the object: bound methods that are read and not called, built-in getters, descriptors
# of the program's own, on instances, on classes, and on ints and the like. Each is read from one place, several times.
import functools


def attempt(function, *args):
    try:
        return function(*args)
    except Exception as e:
        extra = ''
        # (Whether an error that the program's own code raised is told the name depends on how CPython has specialized the instruction.)
        if isinstance(e, AttributeError) and 'from ' not in str(e) and 'hook' not in str(e):
            extra = ' [name=%r obj=%s]' % (e.name, type(e.obj).__name__ if e.obj is not None else None)
        return '%s: %s%s' % (type(e).__name__, e, extra)


def show(value, name=None):
    # (Many come from an address.)
    if name == '__hash__' and isinstance(value, int):
        return '<a hash>'
    if isinstance(value, str):
        return value
    text = repr(value)
    for noise in (' at 0x', ' object at '):
        if noise in text:
            return '<%s>' % type(value).__name__
    return text


class Data:
    def __init__(self, name): self.name = name
    def __get__(self, obj, cls): return ('data', self.name, obj is None, cls.__name__)
    def __set__(self, obj, value): raise AttributeError('read only')


class NonData:
    def __init__(self, name): self.name = name
    def __get__(self, obj, cls): return ('nondata', self.name, obj is None, cls.__name__)


class Raising:
    def __get__(self, obj, cls): raise AttributeError('from __get__')


class RaisingData(Raising):
    def __set__(self, obj, value): pass


class RaisingOther:
    def __get__(self, obj, cls): raise KeyError('from __get__')


class SetOnly:
    def __set__(self, obj, value): pass


class Meta(type):
    meta_data = Data('meta_data')
    meta_nondata = NonData('meta_nondata')
    both = Data('both of the metaclass')
    weak = NonData('weak of the metaclass')
    meta_plain = 'meta_plain'
    def meta_method(cls): return cls.__name__
    @property
    def meta_property(cls): return 'meta_property of ' + cls.__name__
    @property
    def meta_raises(cls): raise AttributeError('from the property of the metaclass')


class Base(metaclass=Meta):
    __slots__ = ()
    def method(self): return 'method'
    @classmethod
    def cm(cls): return cls.__name__
    @staticmethod
    def sm(): return 'sm'
    @property
    def prop(self): return 'prop'
    @property
    def prop_raises(self): raise AttributeError('from the property')
    @property
    def prop_raises_other(self): raise ValueError('from the property')
    data = Data('data')
    nondata = NonData('nondata')
    raising = Raising()
    raising_data = RaisingData()
    raising_other = RaisingOther()
    set_only = SetOnly()
    both = 'both of the class'
    weak = 'weak of the class'
    plain = 'plain'
    length = len
    from_other = list.append
    from_keys = dict.fromkeys
    partial = functools.partial(max, 1)
    nothing = None


class Plain(Base):
    pass


class Slotted(Base):
    __slots__ = ('filled', 'unfilled')
    def __init__(self): self.filled = 1


class Hooked(Base):
    def __getattr__(self, name): return 'hook: ' + name


class HookedRaises(Base):
    def __getattr__(self, name): raise AttributeError('the hook knows no ' + name)


class Shadowing(Base):
    def __init__(self):
        for name in ('method', 'cm', 'sm', 'prop', 'data', 'nondata', 'raising', 'raising_data', 'plain', 'length', 'set_only'):
            self.__dict__[name] = 'own ' + name


class MetaHooked(Meta):
    def __getattr__(cls, name): return 'hook of the metaclass: ' + name


class OfMetaHooked(Base, metaclass=MetaHooked):
    pass


class Cached:
    @functools.cached_property
    def cached(self): return object()
    @functools.lru_cache
    def remembered(self): return 'remembered'


NAMES = ['method', 'cm', 'sm', 'prop', 'prop_raises', 'prop_raises_other', 'data', 'nondata', 'raising', 'raising_data', 'raising_other', 'set_only', 'both', 'weak',
         'plain', 'length', 'from_other', 'from_keys', 'partial', 'nothing', 'filled', 'unfilled', 'absent', 'meta_data', 'meta_nondata', 'meta_plain', 'meta_method',
         'meta_property', 'meta_raises', '__class__', '__dict__', '__doc__', '__module__', '__name__', '__qualname__', '__mro__', '__bases__', '__slots__', '__weakref__',
         '__init__', '__eq__', '__hash__', '__new__', '__init_subclass__', '__call__', '__getattribute__']

readers = {}
callers = {}
for name in NAMES:
    namespace = {}
    exec('def read(o): return o.%s\ndef call(o): return o.%s()' % (name, name), namespace)
    readers[name] = namespace['read']
    callers[name] = namespace['call']

objects = [Plain(), Slotted(), Hooked(), HookedRaises(), Shadowing(), Plain, Slotted, Hooked, OfMetaHooked, OfMetaHooked(), Meta]
for name in NAMES:
    for round in range(2):
        for o in objects:
            label = o.__name__ if isinstance(o, type) else 'a ' + type(o).__name__
            print('%s.%s -> %s | () -> %s' % (label, name, show(attempt(readers[name], o)), show(attempt(callers[name], o), name)))


print('--- what is read is bound to the object it was read from')


def bound_of(o): return o.method
def class_bound_of(o): return o.cm
a, b = Plain(), Plain()
for o in (a, b, a):
    m = bound_of(o)
    print(m.__self__ is o, m.__func__ is Base.method, m(), bound_of(o) is m, bound_of(o) == m)
    c = class_bound_of(o)
    print(c.__self__ is Plain, c(), class_bound_of(type(o)).__self__ is Plain)


print('--- values that are no objects of their own, strs and lists')
VALUES = [5, -1, 2 ** 40, 2 ** 80, 1.5, True, None, 'text', [1, 2], (1, 2), {1: 2}, {1}, b'b', 3 + 4j, range(3), slice(1, 2, 3), ..., NotImplemented, len, print]
for name in ['__class__', 'real', 'imag', 'numerator', 'bit_length', 'is_integer', 'conjugate', '__add__', '__doc__', 'append', 'upper', 'join', 'start', 'stop', 'step', 'get', 'keys',
             '__len__', '__name__', '__self__', '__dict__', 'absent', '__hash__', '__bool__', 'from_bytes', 'fromkeys', 'maketrans', 'fromhex', '__module__', '__qualname__']:
    namespace = {}
    exec('def read(o): return o.%s\ndef call(o): return o.%s()' % (name, name), namespace)
    for round in range(2):
        for value in VALUES:
            result = attempt(namespace['read'], value)
            if name == '__doc__' and isinstance(result, str):
                result = result[:20]
            called = attempt(namespace['call'], value)
            print('%s %s -> %s | () -> %s' % (type(value).__name__, name, show(result), show(called, name)[:90]))


print('--- the class of a descriptor changes what it is')


class Changing:
    pass


class Holder:
    changing = Changing()


def read_changing(o): return o.changing
h = Holder()
h.__dict__['changing'] = 'own'
print(show(read_changing(h)), show(read_changing(Holder)))
Changing.__get__ = lambda self, obj, cls: 'got'
print(show(read_changing(h)), show(read_changing(Holder)))
Changing.__set__ = lambda self, obj, value: None
print(show(read_changing(h)), show(read_changing(Holder)))
del Changing.__get__
print(show(read_changing(h)), show(read_changing(Holder)))
del Changing.__set__
print(show(read_changing(h)), show(read_changing(Holder)))


print('--- a hook is given to the class, and taken away')


def read_raising(o): return o.raising
def read_prop(o): return o.prop_raises
p = Plain()
print(attempt(read_raising, p), '|', attempt(read_prop, p))
Plain.__getattr__ = lambda self, name: 'late hook: ' + name
print(attempt(read_raising, p), '|', attempt(read_prop, p))
del Plain.__getattr__
print(attempt(read_raising, p), '|', attempt(read_prop, p))
Meta.__getattr__ = lambda cls, name: 'late hook of the metaclass: ' + name
print(attempt(read_raising, Plain), '|', attempt(readers['meta_raises'], Plain), '|', attempt(readers['absent'], Plain))
del Meta.__getattr__
print(attempt(read_raising, Plain), '|', attempt(readers['meta_raises'], Plain), '|', attempt(readers['absent'], Plain))


print('--- descriptors from functools')
c = Cached()
def read_cached(o): return o.cached
def read_remembered(o): return o.remembered
first = read_cached(c)
print(read_cached(c) is first, read_cached(Cached()) is first, type(read_cached(Cached)).__name__)
print(read_remembered(c)(), c.remembered(), type(read_remembered(Cached)).__name__)


print('--- a getter that changes the object or the class on the way')


class Sly:
    count = 0
    @property
    def turns(self):
        Sly.count += 1
        if Sly.count == 2:
            Sly.turns = 'a plain value now'
        return 'property %d' % Sly.count


def read_turns(o): return o.turns
s = Sly()
print([read_turns(s) for _ in range(4)])


class Moves:
    @property
    def cls(self):
        self.__class__ = Moved
        return 'was Moves'


class Moved:
    cls = 'is Moved'


def read_cls(o): return o.cls
m = Moves()
print([read_cls(m) for _ in range(3)], [read_cls(Moves()) for _ in range(2)])


print('--- an AttributeError from a descriptor of the metaclass is told which attribute of which class it was')


class BareData:
    def __get__(self, obj, cls): raise AttributeError
    def __set__(self, obj, value): pass


class BareNonData:
    def __get__(self, obj, cls): raise AttributeError


class BareMeta(type):
    x = BareData()
    y = BareNonData()
    @property
    def p(cls): raise AttributeError


class OfBareMeta(metaclass=BareMeta):
    z = BareNonData()
    w = BareData()


def told(function, o):
    try:
        function(o)
    except AttributeError as e:
        return (e.name, e.obj is o)


for name in ('x', 'y', 'p', 'z', 'w', '__abstractmethods__'):
    namespace = {}
    exec('def read(o): return o.%s\ndef call(o): return o.%s()' % (name, name), namespace)
    for o in (OfBareMeta, type):
        print(name, o.__name__, [told(namespace['read'], o) for _ in range(3)], [told(namespace['call'], o) for _ in range(3)])
