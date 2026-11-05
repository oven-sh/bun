# A method that is called as an object (m = o.method; m(x)), and an object with a __call__: nothing but the callee holds the arguments.
import gc

print('--- an argument that the callee lets go of is gone')
import weakref


class Thing:
    pass


def gone(reference):
    gc.collect()
    return reference() is None


def lets_go(x):
    reference = weakref.ref(x)
    del x
    return gone(reference)


def lets_go_with_defaults(y, x, a=1, b=2, c=3, d=4, e=5):
    reference = weakref.ref(x)
    del x
    return gone(reference)


class Holder:
    def method(self, x):
        reference = weakref.ref(x)
        del x
        return gone(reference)

    def method_of_two(self, y, x):
        reference = weakref.ref(x)
        del x
        return gone(reference)

    def method_with_keyword(self, y, *, x):
        reference = weakref.ref(x)
        del x
        return gone(reference)


def at_thing(f): return f(Thing())


bound, bound_of_two, bound_with_keyword = Holder().method, Holder().method_of_two, Holder().method_with_keyword
for turn in range(3):
    print(lets_go(Thing()), lets_go_with_defaults(0, Thing()), bound(Thing()), bound_of_two(0, Thing()), bound_with_keyword(0, x=Thing()), Holder().method(Thing()),
          at_thing(lets_go), at_thing(bound))


print('--- every shape of parameters, with every number of arguments')
import sys
import functools


def outcome(f, *args, **kwargs):
    try:
        return f(*args, **kwargs)
    except Exception as e:
        return type(e).__name__, str(e)


class Shapes:
    def none(self): return ('none',)
    def one(self, a): return ('one', a)
    def three(self, a, b, c): return ('three', a, b, c)
    def defaults(self, a, b=2, c=3, d=4, e=5, f=6, g=7): return ('defaults', a, b, c, d, e, f, g)
    def rest(self, a, *rest): return ('rest', a, rest)
    def keywords(self, a=1, **keywords): return ('keywords', a, sorted(keywords.items()))
    def only(self, a, *, k=0, m): return ('only', a, k, m)
    def positional(self, a, /, b): return ('positional', a, b)
    def everything(*everything, **more): return ('everything', len(everything), everything[1:], sorted(more.items()))
    def no_self(): return ('no_self',)
    def generator(self, a, b=2):
        yield a
        yield b
    async def coroutine(self, a): return a
    def __repr__(self): return 'Shapes()'


names = [name for name in vars(Shapes) if not name.startswith('__')]
shapes = Shapes()
methods = [getattr(shapes, name) for name in names]


def call0(f): return f()
def call1(f): return f(1)
def call2(f): return f(1, 2)
def call3(f): return f(1, 2, 3)
def call9(f): return f(1, 2, 3, 4, 5, 6, 7, 8, 9)
def call_keyword(f): return f(1, m=2)
def call_keywords(f): return f(a=1, b=2)
def call_self_keyword(f): return f(self=1)
def call_spread(f): return f(*(1, 2))
def call_spread_both(f): return f(*[1], **{'m': 2})
def call_spread_none(f): return f(*(), **{})


def shown(result):
    if hasattr(result, 'close'):
        kind = type(result).__name__
        items = list(result) if kind == 'generator' else None
        result.close()
        return kind, items
    return result


for caller in (call0, call1, call2, call3, call9, call_keyword, call_keywords, call_self_keyword, call_spread, call_spread_both, call_spread_none):
    for turn in range(3):
        for method in methods:          # One site, many methods.
            result = shown(outcome(caller, method))
            if not turn:
                print(caller.__name__, method.__name__, result)


def one_method_at_a_site():
    m = shapes.defaults
    return [m(i) for i in range(5)] + [m(i, i) for i in range(5)] + [m(1, g=i) for i in range(5)]


print(one_method_at_a_site())

print('--- what a method can be bound to, and of what')
import re
import types


def function(*args): return args
def clean(value): return re.sub('0x[0-9a-f]+', 'ADDRESS', repr(value))


class Callable:
    def __call__(self, *args): return ('Callable', args)
    def __repr__(self): return 'Callable()'


for self in (0, 1.5, 'text', (), [], {}, int, function, Callable(), shapes.none):
    for of in (function, len, Callable(), shapes.everything, functools.partial(function, 'partial'), str, types.MethodType(function, 'inner')):
        method = types.MethodType(of, self)
        for turn in range(3):
            result = outcome(call0, method), outcome(call1, method)
        print(clean(self)[:30], getattr(of, '__name__', type(of).__name__), clean(result)[:150])


