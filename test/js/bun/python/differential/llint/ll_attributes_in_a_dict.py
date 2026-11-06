# Objects that have been asked for their __dict__, or were given one, read and called at one instruction again and again, while the
# dict, the class and the object change under it.
import collections
import copy


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


def read_v(o):
    return o.v


def read_k(o):
    return o.k


def call_m(o):
    return o.m(1)


def read_m(o):
    return o.m


def thrice(label, function, *objects):
    for turn in range(3):
        for index, o in enumerate(objects):
            show('%s %d.%d' % (label, turn, index), function, o)


class C:
    k = 'C.k'

    def __init__(self, v='v'):
        self.v = v

    def m(self, x):
        return ('C.m', type(self).__name__, x)


class D(C):
    def m(self, x):
        return ('D.m', type(self).__name__, x)


def asked(o):
    o.__dict__
    return o


print('--- plain reads')
a, b, c = asked(C('a')), asked(C('b')), C('c')
thrice('v', read_v, a, b, c)
thrice('k', read_k, a, b, c)
thrice('m()', call_m, a, b, c, asked(D('d')))
for turn in range(3):
    bound = read_m(a)
    print('bound', bound.__self__ is a, bound.__func__ is C.m, bound(turn))

print('--- the dict comes before what is no data descriptor')
a.__dict__['k'] = 'a.k'
a.__dict__['m'] = lambda x: ('in the dict', x)
thrice('k', read_k, a, b)
thrice('m()', call_m, a, b)
show('m', lambda: read_m(a)(5))
del a.__dict__['k'], a.__dict__['m']
thrice('k', read_k, a, b)
thrice('m()', call_m, a, b)

print('--- entries come and go')
for turn in range(3):
    show('v', read_v, a)
    del a.__dict__['v']
    show('v gone', read_v, a)
    a.v = turn
    show('v back', read_v, a)
    a.__dict__.clear()
    show('v cleared', read_v, a)
    a.__dict__.update(v=('updated', turn))
    show('v updated', read_v, a)
    vars(a).pop('v')
    show('v popped', read_v, a)
    setattr(a, 'v', 'set')

print('--- another dict')
other = {'v': 'other v'}
for turn in range(2):
    a.__dict__ = other
    show('v', read_v, a)
    print(a.__dict__ is other)
    other['v'] = ('changed', turn)
    show('v', read_v, a)
    a.__dict__ = {}
    show('v', read_v, a)
    show('k', read_k, a)
    show('m()', call_m, a)
    a.__dict__ = {'v': 'new', 'k': 'new k'}
    show('v', read_v, a)
    show('k', read_k, a)
a.__dict__ = b.__dict__
b.v = 'shared'
thrice('shared', read_v, a, b)


class Loud(dict):
    def __getitem__(self, key):
        print('__getitem__', key)
        return dict.__getitem__(self, key)

    def get(self, key, default=None):
        print('get', key)
        return dict.get(self, key, default)

    def __contains__(self, key):
        print('__contains__', key)
        return dict.__contains__(self, key)

    def __missing__(self, key):
        print('__missing__', key)
        return 'missing'


a.__dict__ = Loud(v='loud v')
thrice('derived dict', read_v, a)
thrice('derived dict', read_k, a)
a.__dict__ = collections.OrderedDict(v='ordered v')
thrice('ordered', read_v, a)
a.__dict__ = collections.defaultdict(lambda: 'default', v='defaultdict v')
thrice('defaultdict', read_v, a)
thrice('defaultdict', lambda o: o.absent, a)
show('not a dict', setattr, a, '__dict__', [])
show('not a dict', setattr, a, '__dict__', None)
show('deleted', delattr, a, '__dict__')
show('v', read_v, a)
show('after', lambda: a.__dict__)

print('--- keys that are no strs')


class Key:
    def __init__(self, text):
        self.text = text

    def __hash__(self):
        print('hash of a key')
        return hash(self.text)

    def __eq__(self, other):
        print('a key is asked', other)
        return self.text == other


class Text(str):
    pass


e = asked(C('e'))
thrice('v', read_v, e)
e.__dict__[1] = 'one'
thrice('v', read_v, e)
e.__dict__[Key('w')] = 'by a key'
thrice('w', lambda o: o.w, e)
thrice('v', read_v, e)
e.__dict__[Text('t')] = 'by a derived str'
thrice('t', lambda o: o.t, e)
e.__dict__.clear()
e.v = 'again'
thrice('v', read_v, e)

