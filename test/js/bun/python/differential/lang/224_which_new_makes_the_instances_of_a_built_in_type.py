# The __new__ that a type finds need not be the one that makes its instances: what a type inherits from C goes by __base__.
import datetime, os, struct, sys, time, _thread


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    try:
        print(label, result)
    except Exception as error:
        print(label, 'printing it:', type(error).__name__, error)


def named(base, *others, **namespace):
    class Meta(type):
        def mro(cls):
            return [cls, *others, *base.__mro__]
    return Meta('C', (base,), namespace)


print('--- one that only an mro() has put in the way')


def init(self, a):
    self.a = a


C = named(object, datetime.tzinfo, __init__=init)
show('with an __init__', lambda: C(1).a)
show('with an __init__', lambda: C())
C = named(object, datetime.tzinfo)
show('without', lambda: type(C()).__name__)
show('without', lambda: C(1))
show('without', lambda: C(a=1))
show('explicitly', lambda: datetime.tzinfo.__new__(C))
show('explicitly', lambda: type(object.__new__(C)).__name__)
C = named(tuple, os.sched_param)
show('sched_param', lambda: (tuple(C()), tuple(C((1, 2, 3)))))
show('sched_priority', lambda: C((5,)).sched_priority)
show('__reduce__', lambda: C((5,)).__reduce__()[1])
show('sched_setparam', lambda: os.sched_setparam(0, C((0,))))

print('--- among the bases, but not in the line of __base__')


class Plain:
    pass


class Both(Plain, datetime.tzinfo):
    pass


print(Both.__base__.__name__, [c.__name__ for c in Both.__mro__])
show('no arguments', lambda: type(Both()).__name__)
show('arguments', lambda: Both(1))
show('utcoffset', lambda: Both().utcoffset(None))


class BothWithInit(Plain, datetime.tzinfo):
    def __init__(self, a):
        self.a = a


show('arguments', lambda: BothWithInit(1).a)


class DictFirst(dict, Plain):
    __new__ = object.__new__


show('object.__new__ in a class derived from dict', lambda: (DictFirst(), DictFirst(a=1)))

print('--- one that is written into a built-in type')
for name, other in (('dict', dict.__new__), ('stat_result', os.stat_result.__new__), ('sched_param', os.sched_param.__new__), ('tuple', tuple.__new__), ('object', object.__new__),
        ('struct_time', time.struct_time.__new__), ('int', int.__new__)):
    original = os.terminal_size.__dict__['__new__']
    os.terminal_size.__new__ = other
    show(name, lambda: (os.terminal_size((1, 2)), type(os.terminal_size((1, 2))).__name__, len(os.terminal_size((1, 2))), os.terminal_size((1, 2)).lines))
    show(name, lambda: os.terminal_size((1, 2, 3)))
    show(name, lambda: os.terminal_size())
    os.terminal_size.__new__ = original
    show('back', lambda: os.terminal_size((1, 2)))
os.terminal_size.__new__ = lambda cls, *args: ('written in Python', cls.__name__, args)
show('a function', lambda: os.terminal_size((1, 2)))
os.terminal_size.__new__ = original
original = struct.error.__dict__.get('__new__')
struct.error.__new__ = dict.__new__
show('an exception of a module', lambda: (struct.error('x'), struct.error('x').args))
del struct.error.__new__
show('back', lambda: struct.error('x'))

print('--- names that mean nothing')
for name in ('__asyncgen_hooks_type__', '__unraisable_hook_args_type__'):
    print(name, hasattr(sys, name))
    setattr(sys, name, int)
show('get_asyncgen_hooks', sys.get_asyncgen_hooks)


class Raises:
    def __del__(self):
        raise ValueError('in __del__')


sys.unraisablehook = lambda args: print('unraisable', type(args).__name__, len(args), args.exc_type.__name__)
Raises()
import gc
gc.collect()
sys.unraisablehook = sys.__unraisablehook__
show('unraisablehook', sys.__unraisablehook__, 5)
show('excepthook', _thread._excepthook, 5)