class Kinds:
    @classmethod
    def of_class(cls, a=0): return cls.__name__, a
    @staticmethod
    def static(a=0): return 'static', a
    @property
    def gives_function(self): return function
    @functools.cache
    def cached(self, a=0): return 'cached', a
    partial = functools.partialmethod(function, 'partialmethod')


class MoreKinds(Kinds):
    pass


for of in (Kinds(), MoreKinds(), Kinds, MoreKinds):
    for name in ('of_class', 'static', 'gives_function', 'cached', 'partial'):
        found = getattr(of, name)
        for turn in range(3):
            result = outcome(call0, found), outcome(call1, found)
        print(type(of).__name__, name, repr(result).replace(repr(of), 'OF')[:150])

print('--- objects with a __call__ of every kind')


class ByFunction:
    def __call__(self, a=0, *rest, **more): return 'ByFunction', a, rest, sorted(more)


class ByInherited(ByFunction):
    pass


class ByStatic:
    @staticmethod
    def __call__(a=0, *rest, **more): return 'ByStatic', a, rest, sorted(more)


class ByClassMethod:
    @classmethod
    def __call__(cls, a=0, *rest, **more): return 'ByClassMethod', cls.__name__, a, rest, sorted(more)


class ByObject:
    __call__ = ByFunction()


class ByNative:
    __call__ = len


class ByType:
    __call__ = list


class ByPartial:
    __call__ = functools.partial(function, 'partial')


class ByNone:
    __call__ = None


class ByLambda:
    __call__ = lambda *args: ('ByLambda', len(args))


class ByDescriptor:
    class Descriptor:
        def __get__(self, obj, cls): return lambda *args: ('ByDescriptor', obj is not None, cls.__name__, args)
    __call__ = Descriptor()


class ByGetattr:
    def __getattr__(self, name):
        if name == '__call__':
            return function
        raise AttributeError(name)


class WithSlots:
    __slots__ = ('x',)
    def __call__(self, a=0): return 'WithSlots', a


class OfInstance:
    pass


of_instance = OfInstance()
of_instance.__call__ = function


class Meta(type):
    def __call__(cls, *args): return 'Meta', cls.__name__, args


class WithMeta(metaclass=Meta):
    def __call__(self): return 'never'


class OfInt(int):
    def __call__(self, a=0): return 'OfInt', int(self), a


class OfDict(dict):
    def __call__(self, a=0): return 'OfDict', a


class OfException(Exception):
    def __call__(self, a=0): return 'OfException', a


objects = [ByFunction(), ByInherited(), ByStatic(), ByClassMethod(), ByObject(), ByNative(), ByType(), ByPartial(), ByNone(), ByLambda(), ByDescriptor(), ByGetattr(),
           WithSlots(), of_instance, WithMeta, OfInt(5), OfDict(), OfException()]
for caller in (call0, call1, call3, call_keyword, call_spread, call_spread_both):
    for turn in range(3):
        for obj in objects:
            result = outcome(caller, obj)
            if not turn:
                print(caller.__name__, getattr(obj, '__name__', type(obj).__name__), repr(result).replace(repr(obj), 'SELF')[:160])

print('--- a class that changes between the calls of one site')


class Changing:
    def __call__(self): return 'first'


class Other:
    def __call__(self): return 'of Other'


changing = Changing()


def site(): return changing()


results = [site(), site(), site()]
Changing.__call__ = lambda self: 'second'
results += [site(), site()]
Changing.__call__ = staticmethod(lambda: 'static')
results += [site(), site()]
Changing.__call__ = len
results += [outcome(site)]
Changing.__call__ = Other()
results += [outcome(site)]
del Changing.__call__
results += [outcome(site), outcome(site)]
Changing.__call__ = lambda self: 'again'
results += [site()]
changing.__class__ = Other
results += [site(), site()]
changing.__class__ = Changing
results += [site()]
Changing.__bases__ = (Other,)
del Changing.__call__
results += [site()]
print(results)

print('--- a function that changes between the calls of one site')


class Target:
    def method(self, a=1): return 'method', a


target = Target()
bound_method = target.method


def site(): return bound_method()


