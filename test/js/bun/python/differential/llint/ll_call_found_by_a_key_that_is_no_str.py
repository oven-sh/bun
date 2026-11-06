# The only __call__ of a class lies under a key of its dict that is no str and says that it equals the name.
import functools
import warnings

warnings.simplefilter('ignore')


class Key:
    def __init__(self, text):
        self.text = text

    def __hash__(self):
        return hash(self.text)

    def __eq__(self, other):
        return self.text == other


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


def plain(self, *args, **kw):
    return ('plain', type(self).__name__, [a if type(a) is str else type(a).__name__ for a in args], kw)


class Callable:
    def __call__(self, *args, **kw):
        return ('an object', args, kw)


class Holder:
    def method(self, *args, **kw):
        return ('a bound method', args, kw)


calls = {
    'function': plain,
    'lambda': lambda self, *args: ('lambda', args),
    'len': len,
    'staticmethod': staticmethod(lambda *args: ('static', args)),
    'classmethod': classmethod(lambda cls, *args: ('class', cls.__name__, args)),
    'bound method': Holder().method,
    'partial': functools.partial(plain, 'first'),
    'object': Callable(),
    'type': list,
    'native method': str.upper,
    'not callable': 5,
    'None': None,
}
bases = {'object': (), 'dict': (dict,), 'int': (int,), 'tuple': (tuple,), 'list': (list,), 'str': (str,), 'Exception': (Exception,)}


def direct(o):
    return o('ab')


def spread(o):
    return o(*['ab'])


def keywords(o):
    return o('ab', k=1)


def none(o):
    return o()


for base_name, base in bases.items():
    for name, call in calls.items():
        cls = type('X', base, {Key('__call__'): call})
        for turn in range(2):
            o = cls()
            label = '%s %s %d' % (base_name, name, turn)
            show(label, direct, o)
            show(label, spread, o)
            show(label, keywords, o)
            show(label, none, o)
            show(label, callable, o)
            show(label, lambda: list(map(o, ['cd'])))
            show(label, lambda: type(type(o).__call__).__name__)

print('--- derived, and beside a __call__ under its name')
Base = type('Base', (), {Key('__call__'): plain})


class Derived(Base):
    pass


class Overrides(Base):
    def __call__(self):
        return 'Overrides'


Both = type('Both', (), {Key('__call__'): plain, '__call__': lambda self: 'by the name'})
for cls in (Base, Derived, Overrides, Both):
    for turn in range(2):
        show(cls.__name__, none, cls())
        show(cls.__name__, callable, cls())
