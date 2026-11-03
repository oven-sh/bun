# _functools.partial and Placeholder
import _functools
from _functools import partial, Placeholder as _


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def capture(*args, **kw):
    return args, kw


def sig(p):
    return p.func is capture, p.args, p.keywords, p.__dict__


print('--- basics')
t(lambda: partial(capture)())
t(lambda: partial(capture, 1, 2)())
t(lambda: partial(capture, 1, 2)(3, 4))
t(lambda: partial(capture, a=1)())
t(lambda: partial(capture, a=1)(b=2))
t(lambda: partial(capture, a=1)(a=2))
t(lambda: partial(capture, a=1, b=2)(b=3, c=4))
t(lambda: partial(capture, 1, a=2)(3, b=4))
t(lambda: partial(capture, *range(20))(*range(3)))
t(lambda: partial(capture, **{'k%d' % i: i for i in range(12)})(z=1))
t(lambda: partial(int, base=2)('101'))
t(lambda: partial(pow, 2)(10))
t(lambda: partial(max, 5)(3, 9))
t(lambda: partial(sorted, reverse=True)([1, 3, 2]))
t(lambda: partial(str.upper)('abc'))
t(lambda: partial('{} {}'.format, 'a')('b'))
t(lambda: list(map(partial(pow, 2), range(5))))
t(lambda: partial(partial, capture)(1)(2))
t(lambda: partial(lambda: 1)(1))
t(lambda: partial(capture)(**{'a': 1}))
t(lambda: partial(capture, func=1, self=2)())
t(lambda: callable(partial(capture)))

print('--- attributes')
p = partial(capture, 1, 2, a=10, b=20)
t(lambda: (p.func is capture, p.args, p.keywords))
t(lambda: (type(p.args).__name__, type(p.keywords).__name__))
t(lambda: partial(capture).args)
t(lambda: partial(capture).keywords)
t(lambda: p.__dict__)
for name in ('func', 'args', 'keywords'):
    def set_():
        setattr(p, name, 1)

    def del_():
        delattr(p, name)

    t(set_)
    t(del_)
p.extra = 'x'
t(lambda: (p.extra, p.__dict__))
del p.extra
t(lambda: p.__dict__)
t(lambda: p.missing)


def set_dict():
    q = partial(capture)
    q.__dict__ = {'z': 1}
    return q.z, q.__dict__


t(set_dict)


def bad_dict():
    partial(capture).__dict__ = 1


t(bad_dict)


def del_dict():
    del partial(capture).__dict__


t(del_dict)
# The keywords are the partial's own, and are looked at for every call.
kw = {'a': 1}
p = partial(capture, **kw)
kw['a'] = 2
t(lambda: p())
p.keywords['a'] = 3
p.keywords['b'] = 4
t(lambda: p())

print('--- errors')
t(lambda: partial())
t(lambda: partial(1))
t(lambda: partial(None))
t(lambda: partial('a', 1))
t(lambda: partial(func=capture))
t(lambda: partial(a=1))
t(lambda: partial(capture, 1)(**{1: 2}))

print('--- repr')
t(lambda: partial(int))
t(lambda: partial(int, 1))
t(lambda: partial(int, 1, 'a'))
t(lambda: partial(int, base=2))
t(lambda: partial(int, 1, base=2, x=[1]))
t(lambda: partial(partial(int, 1), 2))
t(lambda: str(partial(int, 1)))
t(lambda: partial(int, _, 1))
p = partial(int)
p.__setstate__((p, (), {}, {}))
t(lambda: p)
p = partial(int)
p.__setstate__((int, (p,), {}, {}))
t(lambda: p)
p = partial(int)
p.__setstate__((int, (), {'a': p}, {}))
t(lambda: p)
p = partial(int)
p.__setstate__((int, (), {1: 2, None: 3}, {}))
t(lambda: p)


class BadRepr:
    def __repr__(self):
        raise RuntimeError('bad repr')


t(lambda: repr(partial(int, BadRepr())))
t(lambda: repr(partial(int, a=BadRepr())))
t(lambda: repr(partial(BadRepr)))

print('--- nesting')
p = partial(capture, 1, a=1)
q = partial(p, 2, b=2)
t(lambda: (q.func is capture, q.args, q.keywords, q(3, c=3)))
q = partial(p, a=5)
t(lambda: (q.keywords, p.keywords, q()))
# One with attributes of its own is left alone.
p = partial(capture, 1)
p.attr = 1
q = partial(p, 2)
t(lambda: (q.func is p, q.args, q(3)))
p = partial(capture, 1)
p.__dict__
q = partial(p, 2)
t(lambda: (q.func is p, q.args))

