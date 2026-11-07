import datetime


class P:
    def __init__(self, *a):
        self.a = a


class PN:
    def __new__(cls, *a):
        return object.__new__(cls)


class SubDict(dict):
    pass


class SubDate(datetime.date):
    pass


def tell(o):
    text = 'a ' + type(o).__name__ if type(o).__repr__ is object.__repr__ else repr(o)
    return '%s %s' % ('>'.join(c.__name__ for c in type(o).__mro__), text)


def call(c, *a):
    try:
        return tell(c(*a))
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def new(t, c, *a):
    try:
        return tell(t.__new__(c, *a))
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def setnew(c, f):
    c.__new__ = f


def delnew(c):
    del c.__new__


def pynew(cls, *a):
    return 'made by a function of Python for ' + cls.__name__


class TzDict(datetime.tzinfo, dict):
    pass


class ValueOS(ValueError, OSError):
    pass


class ObjectsNew(dict):
    __new__ = object.__new__


class MixNew:
    def __new__(cls, *a, **k):
        return super().__new__(cls, *a, **k)


class MixDict(MixNew, dict):
    pass


class TzInt(datetime.tzinfo, int):
    pass


class Group(ValueError, ExceptionGroup):
    pass


class Plain:
    pass


class PlainInit:
    def __init__(self, *a):
        self.a = a


def make(name, *bases):
    try:
        return type(name, bases, {})
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class LeavesOut(type):
    def mro(cls):
        mro = type.mro(cls)
        return mro[:1] + mro[2:]


class X(Plain, metaclass=LeavesOut):
    pass


class XE(ValueError, metaclass=LeavesOut):
    pass


class XD(dict, metaclass=LeavesOut):
    pass


class DictNew(dict):
    calls = 0

    def __new__(cls, *a):
        DictNew.calls += 1
        return super().__new__(cls)


class OSNew(OSError):
    calls = 0

    def __new__(cls, *a):
        OSNew.calls += 1
        return super().__new__(cls, *a)


class MixedNew(PN, dict):
    pass


def withnew(name, *bases):
    def __new__(cls, *a):
        return super(W, cls).__new__(cls, *a)
    W = type(name, bases, {'__new__': __new__})
    return W


def gives(value):
    class Gives:
        def __new__(cls, *a):
            return value
    return Gives


GIVEN = {'5': 5, 'None': None, 'True': True, '1.5': 1.5, "'x'": 'x', '10 ** 30': 10 ** 30, '[]': [], 'object()': object(), 'int': int}
