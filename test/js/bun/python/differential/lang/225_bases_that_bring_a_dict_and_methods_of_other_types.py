# What a class may be given for its bases, and a built-in type that can be written to for its __new__ and __init__, where the instances are laid
# out in another way than the newcomer takes them to be.
import _io
import io
import os
import re
import struct
import sys
import time
import weakref


def show(label, function):
    try:
        result = function()
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


print('--- __bases__')
# (Where _IOBase is accepted, the instance cannot be closed when it goes.)
sys.unraisablehook = lambda unraisable: None


def classes(slots_of_c=()):
    class A:
        __slots__ = ()

    class C(A):
        __slots__ = slots_of_c

    return A, C


# CPython refuses the first three, the __dict__ being part of the layout of _IOBase there. Refused or not, there is no __dict__.
for name, base in (('_IOBase', _io._IOBase), ('RawIOBase', io.RawIOBase), ('IOBase', io.IOBase), ('BytesIO', io.BytesIO)):
    A, C = classes()
    try:
        C.__bases__ = (A, base)
    except TypeError:
        pass
    c = C()
    for label, function in (('__dict__', lambda: type(c.__dict__)), ('getattr', lambda: getattr(c, '__dict__')), ('in a tuple', lambda: (c.__dict__, 1)), ('set', lambda: setattr(c, 'x', 1)), ('weakref', lambda: weakref.ref(c))):
        try:
            function()
            print(name, label, 'returned')
        except Exception as error:
            print(name, label, type(error).__name__)

try:
    class T(_io._IOBase, type):
        pass

    T('n', (), {}).__dict__['x']
except (TypeError, AttributeError, KeyError):
    pass
print('a class of classes is over')


class AE(Exception):
    __slots__ = ()


class CE(AE):
    __slots__ = ()


show('an exception of a module', lambda: setattr(CE, '__bases__', (AE, struct.error)))
show('an exception of a module, mro', lambda: [c.__name__ for c in CE.__mro__])
show('an exception of a module, made', lambda: isinstance(CE(), struct.error))

# By way of a class in between, which has all that _IOBase wants.
A, C = classes()


class X0:
    __slots__ = ('__dict__', '__weakref__')


class X(X0):
    __slots__ = ()


show('a class in between', lambda: setattr(C, '__bases__', (A, X)))
try:
    X.__bases__ = (_io._IOBase,)
except TypeError:
    pass
c = C()
for label, function in (('type', lambda: type(c.__dict__)), ('len', lambda: len(c.__dict__)), ('vars', lambda: vars(c)), ('tuple', lambda: (c.__dict__, 1))):
    try:
        function()
        print('in between', label, 'returned')
    except (AttributeError, TypeError):
        print('in between', label, 'raised')

print('--- __init__ of another type')
for name, init in (('dict', dict.__init__), ('list', list.__init__), ('BaseException', BaseException.__init__), ('set', set.__init__)):
    os.terminal_size.__init__ = init
    show(name, lambda: os.terminal_size(((1, 2), (3, 4))))
    show(name + ', two ints', lambda: os.terminal_size((1, 2)))
    del os.terminal_size.__init__
show('as it was', lambda: os.terminal_size((1, 2)))
os.terminal_size.__init__ = tuple.__init__
show('of tuple', lambda: os.terminal_size((1, 2)))
del os.terminal_size.__init__

print('--- __new__ of another type: whatever is made or raised, it does no harm')
before = os.terminal_size.__dict__['__new__']
for name, new in (('dict', dict.__new__), ('list', list.__new__), ('set', set.__new__), ('int', int.__new__), ('BaseException', BaseException.__new__), ('stat_result', os.stat_result.__new__), ('struct_time', time.struct_time.__new__)):
    os.terminal_size.__new__ = new
    for arguments in ((), ((1, 2),), (range(10),)):
        try:
            x = os.terminal_size(*arguments)
            repr(x), hash(x), len(x), x.columns, x.lines, x == x, list(x), x.__reduce__()
        except Exception:
            pass
    print(name, 'is over')
os.terminal_size.__new__ = before
show('as it was', lambda: os.terminal_size((1, 2)))

print('--- and a class derived from the built-in type that was written to')
before = struct.error.__dict__.get('__new__')
for name, new in (('int', int.__new__), ('dict', dict.__new__), ('tuple', tuple.__new__), ('list', list.__new__), ('object', object.__new__), ('BaseException', BaseException.__new__)):
    struct.error.__new__ = new

    class Derived(struct.error):
        pass

    for arguments in ((), (1,), ((1, 2),)):
        try:
            x = Derived(*arguments)
            repr(x), str(x), x.args, x.__reduce__(), x.with_traceback(None)
            try:
                raise x
            except BaseException:
                pass
        except Exception:
            pass
    print(name, 'is over')
if before is None:
    del struct.error.__new__
else:
    struct.error.__new__ = before
show('as it was', lambda: Derived(1).args)

print('--- types whose instances have nothing in them, named by an mro()')
import contextvars
import functools
import types
import typing

for named in (types.NoneType, types.NotImplementedType, types.EllipsisType, type(functools.Placeholder), type(typing.NoDefault), type(contextvars.Token.MISSING)):
    class Names(type):
        def mro(cls):
            return [cls, named, object]

    show(named.__name__, lambda: [c.__name__ for c in Names('C', (), {}).__mro__])
    show(named.__name__ + ' repr', lambda: repr(Names('C', (), {'__new__': object.__new__})()))
for value in (None, NotImplemented, Ellipsis, functools.Placeholder, typing.NoDefault, contextvars.Token.MISSING):
    for protocol in (0, 2, 4):
        show('%r reduced %d' % (value, protocol), lambda: re.sub(' at 0x[0-9a-f]+', '', repr(value.__reduce_ex__(protocol))))