print('--- the class changes')
f, g = asked(C('f')), asked(C('g'))
thrice('v', read_v, f, g)
C.v = 'C.v'
thrice('class value', read_v, f, g)
C.v = property(lambda self: ('property', self.__dict__['v']))
thrice('property', read_v, f, g)
C.v = property(lambda self: 1 / 0)
thrice('property', read_v, f)
del C.v
thrice('gone', read_v, f, g)


class OnlyGet:
    def __get__(self, instance, owner):
        return ('OnlyGet', instance is not None)


class GetAndSet(OnlyGet):
    def __set__(self, instance, value):
        raise AttributeError('read only')


class OnlySet:
    def __set__(self, instance, value):
        instance.__dict__['v'] = ('set', value)


C.v = OnlyGet()
thrice('only __get__', read_v, f, g)
del f.__dict__['v']
thrice('only __get__', read_v, f, g)
f.__dict__['v'] = 'f'
C.v = GetAndSet()
thrice('__get__ and __set__', read_v, f, g)
C.v = OnlySet()
thrice('only __set__', read_v, f, g)
f.v = 'through __set__'
thrice('only __set__', read_v, f, g)
del f.__dict__['v']
show('only __set__, not in the dict', lambda: type(read_v(f)).__name__)
f.__dict__['v'] = 'f'
descriptor = OnlyGet()
C.v = descriptor
thrice('before its class changes', read_v, f)
OnlyGet.__set__ = lambda self, instance, value: None
thrice('its class has a __set__ now', read_v, f)
del OnlyGet.__set__
thrice('and has not', read_v, f)
del C.v

print('--- methods')
thrice('m()', call_m, f, g)
C.m = lambda self, x: ('another', x)
thrice('m()', call_m, f, g)
C.m = staticmethod(lambda x: ('static', x))
thrice('m()', call_m, f, g)
C.m = classmethod(lambda cls, x: ('class', cls.__name__, x))
thrice('m()', call_m, f, g, asked(D()))
f.__dict__['m'] = len
show('m()', lambda: f.m('abc'))
C.m = property(lambda self: lambda x: ('property', x))
thrice('m()', call_m, f, g)
del f.__dict__['m']
C.m = 5
thrice('m()', call_m, f)
del C.m
thrice('m()', call_m, f)
C.m = lambda self, x: ('back', x)

print('--- __getattr__, __getattribute__')
thrice('absent', lambda o: o.absent, f)
C.__getattr__ = lambda self, name: ('__getattr__', name)
thrice('absent', lambda o: o.absent, f)
thrice('v', read_v, f, g)
thrice('m()', call_m, f)
C.p = property(lambda self: self.nothing_here_at_all)
thrice('p', lambda o: o.p, f)
del C.p
del C.__getattr__
thrice('absent', lambda o: o.absent, f)
C.__getattribute__ = lambda self, name: ('__getattribute__', name)
thrice('v', read_v, f, g)
show('m', read_m, f)
del C.__getattribute__
thrice('v', read_v, f, g)

print('--- another class for the object')


class Other:
    k = 'Other.k'
    v = property(lambda self: 'Other.v')

    def m(self, x):
        return ('Other.m', x)


h = asked(C('h'))
for turn in range(2):
    thrice('C', read_v, h)
    thrice('C', read_k, h)
    thrice('C', call_m, h)
    h.__class__ = Other
    thrice('Other', read_v, h)
    thrice('Other', read_k, h)
    thrice('Other', call_m, h)
    h.__class__ = C

print('--- how an object comes to its dict')


def fresh(how):
    o = C(how)
    o.w = 'w'
    return o


ways = {
    'vars': vars,
    'hasattr': lambda o: hasattr(o, '__dict__'),
    'getattr': lambda o: getattr(o, '__dict__'),
    'copy': copy.copy,
    'deepcopy': copy.deepcopy,
    'reduce': lambda o: o.__reduce_ex__(4),
    'getstate': lambda o: o.__getstate__(),
    'dir': dir,
    'update': lambda o: o.__dict__.update(z=1),
    'assign': lambda o: setattr(o, '__dict__', dict(o.__dict__)),
}
for how, way in ways.items():
    o = fresh(how)
    show(how, read_v, o)
    way(o)
    for turn in range(3):
        show(how, read_v, o)
        show(how, read_k, o)
        show(how, call_m, o)
    print(how, list(o.__dict__))
    o.last = 1
    del o.w
    print(how, list(o.__dict__), o.__getstate__() is o.__dict__)
