# functools.singledispatch, with the class taken from the annotation. (Needs typing.get_type_hints.)
from functools import singledispatch, singledispatchmethod


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


@singledispatch
def show(x):
    return 'object', x


@show.register
def _(x: int):
    return 'int', x


@show.register
def _(x: str | bytes):
    return 'text', x


t(lambda: [show(v) for v in (1, 'a', b'b', 1.5, True)])


def no_annotation():
    @show.register
    def _(x):
        return x


try:
    no_annotation()
except TypeError as e:
    print('TypeError', str(e)[:40])


class Dispatcher:
    @singledispatchmethod
    def m(self, x):
        return 'default', x

    @m.register
    def _(self, x: int):
        return 'int', x


t(lambda: [Dispatcher().m(v) for v in (1, 'a')])
