# __name__ and __qualname__ of a function set to an instance of a class derived from str: messages and repr() go by them.
class StrSub(str):
    pass


def show(tag, f):
    try:
        print(tag, '=', f())
    except Exception as e:
        print(tag, '!', type(e).__name__, e)


def free(v):
    def inner():
        return v
    return inner


def f(a):
    pass


f.__qualname__ = StrSub('qual')
f.__name__ = StrSub('name')
show('read', lambda: (f.__name__, f.__qualname__, type(f.__name__).__name__, type(f.__qualname__).__name__))
show('call', lambda: f())
show('keyword', lambda: f(1, z=2))
show('too many', lambda: f(1, 2))
show('twice', lambda: f(1, a=2))
show('repr', lambda: repr(f).split(' at ')[0])
show('code', lambda: setattr(f, '__code__', free(1).__code__))
show('bound', lambda: repr(f.__get__(5)).split(' of ')[0])


class Odd(str):
    def __str__(self):
        return 'str of it'

    def __repr__(self):
        return 'repr of it'

    def __format__(self, spec):
        return 'format of it'


f.__qualname__ = Odd('odd')
show('call', lambda: f())
show('repr', lambda: repr(f).split(' at ')[0])


def g():
    yield


g.__qualname__ = StrSub('gen')
show('generator', lambda: (repr(g()).split(' at ')[0], type(g().__qualname__).__name__))