print('--- subclasses')


class Sub(partial):
    pass


s = Sub(capture, 1, a=2)
t(lambda: (type(s) is Sub, isinstance(s, partial), s(3), s.__dict__))
t(lambda: Sub(int, 1))
t(lambda: (type(Sub(partial(capture, 1), 2)).__name__, Sub(partial(capture, 1), 2).args))
t(lambda: (type(partial(Sub(capture, 1), 2)).__name__, partial(Sub(capture, 1), 2).args))
t(lambda: Sub())
t(lambda: Sub(1))


class WithCall(partial):
    def __call__(self, *a, **k):
        return 'sub', super().__call__(*a, **k)


t(lambda: WithCall(capture, 1)(2))
# Flattened all the same.
t(lambda: partial(WithCall(capture, 1), 2)(3))


class WithSlots(partial):
    __slots__ = ('x',)


w = WithSlots(capture)
w.x = 1
w.y = 2
t(lambda: (w.x, w.__dict__))


class WithInit(partial):
    def __init__(self, *a, **k):
        self.seen = (a[1:], k)


t(lambda: WithInit(capture, 1, z=2).seen)
t(lambda: partial(WithInit(capture, 1), 2).func is capture)

print('--- as a method')


class A:
    plain = partial(capture, 'p')
    static = staticmethod(partial(capture, 's'))
    cls = classmethod(partial(capture, 'c'))

    def __repr__(self):
        return 'A()'


a = A()
t(lambda: a.plain(1))
t(lambda: A.plain(1))
t(lambda: a.static(1))
t(lambda: A.static(1))
t(lambda: a.cls(1)[0][1] is A)
t(lambda: type(a.plain).__name__)
t(lambda: a.plain.__self__)
t(lambda: a.plain.__func__ is A.__dict__['plain'])
t(lambda: A.plain is A.__dict__['plain'])
p = partial(capture, 1)
t(lambda: p.__get__(None, A) is p)
t(lambda: p.__get__(a)(2))
t(lambda: p.__get__(a, A)(2))
t(lambda: p.__get__(None))
t(lambda: p.__get__(None, None))
t(lambda: p.__get__())
t(lambda: p.__get__(1, 2, 3))


class B:
    m = partial(capture, _, 'second')

    def __repr__(self):
        return 'B()'


t(lambda: B().m())
t(lambda: B().m(3))

print('--- Placeholder')
t(lambda: _)
t(lambda: str(_))
t(lambda: type(_).__name__)
t(lambda: type(_).__module__)
t(lambda: type(_) is _functools._PlaceholderType)
t(lambda: type(_)() is _)
t(lambda: type(_)(1))
t(lambda: type(_)(a=1))
t(lambda: _.__reduce__())
t(lambda: bool(_))
t(lambda: _ == _)
t(lambda: hash(_) == hash(_))


def sub_placeholder():
    class X(type(_)):
        pass


t(sub_placeholder)


def set_placeholder():
    _.x = 1


t(lambda: hasattr(_, '__dict__'))
t(lambda: partial(capture, _, 2)(1))
t(lambda: partial(capture, _, 2)(1, 3))
t(lambda: partial(capture, _, 2, _, 4)(1, 3))
t(lambda: partial(capture, _, 2, _, 4)(1, 3, 5, 6))
t(lambda: partial(capture, _, _, 3)(1, 2))
t(lambda: partial(capture, _, 2, a=1)(1, b=2))
t(lambda: partial(capture, _, 2)())
t(lambda: partial(capture, _, _, 3)(1))
t(lambda: partial(capture, _, _, 3)())
t(lambda: partial(capture, _, 2)(a=1))
t(lambda: partial(capture, _))
t(lambda: partial(capture, 1, _))
t(lambda: partial(capture, _, _))
t(lambda: partial(capture, a=_))
t(lambda: partial(capture, 1, a=1, b=_))
t(lambda: partial(capture, _, 1).args)
t(lambda: partial(capture, 1)(_))
t(lambda: partial(capture, 1)(a=_))
t(lambda: partial(str.replace, _, 'a', 'b')('banana'))
t(lambda: partial(pow, _, 2)(5))
t(lambda: partial(pow, _, 2, _)(5, 7) if False else partial(pow, _, 2, 7)(5))