for how in ('copy', 'deepcopy'):
    o = fresh(how)
    twin = getattr(copy, how)(o)
    twin.v = 'twin'
    thrice(how, read_v, o, twin)
    print(o.__dict__ is twin.__dict__, o.__dict__ == twin.__dict__)

print('--- objects of classes derived from built-in ones')


class MyDict(dict):
    k = 'MyDict.k'

    def m(self, x):
        return ('MyDict.m', x)


class MyStr(str):
    k = 'MyStr.k'

    def m(self, x):
        return ('MyStr.m', x)


class MyList(list):
    k = 'MyList.k'

    def m(self, x):
        return ('MyList.m', x)


class MyInt(int):
    k = 'MyInt.k'

    def m(self, x):
        return ('MyInt.m', x)


class MyError(Exception):
    k = 'MyError.k'

    def m(self, x):
        return ('MyError.m', x)


derived = [MyDict(v='an item, no attribute'), MyStr('s'), MyList([1]), MyInt(7), MyError('e')]
thrice('no v yet', read_v, *derived)
for o in derived:
    o.v = ('v of', type(o).__name__)
thrice('v', read_v, *derived)
thrice('k', read_k, *derived)
thrice('m()', call_m, *derived)
for o in derived:
    o.k = 'own k'
    o.m = lambda x: ('own m', x)
thrice('k', read_k, *derived)
thrice('m()', call_m, *derived)
for o in derived:
    del o.k, o.m
    o.__dict__['v'] = 'through the dict'
thrice('k', read_k, *derived)
thrice('m()', call_m, *derived)
thrice('v', read_v, *derived)
thrice('get', lambda o: o.get('v'), derived[0])
derived[0].get = lambda key: ('own get', key)
thrice('get', lambda o: o.get('v'), derived[0])
del derived[0].get
thrice('get', lambda o: o.get('v'), derived[0])

print('--- one instruction, with and without a dict, in turn')
mixed = [C('plain'), asked(C('asked')), D('plain D'), asked(D('asked D')), MyDict(), Other()]
mixed[4].v = 'MyDict v'
thrice('v', read_v, *mixed)
thrice('k', read_k, *mixed)
thrice('m()', call_m, *mixed)

print('--- __slots__ and a __dict__')


class Both:
    __slots__ = ('s', '__dict__')
    k = 'Both.k'

    def __init__(self, tag):
        self.s = ('slot', tag)
        self.v = ('v', tag)

    def m(self, x):
        return ('Both.m', x)


class BothDerived(Both):
    __slots__ = ('t',)


both = [Both(1), asked(Both(2)), BothDerived(3), asked(BothDerived(4))]
thrice('s', lambda o: o.s, *both)
thrice('v', read_v, *both)
thrice('k', read_k, *both)
thrice('m()', call_m, *both)
thrice('t', lambda o: o.t, *both)
for o in both:
    o.__dict__['s'] = 'in the dict, behind the slot'
    o.__dict__['k'] = 'in the dict, before the class'
thrice('s', lambda o: o.s, *both)
thrice('k', read_k, *both)
for o in both:
    del o.s
thrice('s', lambda o: o.s, *both)
print([sorted(o.__dict__) for o in both])

print('--- another thread changes the dict between two reads')
import threading


def in_a_thread(function):
    thread = threading.Thread(target=function)
    thread.start()
    thread.join()


shared = asked(C('first'))
replacement = {'v': 'replaced by a thread'}
steps = [
    lambda: shared.__dict__.__setitem__('v', 'set by a thread'),
    lambda: setattr(shared, '__dict__', replacement),
    lambda: replacement.__setitem__('v', 'the new dict changed by a thread'),
    lambda: replacement.pop('v'),
    lambda: setattr(C, 'v', property(lambda self: 'a property given by a thread')),
    lambda: delattr(C, 'v'),
    lambda: setattr(shared, 'v', 'last'),
    lambda: replacement.__setitem__(1, 'a key that is no str'),
    lambda: setattr(shared, '__class__', D),
]
for step in steps:
    show('v', read_v, shared)
    show('m()', call_m, shared)
    in_a_thread(step)
show('v', read_v, shared)
show('m()', call_m, shared)

stop = False
seen = set()


def swap():
    one, two = {'v': 1}, {'v': 2}
    while not stop:
        shared.__dict__ = one
        shared.__dict__ = two


swapper = threading.Thread(target=swap)
shared.__dict__ = {'v': 1}
swapper.start()
for turn in range(20000):
    seen.add(read_v(shared))
stop = True
swapper.join()
print(seen <= {1, 2})
