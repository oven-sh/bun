# What a class may be given for its bases, and a built-in type that can be written to for its __new__ and __init__, where the instances are laid
# out in another way than the newcomer takes them to be.
try: import _io
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import _io')
try: import io
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import io')
try: import os
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os')
try: import re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import re')
try: import struct
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import struct')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import time
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import time')
try: import weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import weakref')


try:
    def show(label, function):
        try:
            result = function()
        except Exception as error:
            result = (type(error).__name__, str(error))
        print(label, result)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, function):')


try: print('--- __bases__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- __bases__'")
# (Where _IOBase is accepted, the instance cannot be closed when it goes.)
try: sys.unraisablehook = lambda unraisable: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = lambda unraisable: None')


try:
    def classes(slots_of_c=()):
        class A:
            __slots__ = ()

        class C(A):
            __slots__ = slots_of_c

        return A, C
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def classes(slots_of_c=()):')


# CPython refuses the first three, the __dict__ being part of the layout of _IOBase there. Refused or not, there is no __dict__.
try:
    for name, base in (('_IOBase', _io._IOBase), ('RawIOBase', io.RawIOBase), ('IOBase', io.IOBase), ('BytesIO', io.BytesIO)):
        try: A, C = classes()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A, C = classes()')
        try:
            C.__bases__ = (A, base)
        except TypeError:
            pass
        try: c = C()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
        for label, function in (('__dict__', lambda: type(c.__dict__)), ('getattr', lambda: getattr(c, '__dict__')), ('in a tuple', lambda: (c.__dict__, 1)), ('set', lambda: setattr(c, 'x', 1)), ('weakref', lambda: weakref.ref(c))):
            try:
                function()
                print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', name)
                print('label [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', label)
                print('returned')
            except Exception as error:
                print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', name)
                print('label [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', label)
                print('type(error).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', type(error).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, base in (('_IOBase', _io._IOBase), ('RawIOBase', io.RawIOBa...")

try:
    try:
        class T(_io._IOBase, type):
            pass

        T('n', (), {}).__dict__['x']
    except (TypeError, AttributeError, KeyError):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print('a class of classes is over')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'a class of classes is over'")


try:
    class AE(Exception):
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AE(Exception):')


try:
    class CE(AE):
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CE(AE):')


try: show('an exception of a module', lambda: setattr(CE, '__bases__', (AE, struct.error)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an exception of a module', lambda: setattr(CE, '__bases__', (AE...")
try: show('an exception of a module, mro', lambda: [c.__name__ for c in CE.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an exception of a module, mro', lambda: [c.__name__ for c in CE...")
try: show('an exception of a module, made', lambda: isinstance(CE(), struct.error))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an exception of a module, made', lambda: isinstance(CE(), struc...")

# By way of a class in between, which has all that _IOBase wants.
try: A, C = classes()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A, C = classes()')


try:
    class X0:
        __slots__ = ('__dict__', '__weakref__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X0:')


try:
    class X(X0):
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X(X0):')


try: show('a class in between', lambda: setattr(C, '__bases__', (A, X)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a class in between', lambda: setattr(C, '__bases__', (A, X)))")
try:
    try:
        X.__bases__ = (_io._IOBase,)
    except TypeError:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try:
    for label, function in (('type', lambda: type(c.__dict__)), ('len', lambda: len(c.__dict__)), ('vars', lambda: vars(c)), ('tuple', lambda: (c.__dict__, 1))):
        try:
            function()
            print('in between', 'label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', label)
            print('returned')
        except (AttributeError, TypeError):
            print('in between', 'label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', label)
            print('raised')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, function in (('type', lambda: type(c.__dict__)), ('len', l...")

try: print('--- __init__ of another type')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- __init__ of another type'")
try:
    for name, init in (('dict', dict.__init__), ('list', list.__init__), ('BaseException', BaseException.__init__), ('set', set.__init__)):
        try: os.terminal_size.__init__ = init
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__init__ = init')
        try: show(name, lambda: os.terminal_size(((1, 2), (3, 4))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, lambda: os.terminal_size(((1, 2), (3, 4))))')
        try: show(name + ', two ints', lambda: os.terminal_size((1, 2)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(name + ', two ints', lambda: os.terminal_size((1, 2)))")
        try: del os.terminal_size.__init__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del os.terminal_size.__init__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, init in (('dict', dict.__init__), ('list', list.__init__), ...")
try: show('as it was', lambda: os.terminal_size((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('as it was', lambda: os.terminal_size((1, 2)))")
try: os.terminal_size.__init__ = tuple.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__init__ = tuple.__init__')
try: show('of tuple', lambda: os.terminal_size((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('of tuple', lambda: os.terminal_size((1, 2)))")
try: del os.terminal_size.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del os.terminal_size.__init__')

try: print('--- __new__ of another type: whatever is made or raised, it does no harm')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- __new__ of another type: whatever is made or raised, it does no ...")
try: before = os.terminal_size.__dict__['__new__']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: before = os.terminal_size.__dict__['__new__']")
try:
    for name, new in (('dict', dict.__new__), ('list', list.__new__), ('set', set.__new__), ('int', int.__new__), ('BaseException', BaseException.__new__), ('stat_result', os.stat_result.__new__), ('struct_time', time.struct_time.__new__)):
        try: os.terminal_size.__new__ = new
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = new')
        for arguments in ((), ((1, 2),), (range(10),)):
            try:
                x = os.terminal_size(*arguments)
                repr(x), hash(x), len(x), x.columns, x.lines, x == x, list(x), x.__reduce__()
            except Exception:
                pass
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'new=' + (repr(new) if type(new) in (str, int, float, bytes, bool, type(None)) or (type(new) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in new)) else new.__name__ if type(new) is type else type(new).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('is over')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'is over'")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, new in (('dict', dict.__new__), ('list', list.__new__), ('s...")
try: os.terminal_size.__new__ = before
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = before')
try: show('as it was', lambda: os.terminal_size((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('as it was', lambda: os.terminal_size((1, 2)))")

try: print('--- and a class derived from the built-in type that was written to')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- and a class derived from the built-in type that was written to'")
try: before = struct.error.__dict__.get('__new__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: before = struct.error.__dict__.get('__new__')")
try:
    for name, new in (('int', int.__new__), ('dict', dict.__new__), ('tuple', tuple.__new__), ('list', list.__new__), ('object', object.__new__), ('BaseException', BaseException.__new__)):
        try: struct.error.__new__ = new
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = new')

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
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'new=' + (repr(new) if type(new) in (str, int, float, bytes, bool, type(None)) or (type(new) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in new)) else new.__name__ if type(new) is type else type(new).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('is over')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'is over'")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, new in (('int', int.__new__), ('dict', dict.__new__), ('tup...")
try:
    if before is None:
        try: del struct.error.__new__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del struct.error.__new__')
    else:
        try: struct.error.__new__ = before
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = before')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if before is None:')
try: show('as it was', lambda: Derived(1).args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('as it was', lambda: Derived(1).args)")

try: print('--- types whose instances have nothing in them, named by an mro()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- types whose instances have nothing in them, named by an mro()'")
try: import contextvars
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import contextvars')
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')
try: import typing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import typing')

try:
    for named in (types.NoneType, types.NotImplementedType, types.EllipsisType, type(functools.Placeholder), type(typing.NoDefault), type(contextvars.Token.MISSING)):
        class Names(type):
            def mro(cls):
                return [cls, named, object]

        try: show(named.__name__, lambda: [c.__name__ for c in Names('C', (), {}).__mro__])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(named.__name__, lambda: [c.__name__ for c in Names('C', (), {})....")
        try: show(named.__name__ + ' repr', lambda: repr(Names('C', (), {'__new__': object.__new__})()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(named.__name__ + ' repr', lambda: repr(Names('C', (), {'__new__'...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for named in (types.NoneType, types.NotImplementedType, types.Ellipsi...')
try:
    for value in (None, NotImplemented, Ellipsis, functools.Placeholder, typing.NoDefault, contextvars.Token.MISSING):
        for protocol in (0, 2, 4):
            try: show('%r reduced %d' % (value, protocol), lambda: re.sub(' at 0x[0-9a-f]+', '', repr(value.__reduce_ex__(protocol))))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('%r reduced %d' % (value, protocol), lambda: re.sub(' at 0x[0-9a...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for value in (None, NotImplemented, Ellipsis, functools.Placeholder, ...')