results = [site(), site(), site()]
Target.method.__defaults__ = (2,)
results += [site()]
Target.method.__code__ = (lambda self, a=0, b=5: ('other code', a, b)).__code__
results += [outcome(site)]
Target.method.__defaults__ = None
results += [outcome(site)]
Target.method.__kwdefaults__ = {'x': 1}
Target.method.attribute = 1
Target.method.__name__ = 'renamed'
Target.method.__qualname__ = 'Renamed.renamed'
results += [outcome(site)]
Target.method = None                     # The method has the function.
results += [outcome(site)]
print(results)

print('--- keys of a class dict that act while __call__ is looked for')
armed = False


def acting(action):
    # A class of its own each time, with bases of its own: CPython also looks __call__ up in the subclasses of a class that is given one.
    class Key:
        def __hash__(self): return hash('__call__')
        def __eq__(self, other):
            if armed:
                action(subject, Base, Sibling)
            return False

    class Base:
        def __call__(self, a=0): return 'Base', a

    class Sibling(Base):
        def __call__(self, a=0): return 'Sibling', a

    subject = type('Acting', (Base,), {Key(): 1})()
    return subject


def calls_of(subject):
    global armed
    armed = True
    try:
        return [outcome(subject, 7), type(subject).__name__, outcome(subject, 8), type(subject).__name__]
    finally:
        armed = False


def becomes_sibling(subject, Base, Sibling): subject.__class__ = Sibling


print(calls_of(acting(becomes_sibling)))
depth = 0


def gives_base_another(subject, Base, Sibling):
    global depth
    if depth:
        return
    depth += 1
    def fresh(self, a=0): return 'fresh', a
    Base.__call__ = fresh
    callable(subject)
    depth -= 1


print(calls_of(acting(gives_base_another)))


def collects(subject, Base, Sibling): gc.collect()


print(calls_of(acting(collects)))


def calls_it(subject, Base, Sibling):
    global depth
    if depth < 3:
        depth += 1
        subject(depth)
        depth -= 1


print(calls_of(acting(calls_it)))


# The name counts as not found then. (CPython: AttributeError, for it has made up its mind that the object can be called.)
def raises(subject, Base, Sibling): raise ValueError('from the key')


print([result[0] in ('TypeError', 'AttributeError') for result in calls_of(acting(raises))[::2]])

print('--- frames and tracebacks')
import traceback


class Framed:
    def method(self, depth):
        frame = sys._getframe()
        return [frame.f_code.co_name, frame.f_back.f_code.co_name, sorted(frame.f_locals), frame.f_back.f_lineno - frame.f_back.f_code.co_firstlineno]

    def __call__(self, depth):
        frame = sys._getframe()
        return [frame.f_code.co_name, frame.f_back.f_code.co_name, sorted(frame.f_locals), frame.f_back.f_lineno - frame.f_back.f_code.co_firstlineno]

    def fails(self, a, b=1):
        return a / 0


framed = Framed()


def calls(f):
    x = 1
    return f(x)


for turn in range(3):
    print(calls(framed.method), calls(framed))
for turn in range(3):
    try:
        calls(framed.fails)
    except ZeroDivisionError as e:
        print([(entry.name, entry.line) for entry in traceback.extract_tb(e.__traceback__)])
    try:
        calls(framed.none if hasattr(framed, 'none') else shapes.none)
    except TypeError as e:
        print([(entry.name, entry.line) for entry in traceback.extract_tb(e.__traceback__)], e)

print('--- recursion by way of methods and objects')


class Recursive:
    def __init__(self): self.again = self.method
    def method(self, n): return n if not n else self.again(n - 1) + 1
    def __call__(self, n): return n if not n else self(n - 1) + 1
    def forever(self, n):
        m = self.forever
        return m(n + 1)


recursive = Recursive()
print(recursive.method(500), recursive(500))
for turn in range(3):
    print(outcome(recursive.forever, 0)[0], outcome(Recursive.__call__, recursive, 10 ** 6)[0])

print('--- many arguments')
many = list(range(300))
print(shapes.everything(*many)[1], shapes.rest(*many)[2][-1], ByFunction()(*many)[2][-1], outcome(shapes.three, *many))


def with_many(f): return f(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33)


for turn in range(3):
    print(with_many(shapes.everything)[1:], with_many(shapes.rest)[2][-3:], with_many(ByFunction())[2][-3:], with_many(function)[-3:])

print('--- threads')
import threading
totals = []


def work():
    m, o = shapes.defaults, ByFunction()
    total = 0
    for i in range(20000):
        total += m(i)[1] + o(i)[1]
    totals.append(total)


threads = [threading.Thread(target=work) for i in range(4)]
for thread in threads: thread.start()
for thread in threads: thread.join()
print(totals)
