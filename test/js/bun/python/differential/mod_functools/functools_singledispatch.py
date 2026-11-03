# functools.singledispatch, with the classes given to register()
from functools import singledispatch, singledispatchmethod
import collections.abc


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


@singledispatch
def show(x, *rest):
    "show doc"
    return 'object', x


@show.register(int)
def show_int(x):
    return 'int', x


@show.register(str)
def _(x):
    return 'str', x


@show.register(list)
@show.register(tuple)
def _(x):
    return 'sequence', x


t(lambda: [show(v) for v in (1, 'a', 1.5, [1], (2,), True, None)])
t(lambda: show.dispatch(bool)(True))
t(lambda: show.dispatch(bool) is show_int)
t(lambda: sorted(c.__name__ for c in show.registry))
t(lambda: type(show.registry).__name__)
t(lambda: show())
t(lambda: (show.__name__, show.__doc__))
t(lambda: show_int(5))
t(lambda: show.register(float, lambda x: ('float', x))(1.5))
t(lambda: show(1.5))


@show.register(collections.abc.Mapping)
def _(x):
    return 'mapping', sorted(x)


@show.register(collections.abc.Sized)
def _(x):
    return 'sized', len(x)


t(lambda: show({2: 1, 1: 2}))
t(lambda: show({1, 2}))
t(lambda: show(b'abc'))
t(lambda: show(range(3)))


class Base:
    pass


class Derived(Base):
    pass


class Other(Derived):
    pass


show.register(Base, lambda x: ('base', type(x).__name__))
t(lambda: [show(c()) for c in (Base, Derived, Other)])
show.register(Derived, lambda x: ('derived', type(x).__name__))
t(lambda: [show(c()) for c in (Base, Derived, Other)])
t(lambda: show.register(1, lambda x: x))
t(lambda: show.register('a'))
show._clear_cache()
t(lambda: show(1))


class Dispatcher:
    @singledispatchmethod
    def m(self, x):
        "m doc"
        return 'default', x

    @m.register(int)
    def _(self, x):
        return 'int', x

    @m.register(str)
    def _(self, x):
        return 'str', x

    @singledispatchmethod
    @classmethod
    def c(cls, x):
        return cls.__name__, 'default', x

    @c.register(int)
    @classmethod
    def _(cls, x):
        return cls.__name__, 'int', x


t(lambda: [Dispatcher().m(v) for v in (1, 'a', None)])
t(lambda: [Dispatcher.c(v) for v in (1, 'a')])
t(lambda: Dispatcher().m.__doc__)
t(lambda: Dispatcher().m())
