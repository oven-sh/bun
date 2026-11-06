# What the class of an object has under a name, where the object keeps its attributes in a dict that comes first: static methods, class
# methods, functions to bind, descriptors without __set__, values whose class may become a descriptor's. Each is read and called at one
# instruction again and again, while the dict, the class, the descriptor and the class of the descriptor change under it.
import functools
import types


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


def tell(value):
    if isinstance(value, types.MethodType):
        return ('bound', value.__func__.__name__, tell(value.__self__))
    if isinstance(value, type):
        return ('class', value.__name__)
    if isinstance(value, (types.FunctionType, types.BuiltinFunctionType)):
        return ('function', value.__name__)
    if type(value).__module__ == '__main__':
        return ('a', type(value).__name__)
    return value


def asked(o):
    o.__dict__
    return o


NAMES = ['s', 'c', 'm', 'g', 'p', 'w', 'n', 'cn', 'sn']
READ = {}
CALL = {}
for name in NAMES:
    namespace = {'tell': tell}
    exec('def read(o):\n    return tell(o.%s)\ndef call(o):\n    return tell(o.%s(1))\n' % (name, name), namespace)
    READ[name], CALL[name] = namespace['read'], namespace['call']


def every(label, *objects, names=NAMES, turns=2):
    for name in names:
        for turn in range(turns):
            for index, o in enumerate(objects):
                show('%s read %s %d.%d' % (label, name, turn, index), READ[name], o)
                show('%s call %s %d.%d' % (label, name, turn, index), CALL[name], o)


class Getter:
    def __init__(self, what):
        self.what = what

    def __get__(self, o, t=None):
        return lambda x=0: ('got', self.what, tell(o), tell(t), x)


class Plain:
    def __call__(self, x):
        return ('called a Plain', x)


def make():
    class C:
        @staticmethod
        def s(x=0):
            return ('C.s', x)

        @classmethod
        def c(cls, x=0):
            return ('C.c', cls.__name__, x)

        def m(self, x=0):
            return ('C.m', type(self).__name__, x)

        g = Getter('C.g')

        @functools.cached_property
        def p(self):
            return lambda x=0: ('C.p', x)

        w = Plain()
        n = len
        cn = classmethod(len)
        sn = staticmethod(len)

        def __len__(self):
            return 3

    class D(C):
        pass

    return C, D


print('--- as they are')
C, D = make()
every('first', asked(C()), asked(C()), C(), asked(D()))

print('--- the dict has the name, then has it no longer')
C, D = make()
o, other = asked(C()), asked(C())
every('before', o, other)
for name in NAMES:
    o.__dict__[name] = lambda x=0, name=name: ('of the object', name, x)
every('shadowed', o, other)
for name in NAMES:
    del o.__dict__[name]
every('uncovered', o, other)

print('--- the class is written to')
C, D = make()
o, d = asked(C()), asked(D())
every('before', o, d)
C.s = staticmethod(lambda x=0: ('new s', x))
C.c = classmethod(lambda cls, x=0: ('new c', cls.__name__, x))
C.m = lambda self, x=0: ('new m', type(self).__name__, x)
C.g = Getter('new g')
C.w = 5
every('written', o, d, names=['s', 'c', 'm', 'g', 'w'])
C.s, C.c, C.m = C.__dict__['m'], C.__dict__['s'], C.__dict__['c']
every('exchanged', o, d, names=['s', 'c', 'm'])
del C.s, C.c, C.m, C.g, C.w
every('deleted', o, d, names=['s', 'c', 'm', 'g', 'w'])
D.s = staticmethod(lambda x=0: ('D.s', x))
every('in the derived class', o, d, names=['s'])

print('--- what a static method or a class method wraps is changed')
C, D = make()
o = asked(C())
every('before', o, names=['s', 'c'])
C.__dict__['s'].__init__(lambda x=0: ('wrapped anew s', x))
C.__dict__['c'].__init__(lambda cls, x=0: ('wrapped anew c', cls.__name__, x))
every('after', o, names=['s', 'c'])
C.__dict__['c'].__init__(len)
C.__dict__['s'].__init__(Plain())
every('no functions', o, names=['s', 'c'])

