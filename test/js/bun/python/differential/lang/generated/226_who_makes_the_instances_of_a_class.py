# Who makes the instances of a class is not worked out from what __new__ is found at the moment: a class takes it from __base__ when it is made, and
# it changes only when __new__ is set or deleted through the class or __bases__ is assigned to. What has once been a function of the program's
# stays "look it up".
try: import collections, datetime, gc, io, os, struct, sys, time, types, typing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections, datetime, gc, io, os, struct, sys, time, types, t...')


try:
    def tell(value):
        if type(value).__repr__ is object.__repr__:
            return 'a ' + type(value).__name__
        return (type(value).__name__, repr(value)[:70])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tell(value):')


try:
    def show(label, function, *args):
        try:
            result = tell(function(*args))
        except Exception as error:
            result = (type(error).__name__, str(error))
        print(label, '->', result)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, function, *args):')


try: print('--- a function of the program is written, and taken away again')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a function of the program is written, and taken away again'")


try:
    class C(dict):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(dict):')


try: show('fresh', C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('fresh', C)")
try: C.__new__ = lambda cls, *a: dict.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__new__ = lambda cls, *a: dict.__new__(cls)')
try: show('a function', C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', C)")
try: C.__new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__new__ = object.__new__')
try: show("then object's", C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("then object\'s", C)')
try: C.__new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__new__ = dict.__new__')
try: show("then dict's", C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("then dict\'s", C)')
try: del C.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del C.__new__')
try: show('then nothing', C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('then nothing', C)")
try: show('dict.__new__(C)', dict.__new__, C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('dict.__new__(C)', dict.__new__, C)")
try: show('object.__new__(C)', object.__new__, C)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object.__new__(C)', object.__new__, C)")


try:
    class D(dict):
        __new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(dict):')


try: show("object's in the class statement", D)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("object\'s in the class statement", D)')
try: D.__new__ = int.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__new__ = int.__new__')
try: show("int's written", D)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("int\'s written", D)')
try: D.__new__ = staticmethod(dict.__new__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__new__ = staticmethod(dict.__new__)')
try: show("dict's in a staticmethod", D)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dict\'s in a staticmethod", D)')
try: D.__new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__new__ = object.__new__')
try: show("object's after that", D)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("object\'s after that", D)')


try:
    class E:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E:')


try: show('arguments, fresh', E, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('arguments, fresh', E, 1)")
try: E.__new__ = lambda cls, *a: object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__new__ = lambda cls, *a: object.__new__(cls)')
try: show('arguments, a function', E, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('arguments, a function', E, 1)")
try: del E.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del E.__new__')
try: show('arguments, deleted', E, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('arguments, deleted', E, 1)")
try: show('no arguments, deleted', E)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no arguments, deleted', E)")

try: print('--- the classes derived from it follow, as far as they have none of their own')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the classes derived from it follow, as far as they have none of ...")


try:
    class G:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')


try:
    class H(G):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H(G):')


try:
    class Own(G):
        __new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Own(G):')


try:
    class BelowOwn(Own):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BelowOwn(Own):')


try:
    class HasInit(G):
        def __init__(self, *a):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class HasInit(G):')


try:
    for K in (G, H, Own, BelowOwn, HasInit):
        try: show('before ' + K.__name__, K, 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('before ' + K.__name__, K, 1)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for K in (G, H, Own, BelowOwn, HasInit):')
try: G.__new__ = lambda cls, *a: ('made by G.__new__ for', cls.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: G.__new__ = lambda cls, *a: ('made by G.__new__ for', cls.__name__)")
try:
    for K in (G, H, Own, BelowOwn, HasInit):
        try: show('written ' + K.__name__, K, 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('written ' + K.__name__, K, 1)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for K in (G, H, Own, BelowOwn, HasInit):')
try: del G.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del G.__new__')
try:
    for K in (G, H, Own, BelowOwn, HasInit):
        try: show('deleted ' + K.__name__, K, 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('deleted ' + K.__name__, K, 1)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for K in (G, H, Own, BelowOwn, HasInit):')


try:
    class Late(G):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Late(G):')


try: show('made afterwards', Late, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made afterwards', Late, 1)")
try: show('made afterwards', Late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made afterwards', Late)")

try: print('--- __bases__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- __bases__'")


try:
    class P:
        def __new__(cls, *a):
            return object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')


try:
    class Q:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q:')


try:
    class R(P):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R(P):')


try:
    class BelowR(R):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BelowR(R):')


try:
    class S(Q):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(Q):')


try:
    class BelowS(S):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BelowS(S):')


try: R.__bases__ = (Q,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.__bases__ = (Q,)')
try: show('from one with a __new__ to one without', R, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('from one with a __new__ to one without', R, 1)")
try: show('below it', BelowR, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('below it', BelowR, 1)")
try: S.__bases__ = (P,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.__bases__ = (P,)')
try: show('from one without to one with', S, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('from one without to one with', S, 1)")
try: show('below it', BelowS, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('below it', BelowS, 1)")
try: S.__bases__ = (Q,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.__bases__ = (Q,)')
try: show('and back', S, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and back', S, 1)")
try: show('below it', BelowS, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('below it', BelowS, 1)")

try: print('--- what is written into the dict behind the back of the class')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what is written into the dict behind the back of the class'")


try:
    def real(cls):
        return gc.get_referents(cls.__dict__)[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def real(cls):')


try:
    class T(dict):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(dict):')


try: real(T)['__new__'] = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: real(T)['__new__'] = object.__new__")
try: show("object's", T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("object\'s", T)')


try:
    class U:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class U:')


try: real(U)['__new__'] = staticmethod(lambda cls, *a: 42)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: real(U)['__new__'] = staticmethod(lambda cls, *a: 42)")
try: show('a function', U)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', U)")
try: U.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.x = 1')
try: show('after another attribute was written', U)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('after another attribute was written', U)")
try: U.__init__ = lambda self: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.__init__ = lambda self: None')
try: show('after __init__ was written', U)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('after __init__ was written', U)")
try: show('U.__new__(U)', lambda: U.__new__(U))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('U.__new__(U)', lambda: U.__new__(U))")


try:
    class V(U):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V(U):')


try: show('a class made afterwards', V)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a class made afterwards', V)")

try: print('--- T.__new__(S)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- T.__new__(S)'")


try:
    class W(dict):
        def __new__(cls):
            return dict.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W(dict):')


try:
    class X(W):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X(W):')


try:
    class Y(dict):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y(dict):')


try: show('date for datetime', datetime.date.__new__, datetime.datetime, 2020, 1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('date for datetime', datetime.date.__new__, datetime.datetime, 2...")
try: show('datetime for date', datetime.datetime.__new__, datetime.date, 2020, 1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('datetime for date', datetime.datetime.__new__, datetime.date, 2...")
try: show('int for bool', int.__new__, bool)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('int for bool', int.__new__, bool)")
try: show('tzinfo for timezone', datetime.tzinfo.__new__, datetime.timezone)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tzinfo for timezone', datetime.tzinfo.__new__, datetime.timezone)")
try: show('object for X', object.__new__, X)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for X', object.__new__, X)")
try: show('dict for X', dict.__new__, X)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('dict for X', dict.__new__, X)")
try: show('object for Y', object.__new__, Y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for Y', object.__new__, Y)")
try: show('OrderedDict for Y', collections.OrderedDict.__new__, Y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('OrderedDict for Y', collections.OrderedDict.__new__, Y)")
try: show('Exception for KeyError', Exception.__new__, KeyError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('Exception for KeyError', Exception.__new__, KeyError)")
try: show('Exception for OSError', Exception.__new__, OSError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('Exception for OSError', Exception.__new__, OSError)")
try: show('OSError for FileNotFoundError', OSError.__new__, FileNotFoundError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('OSError for FileNotFoundError', OSError.__new__, FileNotFoundEr...")
try: show('BaseException for ExceptionGroup', BaseException.__new__, ExceptionGroup)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('BaseException for ExceptionGroup', BaseException.__new__, Excep...")
try: show('tuple for struct_time', tuple.__new__, time.struct_time)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tuple for struct_time', tuple.__new__, time.struct_time)")
try: show('object for NoneType', object.__new__, type(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for NoneType', object.__new__, type(None))")
try: show('object for a generator', object.__new__, types.GeneratorType)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for a generator', object.__new__, types.GeneratorType)")
try: show('object for a function', object.__new__, types.FunctionType)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for a function', object.__new__, types.FunctionType)")
try: show('object for an iterator', object.__new__, type(iter([])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for an iterator', object.__new__, type(iter([])))")
try: show('object for sys.flags', object.__new__, type(sys.flags))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for sys.flags', object.__new__, type(sys.flags))")
try: show('tuple for sys.flags', tuple.__new__, type(sys.flags))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tuple for sys.flags', tuple.__new__, type(sys.flags))")
try: show('object for IOBase', object.__new__, io.IOBase)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for IOBase', object.__new__, io.IOBase)")
try: show('object for Generic', object.__new__, typing.Generic)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object for Generic', object.__new__, typing.Generic)")
try: show('no class', object.__new__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no class', object.__new__)")
try: show('no class', object.__new__, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no class', object.__new__, 5)")

try: print('--- what an mro() names, and what it leaves out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what an mro() names, and what it leaves out'")


try:
    class Stranger:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Stranger:')


try:
    class Names(type):
        def mro(cls):
            return [cls, Stranger, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Names(type):')


try:
    class N1(metaclass=Names):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N1(metaclass=Names):')


try: show('before', N1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('before', N1, 1)")
try: Stranger.__new__ = lambda cls, *a: ('made by Stranger.__new__ for', cls.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Stranger.__new__ = lambda cls, *a: ('made by Stranger.__new__ for', c...")
try: show('the class is not told', N1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the class is not told', N1, 1)")
try: N1.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N1.x = 1')
try: show('nor after a write to it', N1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('nor after a write to it', N1, 1)")


try:
    class N2(metaclass=Names):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N2(metaclass=Names):')


try: show('one made afterwards sees it', N2, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('one made afterwards sees it', N2, 1)")
try: del Stranger.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Stranger.__new__')
try: show('and goes on looking', N2, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and goes on looking', N2, 1)")
try: show('the first', N1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the first', N1, 1)")


try:
    class Alone(type):
        def mro(cls):
            return [cls]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Alone(type):')


try:
    class O(metaclass=Alone):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O(metaclass=Alone):')


try: show('no object in the MRO', O)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no object in the MRO', O)")
try: show('object.__new__', object.__new__, O)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object.__new__', object.__new__, O)")
try: O.__new__ = lambda cls: 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: O.__new__ = lambda cls: 5')
try: show('a function', O)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', O)")
try: del O.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del O.__new__')
try: show('deleted', O)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('deleted', O)")


try:
    class A:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')


try:
    class Drops(type):
        def mro(cls):
            return [cls, A, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Drops(type):')


try:
    for base in (int, float, str, bytes, tuple, dict, list, Exception):
        try: Z = Drops('Z', (base,), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Z = Drops('Z', (base,), {})")
        try: show('without %s: ()' % base.__name__, lambda: type(Z()).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without %s: ()' % base.__name__, lambda: type(Z()).__name__)")
        try: show('without %s: (1)' % base.__name__, lambda: type(Z(1)).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without %s: (1)' % base.__name__, lambda: type(Z(1)).__name__)")
        try: show('without %s: (a=1)' % base.__name__, lambda: type(Z(a=1)).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without %s: (a=1)' % base.__name__, lambda: type(Z(a=1)).__name__)")
        try: show('without %s: its __new__' % base.__name__, base.__new__, Z)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without %s: its __new__' % base.__name__, base.__new__, Z)")
        try: show('without %s: object.__new__' % base.__name__, object.__new__, Z)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without %s: object.__new__' % base.__name__, object.__new__, Z)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base in (int, float, str, bytes, tuple, dict, list, Exception):')


try:
    def named(stranger, *bases):
        class Meta(type):
            def mro(cls):
                return [cls, stranger] + [c for b in bases for c in b.__mro__ if c is not object] + [object]
        return Meta('C', bases, {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def named(stranger, *bases):')


try:
    for stranger in (type(None), type(NotImplemented), type(...), os.sched_param, os.terminal_size):
        for bases in ((), (tuple,)):
            try: label = '%s for %s' % (stranger.__name__, [b.__name__ for b in bases])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: label = '%s for %s' % (stranger.__name__, [b.__name__ for b in bases])")
            try:
                K = named(stranger, *bases)
            except TypeError as error:
                print('label [' + 'stranger=' + (repr(stranger) if type(stranger) in (str, int, float, bytes, bool, type(None)) or (type(stranger) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in stranger)) else stranger.__name__ if type(stranger) is type else type(stranger).__name__) + ", " + 'bases=' + (repr(bases) if type(bases) in (str, int, float, bytes, bool, type(None)) or (type(bases) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in bases)) else bases.__name__ if type(bases) is type else type(bases).__name__) + '] =>', label)
                print('no class:', 'error [' + 'stranger=' + (repr(stranger) if type(stranger) in (str, int, float, bytes, bool, type(None)) or (type(stranger) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in stranger)) else stranger.__name__ if type(stranger) is type else type(stranger).__name__) + ", " + 'bases=' + (repr(bases) if type(bases) in (str, int, float, bytes, bool, type(None)) or (type(bases) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in bases)) else bases.__name__ if type(bases) is type else type(bases).__name__) + '] =>', error)
                continue
            try: show(label + ' ()', lambda: (type(K()).__name__, K() is None))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(label + ' ()', lambda: (type(K()).__name__, K() is None))")
            try: show(label + ' ((1, 2))', lambda: type(K((1, 2))).__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(label + ' ((1, 2))', lambda: type(K((1, 2))).__name__)")
            try: show(label + ' its __new__', stranger.__new__, K)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(label + ' its __new__', stranger.__new__, K)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for stranger in (type(None), type(NotImplemented), type(...), os.sche...')

try: print('--- built-in types that can be written to')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- built-in types that can be written to'")
try: kept = os.terminal_size.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept = os.terminal_size.__new__')
try: show('kept', kept, os.terminal_size, (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('kept', kept, os.terminal_size, (1, 2))")
try: os.terminal_size.__new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = dict.__new__')
try: show("dict's written", os.terminal_size, (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dict\'s written", os.terminal_size, (1, 2))')
try: os.terminal_size.__new__ = lambda cls, *a: tuple.__new__(cls, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = lambda cls, *a: tuple.__new__(cls, a)')
try: show('a function: two', os.terminal_size, 1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function: two', os.terminal_size, 1, 2)")
try: show('a function: one', lambda: (os.terminal_size(1), os.terminal_size(1).columns, os.terminal_size(1).lines))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function: one', lambda: (os.terminal_size(1), os.terminal_siz...")
try: show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))")
try: show('kept', kept, os.terminal_size, (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('kept', kept, os.terminal_size, (1, 2))")
try: os.terminal_size.__new__ = kept
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = kept')
try: show('put back', os.terminal_size, (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('put back', os.terminal_size, (1, 2))")
try: show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tuple.__new__', tuple.__new__, os.terminal_size, (1,))")
try: time.struct_time.__new__ = tuple.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: time.struct_time.__new__ = tuple.__new__')
try: show("tuple's written", time.struct_time, (1,) * 9)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("tuple\'s written", time.struct_time, (1,) * 9)')
try: show("tuple's written", time.struct_time, ())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("tuple\'s written", time.struct_time, ())')

try: print('--- an exception that C++ raises, whose type makes something else')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- an exception that C++ raises, whose type makes something else'")
try: struct.error.__new__ = lambda cls, *a: 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = lambda cls, *a: 42')
try: show('an int', struct.pack, 'i', 'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an int', struct.pack, 'i', 'x')")
try: struct.error.__new__ = lambda cls, *a: {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = lambda cls, *a: {}')
try: show('a dict', struct.pack, 'i', 'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a dict', struct.pack, 'i', 'x')")
try: struct.error.__new__ = lambda cls, *a: ValueError('another', *a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: struct.error.__new__ = lambda cls, *a: ValueError('another', *a)")
try: show('another exception', struct.pack, 'i', 'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('another exception', struct.pack, 'i', 'x')")
try: kept = ValueError('kept')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: kept = ValueError('kept')")
try: struct.error.__new__ = lambda cls, *a: kept
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = lambda cls, *a: kept')
try:
    for again in range(2):
        try:
            struct.pack('i', 'x')
        except ValueError:
            # Nothing here has asked for it, and it is the program's all the same.
            print('one that the program has:', 'sum(o is kept for o in gc.get_objects()) [' + 'again=' + (repr(again) if type(again) in (str, int, float, bytes, bool, type(None)) or (type(again) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in again)) else again.__name__ if type(again) is type else type(again).__name__) + '] =>', sum(o is kept for o in gc.get_objects()))
            print('sys.exception() is kept [' + 'again=' + (repr(again) if type(again) in (str, int, float, bytes, bool, type(None)) or (type(again) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in again)) else again.__name__ if type(again) is type else type(again).__name__) + '] =>', sys.exception() is kept)
            print('kept.__traceback__.tb_frame is sys._getframe() [' + 'again=' + (repr(again) if type(again) in (str, int, float, bytes, bool, type(None)) or (type(again) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in again)) else again.__name__ if type(again) is type else type(again).__name__) + '] =>', kept.__traceback__.tb_frame is sys._getframe())
            try:
                struct.pack('i', 'x')
            except ValueError:
                print('raised again while it is handled:', 'sum(o is kept for o in gc.get_objects()) [' + 'again=' + (repr(again) if type(again) in (str, int, float, bytes, bool, type(None)) or (type(again) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in again)) else again.__name__ if type(again) is type else type(again).__name__) + '] =>', sum(o is kept for o in gc.get_objects()))
                print('kept.__context__ [' + 'again=' + (repr(again) if type(again) in (str, int, float, bytes, bool, type(None)) or (type(again) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in again)) else again.__name__ if type(again) is type else type(again).__name__) + '] =>', kept.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for again in range(2):')
try: del struct.error.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del struct.error.__new__')
try: show('deleted', struct.pack, 'i', 'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('deleted', struct.pack, 'i', 'x')")

try: print('--- and one that the program gets hold of while it is made, by an __init__ written in C++')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- and one that the program gets hold of while it is made, by an __...")
try: import csv
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import csv')


try:
    def names(e):
        found, entry = [], e.__traceback__
        while entry:
            found.append(entry.tb_frame.f_code.co_name)
            entry = entry.tb_next
        return found
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names(e):')


try:
    def inner():
        csv.get_dialect('none')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')


try:
    def outer():
        inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')


try:
    def catches():
        try:
            inner()
        except csv.Error:
            return
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catches():')


try: held = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: held = []')
try: csv.Error.__init__ = BaseException.add_note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: csv.Error.__init__ = BaseException.add_note')
try: csv.Error.__notes__ = property(lambda self: (held.append(self), [])[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: csv.Error.__notes__ = property(lambda self: (held.append(self), [])[1])')
try:
    try:
        outer()
    except csv.Error:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print('len(held) =>', len(held))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(held)')
try: print('held[0].args =>', held[0].args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: held[0].args')
try: print('names(held[0]) =>', names(held[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(held[0])')
try: print('sum(o is held[0] for o in gc.get_objects()) =>', sum(o is held[0] for o in gc.get_objects()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(o is held[0] for o in gc.get_objects())')
try: del held[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del held[:]')
try: catches()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: catches()')
try: print('len(held) =>', len(held))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(held)')
try: print('names(held[0]) =>', names(held[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(held[0])')
try: print('held[0].__traceback__.tb_frame.f_back.f_code.co_name =>', held[0].__traceback__.tb_frame.f_back.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: held[0].__traceback__.tb_frame.f_back.f_code.co_name')
try: del held[:], csv.Error.__init__, csv.Error.__notes__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del held[:], csv.Error.__init__, csv.Error.__notes__')
try: show('deleted', inner)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('deleted', inner)")

try: print('--- the type changes while its __new__ runs')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the type changes while its __new__ runs'")


try:
    class L(list):
        def __iter__(self):
            ExceptionGroup.__init__ = replacement
            return list.__iter__(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L(list):')


try: replacement = lambda self, *a: print('   an __init__ of the program:', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: replacement = lambda self, *a: print(' an __init__ of the program:', a)")
try: show('a function', ExceptionGroup, 'm', L([ValueError()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', ExceptionGroup, 'm', L([ValueError()]))")
try: del ExceptionGroup.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ExceptionGroup.__init__')
try: replacement = dict.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replacement = dict.__init__')
try: show("dict's", ExceptionGroup, 'm', L([ValueError()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dict\'s", ExceptionGroup, \'m\', L([ValueError()]))')
try: del ExceptionGroup.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ExceptionGroup.__init__')
try: show('as before', ExceptionGroup, 'm', [ValueError()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('as before', ExceptionGroup, 'm', [ValueError()])")

try: print('--- a base that brings a __new__ of another kind to a built-in type that can be written to')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a base that brings a __new__ of another kind to a built-in type ...")
try: import binascii
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import binascii')


try:
    class Slotless(tuple):
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slotless(tuple):')


try: binascii.Error.__bases__ = (ValueError, datetime.tzinfo)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binascii.Error.__bases__ = (ValueError, datetime.tzinfo)')
try: binascii.Error.__new__ = datetime.tzinfo.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binascii.Error.__new__ = datetime.tzinfo.__new__')
try: x = binascii.Error('a')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x = binascii.Error('a')")
try: show('made', lambda: x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made', lambda: x)")
try: x.args = (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.args = (1, 2)')
try: x.__cause__ = KeyError()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__cause__ = KeyError()')
try: x.add_note('a note')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x.add_note('a note')")
try: show('used', lambda: (x.args, x.__cause__, x.__notes__, x.utcoffset.__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('used', lambda: (x.args, x.__cause__, x.__notes__, x.utcoffset._...")
try: show('raised by C++', binascii.unhexlify, 'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('raised by C++', binascii.unhexlify, 'x')")
try: os.times_result.__bases__ = (Slotless, datetime.tzinfo)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.times_result.__bases__ = (Slotless, datetime.tzinfo)')
try: os.times_result.__new__ = datetime.tzinfo.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.times_result.__new__ = datetime.tzinfo.__new__')
try: show('a struct sequence', os.times_result, (1, 2, 3, 4, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a struct sequence', os.times_result, (1, 2, 3, 4, 5))")
try: show('a struct sequence', lambda: os.times_result((1, 2, 3, 4, 5)).elapsed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a struct sequence', lambda: os.times_result((1, 2, 3, 4, 5)).el...")
try: show('a struct sequence', os.times_result)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a struct sequence', os.times_result)")
try: show('made by C++', lambda: type(os.times()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made by C++', lambda: type(os.times()).__name__)")
try: import zlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import zlib')
try: zlib.error.__bases__ = (datetime.tzinfo, Exception)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: zlib.error.__bases__ = (datetime.tzinfo, Exception)')
try: show('found first', lambda: zlib.error('a').args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('found first', lambda: zlib.error('a').args)")
try: show('found first, raised by C++', zlib.decompress, b'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('found first, raised by C++', zlib.decompress, b'x')")
try: show('found first, a class derived from it', lambda: type('D', (zlib.error,), {})('b').args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('found first, a class derived from it', lambda: type('D', (zlib....")
try: zlib.error.__bases__ = (Exception,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: zlib.error.__bases__ = (Exception,)')
try: show('as before', zlib.decompress, b'x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('as before', zlib.decompress, b'x')")

try: print('--- the metaclass that wins')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the metaclass that wins'")


try:
    class M1(type):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M1(type):')


try:
    class B1(metaclass=M1):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B1(metaclass=M1):')


try: M1.__new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1.__new__ = dict.__new__')
try: show("dict's written", lambda: type(type('X', (B1,), {})).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dict\'s written", lambda: type(type(\'X\', (B1,), {})).__name__)')
try: M1.__new__ = lambda *a: 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1.__new__ = lambda *a: 5')
try: show('a function', type, 'X', (B1,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', type, 'X', (B1,), {})")
try: M1.__new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1.__new__ = dict.__new__')
try: show("dict's after that", type, 'X', (B1,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dict\'s after that", type, \'X\', (B1,), {})')
try: M1.__new__ = type.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1.__new__ = type.__new__')
try: show("type's after that", lambda: type(type('X', (B1,), {})).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("type\'s after that", lambda: type(type(\'X\', (B1,), {})).__name__)')

try: print('--- a class that looks __new__ up asks for it as for any attribute of the class')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a class that looks __new__ up asks for it as for any attribute o...")


try:
    class Asked(type):
        def __getattribute__(cls, name):
            if name == '__new__':
                print('   the metaclass is asked for', name)
            return type.__getattribute__(cls, name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Asked(type):')


try:
    class A1(metaclass=Asked):
        def __new__(cls):
            return object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A1(metaclass=Asked):')


try:
    class A2(metaclass=Asked):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A2(metaclass=Asked):')


try: show('with a __new__ in Python', A1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('with a __new__ in Python', A1)")
try: show('without', A2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without', A2)")


try:
    class Gives(type):
        def __getattr__(cls, name):
            print('   __getattr__ of the metaclass:', name)
            if name == '__new__':
                return lambda cls: 'from the metaclass'
            raise AttributeError(name)

        def mro(cls):
            return [cls]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Gives(type):')


try:
    class A3(metaclass=Gives):
        def __new__(cls):
            return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A3(metaclass=Gives):')


try: show('found', A3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('found', A3)")
try: del real(A3)['__new__']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: del real(A3)['__new__']")
try: type.__dict__['__abstractmethods__'].__set__(A3, ())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type.__dict__['__abstractmethods__'].__set__(A3, ())")
try: show('taken out of the dict behind its back', A3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('taken out of the dict behind its back', A3)")
try: A3.__new__ = lambda cls: 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A3.__new__ = lambda cls: 6')
try: show('written', A3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('written', A3)")
try: del A3.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del A3.__new__')
try: show('deleted', A3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('deleted', A3)")


try:
    class Name(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Name(str):')


try:
    class A4:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A4:')


try: type.__setattr__(A4, Name('__new__'), lambda cls: 7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type.__setattr__(A4, Name('__new__'), lambda cls: 7)")
try: show('the name is of a class derived from str', A4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the name is of a class derived from str', A4)")

try: import abc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import abc')


try:
    class Quiet(type):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Quiet(type):')


try:
    class A5(metaclass=Quiet):
        def __new__(cls):
            return 'what A5 has'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A5(metaclass=Quiet):')


try:
    class A6(abc.ABC):
        def __new__(cls):
            return 'what A6 has'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A6(abc.ABC):')


try:
    class Data:
        def __get__(self, cls, metaclass=None):
            return lambda *a: 'what the data descriptor of the metaclass gives'

        def __set__(self, cls, value):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Data:')


try:
    class Refuses:
        def __get__(self, o, cls=None):
            raise AttributeError('refused')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Refuses:')


try: show('a metaclass that has nothing to say', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a metaclass that has nothing to say', A5)")
try: show('abc.ABC', A6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('abc.ABC', A6)")
try: Quiet.__getattribute__ = lambda cls, name: (lambda *a: 'what __getattribute__ gives') if name == '__new__' else type.__getattribute__(cls, name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Quiet.__getattribute__ = lambda cls, name: (lambda *a: 'what __getatt...")
try: show('the metaclass is given a __getattribute__', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the metaclass is given a __getattribute__', A5)")
try: del Quiet.__getattribute__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Quiet.__getattribute__')
try: show('and loses it', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and loses it', A5)")
try: Quiet.__new__ = Data()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Quiet.__new__ = Data()')
try: show('a data descriptor in the metaclass', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a data descriptor in the metaclass', A5)")
try: del Data.__set__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Data.__set__')
try: show('that is one no longer', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('that is one no longer', A5)")
try: del Quiet.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Quiet.__new__')
try: show('and is gone', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and is gone', A5)")
try: A5.__new__ = Refuses()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A5.__new__ = Refuses()')
try: show('a descriptor that refuses', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a descriptor that refuses', A5)")
try: Quiet.__getattr__ = lambda cls, name: lambda *a: 'what __getattr__ gives for ' + name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Quiet.__getattr__ = lambda cls, name: lambda *a: 'what __getattr__ gi...")
try: show('a descriptor that refuses, and a __getattr__ in the metaclass', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a descriptor that refuses, and a __getattr__ in the metaclass',...")
try: del Quiet.__getattr__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Quiet.__getattr__')
try: show('a descriptor that refuses', A5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a descriptor that refuses', A5)")

try: print('--- a key that is no str changes the class while __new__ is looked for')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a key that is no str changes the class while __new__ is looked for'")


try:
    class Key:
        def __init__(self, action):
            self.action = action

        def __hash__(self):
            return hash('__new__')

        def __eq__(self, other):
            action, self.action = self.action, None
            if action:
                action()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')


try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try: made = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: made = []')
try: Base = type('Base', (), {Key(lambda: made and setattr(made[0], '__new__', lambda cls, *a: 'written by the key')): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base = type('Base', (), {Key(lambda: made and setattr(made[0], '__new...")
try: K1 = type('K1', (Base,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: K1 = type('K1', (Base,), {})")
try: made.append(K1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: made.append(K1)')
try: show('before', K1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('before', K1)")
try: Base.__new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__new__ = object.__new__')
try: show('after', K1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('after', K1)")
try: show('after', K1, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('after', K1, 1)")

try: print('--- copies and pickles do not go by who makes the instances')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- copies and pickles do not go by who makes the instances'")
try: import copy, pickle
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import copy, pickle')


try:
    class OfGeneric(typing.Generic[typing.TypeVar('T')]):
        def __init__(self):
            self.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class OfGeneric(typing.Generic[typing.TypeVar('T')]):")


try:
    class OfIOBase(io.IOBase):
        def __init__(self):
            self.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OfIOBase(io.IOBase):')


try: show('before', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle.dumps(OfGeneric())).a, copy.copy(OfIOBase()).a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('before', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle...")
try: typing.Generic.__new__ = lambda cls, *a, **k: object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: typing.Generic.__new__ = lambda cls, *a, **k: object.__new__(cls)')
try: del typing.Generic.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del typing.Generic.__new__')
try: show('after', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle.dumps(OfGeneric())).a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('after', lambda: (copy.copy(OfGeneric()).a, pickle.loads(pickle....")
try: show('no instances from Python', lambda: copy.copy(iter([])).__class__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no instances from Python', lambda: copy.copy(iter([])).__class_...")
try: show('no instances from Python', lambda: (x for x in ()).__reduce_ex__(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no instances from Python', lambda: (x for x in ()).__reduce_ex_...")

try: print('--- a built-in type that can be written to is given a class for a base')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a built-in type that can be written to is given a class for a base'")


try:
    class Plain:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain:')


try: binascii.Incomplete.__bases__ = (Plain, Exception)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binascii.Incomplete.__bases__ = (Plain, Exception)')
try: show('__dict__', lambda: binascii.Incomplete('a').__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__dict__', lambda: binascii.Incomplete('a').__dict__)")
try: i = binascii.Incomplete('a')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: i = binascii.Incomplete('a')")
try: i.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.x = 1')
try: show('__dict__', lambda: (i.__dict__, vars(i), i.args))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__dict__', lambda: (i.__dict__, vars(i), i.args))")
try: i.__dict__ = {'y': 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: i.__dict__ = {'y': 2}")
try: show('__dict__', lambda: (i.y, i.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__dict__', lambda: (i.y, i.__dict__))")

try: print('--- behind the back of types that cannot be written to')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- behind the back of types that cannot be written to'")


try:
    class Door:
        def __ror__(self, other):
            return other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Door:')


try: forget = type.__dict__['__abstractmethods__'].__set__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: forget = type.__dict__['__abstractmethods__'].__set__")


try:
    def written(cls, name, value, *uses):
        d = cls.__dict__ | Door()
        missing = object()
        old = d.get(name, missing)
        if value is missing_value:
            del d[name]
        else:
            d[name] = value
        forget(cls, ())
        del d['__abstractmethods__']
        try:
            for label, use in uses:
                show(label, use)
        finally:
            if old is missing:
                del d[name]
            else:
                d[name] = old
            forget(cls, ())
            del d['__abstractmethods__']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def written(cls, name, value, *uses):')


try: missing_value = object()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: missing_value = object()')
try: o = object()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = object()')
try: written(object, '__eq__', missing_value, ('no object.__eq__: !=', lambda: (o != 1, o != o)), ('no object.__eq__: in', lambda: o in [1, o]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(object, '__eq__', missing_value, ('no object.__eq__: !=', lam...")
try:
    for label, value in (("bytearray's", bytearray.__init__), ('a function that raises', lambda self, *a: 1 / 0), ('5', 5), ('its own __repr__', BaseException.__repr__), ("object's __eq__", object.__eq__),
                         ("object's __setattr__", object.__setattr__), ('its own __reduce__', BaseException.__reduce__), ('its own __new__', BaseException.__new__)):
        try: written(BaseException, '__init__', value,
        ('BaseException.__init__ is %s: what C++ raises' % label, lambda: 1 / 0),
        ('and', lambda: int('x')),
        ('and', lambda: [].pop()),
        ('and', lambda: {}['k']),
        ('and', lambda: open('/nonexistent/file')),
        ('and', lambda: next(iter(()))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(BaseException, '__init__', value, ('BaseException.__init__ is...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for label, value in (("bytearray\'s", bytearray.__init__), (\'a functio...')
try: written(datetime.datetime, '__new__', missing_value, ('no datetime.__new__', lambda: datetime.datetime(2020, 1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(datetime.datetime, '__new__', missing_value, ('no datetime.__...")
try: written(dict, '__new__', lambda cls, *a: 5, ('dict.__new__ is a function', lambda: (dict(a=1), types.SimpleNamespace({'a': 1}))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(dict, '__new__', lambda cls, *a: 5, ('dict.__new__ is a funct...")
try: written(ValueError, '__new__', lambda cls, *a: 5, ('ValueError.__new__ is a function', lambda: int('x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(ValueError, '__new__', lambda cls, *a: 5, ('ValueError.__new_...")
try: import ctypes
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import ctypes')


try:
    def simple():
        class I(ctypes._SimpleCData):
            _type_ = 'i'
        return I.__name__, I.__ctype_be__.__name__, I.__ctype_le__ is I, I(5).value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def simple():')


try: written(type, '__new__', lambda *a: 5, ('type.__new__ is a function', lambda: type('X', (), {}).__name__), ('and a class for which C++ makes a second one', simple))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: written(type, '__new__', lambda *a: 5, ('type.__new__ is a function',...")
try: deep = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep = []')
try:
    for i in range(200000):
        try: deep = [deep]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep = [deep]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(200000):')


try:
    def use_up_the_stack():
        try:
            repr(deep)
        except RecursionError as error:
            return type(error).__name__, len(error.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def use_up_the_stack():')


try:
    for cls in (RecursionError, RuntimeError, BaseException):
        try: written(cls, '__init__', object.__init__, ("%s.__init__ is object's, and the stack is used up" % cls.__name__, use_up_the_stack))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: written(cls, \'__init__\', object.__init__, ("%s.__init__ is object\'s, ...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (RecursionError, RuntimeError, BaseException):')
try: deep = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep = None')

try: Simple = type(ctypes.c_int)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Simple = type(ctypes.c_int)')
try: handed = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: handed = []')


try:
    class Hands(Simple):
        def __new__(metaclass, *a, **k):
            return handed[0] if handed else super().__new__(metaclass, *a, **k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Hands(Simple):')


try: B2 = Hands('B2', (ctypes._SimpleCData,), {'_type_': 'i'})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: B2 = Hands('B2', (ctypes._SimpleCData,), {'_type_': 'i'})")
try:
    for victim in (io.IOBase.__base__, os.terminal_size, int):
        try: T2 = type.__new__(Simple, 'T2', (ctypes._SimpleCData,), {'_type_': 'q'})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: T2 = type.__new__(Simple, 'T2', (ctypes._SimpleCData,), {'_type_': 'q'})")
        try: handed.append(victim)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: handed.append(victim)')
        try: show('the metaclass that wins hands back %r for the second class' % (victim,), Simple.__init__, T2, 'T2', (B2,), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the metaclass that wins hands back %r for the second class' % (...")
        try: handed.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: handed.clear()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for victim in (io.IOBase.__base__, os.terminal_size, int):')
try: show('and these are as they were', lambda: (io.BytesIO(b'x').read(), os.terminal_size.n_fields, int('7')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and these are as they were', lambda: (io.BytesIO(b'x').read(), ...")
try: show('all is as it was', lambda: (o != 1, datetime.datetime(2020, 1, 2), dict(a=1), len(collections.OrderedDict(a=1))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('all is as it was', lambda: (o != 1, datetime.datetime(2020, 1, ...")

try: print('--- one function that makes cells of two sizes goes by __base__ as well')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- one function that makes cells of two sizes goes by __base__ as w...")
try: import asyncio, _asyncio
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import asyncio, _asyncio')


try:
    class LeavesTaskOut(type):
        def mro(cls):
            return [cls, _asyncio.Future, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LeavesTaskOut(type):')


try:
    class NamesTask(type):
        def mro(cls):
            return [cls, _asyncio.Task, _asyncio.Future, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NamesTask(type):')


try:
    class PlainTask(_asyncio.Task):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class PlainTask(_asyncio.Task):')


try:
    class SlotsTask(_asyncio.Task):
        __slots__ = ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SlotsTask(_asyncio.Task):')


try:
    async def two():
        return 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def two():')


try: loop = asyncio.new_event_loop()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop = asyncio.new_event_loop()')
try: x = LeavesTaskOut('X', (_asyncio.Task,), {})(loop=loop)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x = LeavesTaskOut('X', (_asyncio.Task,), {})(loop=loop)")
try: x.__class__ = PlainTask
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__class__ = PlainTask')
try: show('a task after all', lambda: (type(x).__name__, x.set_name('a name'), x.get_name(), x.cancel(), x.cancelling(), x.get_coro(), x.done()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a task after all', lambda: (type(x).__name__, x.set_name('a nam...")
try: show('a class that only names Task', NamesTask, 'Z', (_asyncio.Future,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a class that only names Task', NamesTask, 'Z', (_asyncio.Future...")
try: show('with __slots__', lambda: loop.run_until_complete(SlotsTask(two(), loop=loop)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('with __slots__', lambda: loop.run_until_complete(SlotsTask(two(...")
try:
    for metaclass, namespace in ((type(ctypes.Structure), {}), (type(ctypes.Union), {'_fields_': []}), (type(ctypes.c_int), {'_type_': 'i'}), (type(ctypes.Array), {'_type_': ctypes.c_int, '_length_': 1})):
        # These keep what they know of a class in the class.
        try: F = metaclass('F', (_asyncio.Future,), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: F = metaclass('F', (_asyncio.Future,), namespace)")
        try: show('a Future whose class is of %s' % metaclass.__name__, lambda: (F(loop=loop).cancel(), F(loop=loop).get_loop() is loop))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a Future whose class is of %s' % metaclass.__name__, lambda: (F...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for metaclass, namespace in ((type(ctypes.Structure), {}), (type(ctyp...')
try: loop.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop.close()')

try: print('--- a lattice of classes, and a long chain: each class is told once, whatever the ways that lead to it')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a lattice of classes, and a long chain: each class is told once,...")


try:
    class Base:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')


try: level = [type('A0', (Base,), {}), type('B0', (Base,), {})]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: level = [type('A0', (Base,), {}), type('B0', (Base,), {})]")
try: lattice = list(level)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lattice = list(level)')
try:
    for i in range(1, 14):
        try: level = [type('A%d' % i, tuple(level), {}), type('B%d' % i, tuple(level), {})]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: level = [type('A%d' % i, tuple(level), {}), type('B%d' % i, tuple(lev...")
        try: lattice += level
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lattice += level')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(1, 14):')


try:
    def outcomes():
        found = []
        for c in [Base] + lattice:
            try:
                made = c(1)
                found.append('i' if type(made) is c else 'o')
            except TypeError:
                found.append('-')
        return ''.join(found)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outcomes():')


try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')
try: Base.__new__ = lambda cls, *a: object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__new__ = lambda cls, *a: object.__new__(cls)')
try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')
try: lattice[9].__new__ = lambda cls, *a: 'its own'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: lattice[9].__new__ = lambda cls, *a: 'its own'")
try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')
try: del Base.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__new__')
try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')
try: Base.__new__ = lambda cls, *a: object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__new__ = lambda cls, *a: object.__new__(cls)')
try: del lattice[9].__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del lattice[9].__new__')
try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')
try: del Base.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__new__')
try: print(outcomes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcomes()')


try:
    class Short(type):
        def mro(cls):
            return [cls, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Short(type):')


try:
    class Root(metaclass=Short):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Root(metaclass=Short):')


try: chain = [Root]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chain = [Root]')
try:
    for i in range(3000):
        try: chain.append(Short('C', (chain[-1],), {}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: chain.append(Short('C', (chain[-1],), {}))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3000):')
try: Root.__new__ = lambda cls, *a: object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.__new__ = lambda cls, *a: object.__new__(cls)')


try:
    def refused(c):
        try:
            c(1)
        except TypeError:
            return True
        return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def refused(c):')


try: print('refused(Root) =>', refused(Root))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refused(Root)')
try: print('sum(refused(c) for c in chain[1:]) =>', sum(refused(c) for c in chain[1:]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(refused(c) for c in chain[1:])')
try: del Root.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Root.__new__')
try: print('refused(Root) =>', refused(Root))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refused(Root)')
try: print('sum(refused(c) for c in chain[1:]) =>', sum(refused(c) for c in chain[1:]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(refused(c) for c in chain[1:])')