print('--- Placeholder and nesting')
p = partial(capture, _, 2, _, 4)
t(lambda: partial(p, 1).args)
t(lambda: partial(p, 1)(3))
t(lambda: partial(p, 1)())
t(lambda: partial(p, 1, 3).args)
t(lambda: partial(p, 1, 3)())
t(lambda: partial(p, 1, 3, 5).args)
t(lambda: partial(p, _, 3).args)
t(lambda: partial(p, _, 3)(1))
t(lambda: partial(p, _, 3)())
t(lambda: partial(p, _, _, 5).args)
t(lambda: partial(p, _, _, 5)(1, 3))
t(lambda: partial(p, _, _, 5)(1))
t(lambda: partial(p, 1, _))
t(lambda: partial(p).args)
t(lambda: partial(p)(1, 3))
t(lambda: partial(p)(1))
t(lambda: partial(p, a=1).args)
t(lambda: partial(partial(capture, 1), _, 3).args)
t(lambda: partial(partial(capture, 1), _, 3)(2))
t(lambda: partial(partial(p, 1), 3)())
t(lambda: partial(partial(p, _, 3), 1)(5))

print('--- pickling support')
p = partial(capture, 1, 2, a=3)
t(lambda: (p.__reduce__()[0] is partial, p.__reduce__()[1] == (capture,), p.__reduce__()[2][1:]))
p.x = 1
t(lambda: p.__reduce__()[2][1:])
t(lambda: Sub(capture).__reduce__()[0] is Sub)
t(lambda: p.__reduce__(1))
p = partial(capture)
t(lambda: p.__setstate__((capture, (1,), {'a': 10}, {'attr': []})))
t(lambda: sig(p))
t(lambda: p(2, b=20))
t(lambda: p.__setstate__((capture, (1,), {'a': 10}, None)))
t(lambda: p.__reduce__()[2][1:])
t(lambda: sig(p))
t(lambda: p.__setstate__((capture, (1,), None, None)))
t(lambda: sig(p))
t(lambda: p(2))
t(lambda: p.__setstate__((capture, (), {}, None)))
t(lambda: sig(p))
t(lambda: p.__setstate__((capture, (_, 2), {}, None)))
t(lambda: (p(1), p.args))
t(lambda: p())
for state in ((), (capture,), (capture, ()), (capture, (), {}), (capture, (), {}, {}, None), [capture, (), {}, None], None, 1, 'abcd',
              (None, (), {}, None), (capture, None, {}, None), (capture, [], {}, None), (capture, (), [], None), (capture, (), {}, []),
              (capture, (), 1, None), (capture, (), {}, 1), (capture, (_,), {}, None), (capture, (1, _), {}, None)):
    t(lambda: p.__setstate__(state))
t(lambda: (p(1), p.args))
t(lambda: p.__setstate__())
t(lambda: p.__setstate__(1, 2))


class MyTuple(tuple):
    pass


class MyDict(dict):
    pass


p = partial(capture)
p.__setstate__((capture, MyTuple((1,)), MyDict(a=10), None))
t(lambda: (type(p.args).__name__, type(p.keywords).__name__, p(2)))
p.__setstate__(MyTuple((capture, (1,), {}, MyDict(z=1))))
t(lambda: (p.z, type(p.__dict__).__name__))
args = (1, 2)
kw = {'a': 1}
d = {'x': 1}
p.__setstate__((capture, args, kw, d))
t(lambda: (p.args is args, p.keywords is kw, p.__dict__ is d))

print('--- the type')
t(lambda: (partial.__name__, partial.__qualname__, partial.__module__, repr(partial)))
t(lambda: partial.__mro__ == (partial, object))
t(lambda: partial[int])
t(lambda: partial[int].__origin__ is partial)
t(lambda: partial[int, str].__args__)
t(lambda: sorted(k for k in vars(partial) if k not in ('__doc__', '__module__', '__getattribute__', '__setattr__', '__delattr__', '__vectorcalloffset__')))
t(lambda: hash(partial(capture)) is not None)
p = partial(capture)
t(lambda: (p == p, p == partial(capture), p != partial(capture)))
t(lambda: partial.__call__(partial(capture, 1), 2))
t(lambda: partial.__new__(partial, capture, 1)(2))
t(lambda: partial.__new__(Sub, capture, 1)(2))
t(lambda: partial.__new__(partial))
t(lambda: partial.__doc__)

print('--- what is called may do anything')


def mutate(*a, **k):
    p.__setstate__((capture, ('changed',), {}, None))
    return a, k


p = partial(mutate, 1, a=2)
t(lambda: p(3))
t(lambda: p(3))


def raises(*a):
    raise KeyError(a)


t(lambda: partial(raises, 1)(2))


def deep(n):
    f = capture
    for i in range(n):
        f = partial(f, i)
    return f


t(lambda: deep(50)()[0][-3:])
t(lambda: deep(50).func is capture)