print('--- the class of the descriptor is given a __set__, a __delete__, and loses them')
C, D = make()
o = asked(C())
o.__dict__['g'] = lambda x=0: ('g of the object', x)
o.__dict__['w'] = lambda x=0: ('w of the object', x)
every('before', o, names=['g', 'w'])
Getter.__set__ = lambda self, o, value: None
every('Getter has __set__', o, names=['g', 'w'])
del Getter.__set__
every('no longer', o, names=['g', 'w'])
Getter.__delete__ = lambda self, o: None
every('Getter has __delete__', o, names=['g', 'w'])
del Getter.__delete__
every('no longer', o, names=['g', 'w'])
Plain.__set__ = lambda self, o, value: None
every('Plain has __set__ and no __get__', o, names=['g', 'w'])
Plain.__get__ = lambda self, o, t=None: lambda x=0: ('Plain got', tell(o), x)
every('Plain has both', o, names=['g', 'w'])
del Plain.__set__
every('Plain has __get__', o, names=['g', 'w'])
del o.__dict__['w']
every('and the dict has nothing', o, names=['g', 'w'])
del Plain.__get__
every('Plain is plain again', o, names=['g', 'w'])

print('--- the descriptor is given another class')


class Data:
    def __get__(self, o, t=None):
        return lambda x=0: ('Data got', x)

    def __set__(self, o, value):
        pass


C, D = make()
o = asked(C())
o.__dict__['w'] = lambda x=0: ('w of the object', x)
every('before', o, names=['w'])
C.__dict__['w'].__class__ = Data
every('a data descriptor', o, names=['w'])
C.__dict__['w'].__class__ = Plain
every('plain again', o, names=['w'])

print('--- __get__ raises AttributeError; the class is given a __getattr__ and loses it')


class Refuses:
    def __get__(self, o, t=None):
        raise AttributeError('refused')


C, D = make()
C.g = Refuses()
o = asked(C())
every('no hook', o, names=['g', 's', 'm', 'w'])
C.__getattr__ = lambda self, name: lambda x=0: ('from the hook', name, x)
every('hook', o, names=['g', 's', 'm', 'w'])
Plain.__get__ = Refuses.__get__
every('hook, and Plain refuses', o, names=['w'])
del C.__getattr__
every('no hook, and Plain refuses', o, names=['w'])
del Plain.__get__
every('no hook', o, names=['g', 's', 'm', 'w'])

print('--- a cached property: filled by the first read')
C, D = make()
o, other = C(), C()
every('two', o, other, names=['p'], turns=3)
del o.__dict__['p']
every('one emptied', o, other, names=['p'], turns=3)

print('--- another dict, and keys that are no strs')
C, D = make()
o = asked(C())
every('before', o, names=['s', 'm', 'g'])
o.__dict__ = {'s': lambda x=0: ('s of the second dict', x)}
every('second dict', o, names=['s', 'm', 'g'])


class Key:
    def __init__(self, name):
        self.name = name

    def __hash__(self):
        return hash(self.name)

    def __eq__(self, other):
        print('   asked whether it equals', other)
        return self.name == other


o.__dict__ = {Key('m'): lambda x=0: ('m under a key', x)}
every('a key', o, names=['s', 'm', 'g'])
o.__dict__ = {}
every('empty', o, names=['s', 'm', 'g'])

print('--- objects of many kinds at one instruction')
C, D = make()


class S:
    __slots__ = ('__dict__',)
    s = staticmethod(lambda x=0: ('S.s', x))
    c = classmethod(lambda cls, x=0: ('S.c', cls.__name__, x))

    def m(self, x=0):
        return ('S.m', x)


class L(list):
    s = staticmethod(lambda x=0: ('L.s', x))
    c = classmethod(lambda cls, x=0: ('L.c', cls.__name__, x))

    def m(self, x=0):
        return ('L.m', x)


class E(Exception):
    s = staticmethod(lambda x=0: ('E.s', x))
    c = classmethod(lambda cls, x=0: ('E.c', cls.__name__, x))

    def m(self, x=0):
        return ('E.m', x)


module = types.ModuleType('module')
module.s = module.c = module.m = lambda x=0: ('of the module', x)
every('mixed', asked(C()), C(), asked(D()), S(), asked(L()), E(), module, C, names=['s', 'c', 'm'], turns=3)

print('--- the class of the object is changed')
C, D = make()
C2, D2 = make()
C2.s = staticmethod(lambda x=0: ('C2.s', x))
C2.m = lambda self, x=0: ('C2.m', x)
o = asked(C())
every('before', o, names=['s', 'm'])
o.__class__ = C2
every('after', o, names=['s', 'm'])
o.__class__ = C
every('back', o, names=['s', 'm'])
