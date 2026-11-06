# Struct sequences among the bases that a metaclass's mro() gives, and where else the layout of their instances counts.
import os, sys, time, resource, pwd, grp


def show(label, function, *args):
    try:
        result = function(*args)
    except Exception as error:
        result = (type(error).__name__, str(error))
    print(label, result)


def derive(base, other):
    class Meta(type):
        def mro(cls):
            return [cls, other, base, object]

    class Derived(base, metaclass=Meta):
        pass
    return Derived


TYPES = [time.struct_time, os.stat_result, os.statvfs_result, os.terminal_size, os.times_result, os.uname_result, type(sys.version_info), type(sys.float_info),
         type(sys.flags), type(sys.hash_info), type(sys.int_info), type(sys.thread_info), resource.struct_rusage, pwd.struct_passwd, grp.struct_group]
for t in TYPES:
    print('---', t.__name__, t.n_fields, t.n_sequence_fields, t.n_unnamed_fields, t.__base__.__name__, t.__itemsize__)
    show('derived', lambda: type('D', (t,), {}))
    show('by mro()', lambda: derive(tuple, t).__mro__)

    def make():
        cls = derive(tuple, t)
        o = cls(range(t.n_fields))
        return type(o).__name__, tuple(o), vars(o), len(o)
    show('an instance', make)
    show('__new__ for tuple', lambda: t.__new__(tuple, range(t.n_fields)))
    show("tuple's __new__", lambda: tuple.__new__(t, range(t.n_sequence_fields)))
    show("object's __new__", lambda: object.__new__(t))

    class Plain(tuple):
        pass
    # (Which of two reasons is given is another matter.)
    try:
        Plain().__class__ = t
        print('__class__', 'set')
    except TypeError:
        print('__class__', 'TypeError')
    show('__bases__', setattr, Plain, '__bases__', (t,))

print('--- as ever')
now = time.struct_time(range(11))
print(now, now.tm_zone, now.tm_gmtoff, len(now), now[:3], now.__reduce__())
show('vars', vars, now)
show('__dict__', getattr, now, '__dict__')
st = os.stat_result(range(os.stat_result.n_fields))
print(len(st), st.st_atime, st.st_blksize, st.st_mtime_ns)
import copy, pickle
print(copy.copy(now) == now, copy.copy(now).tm_zone, pickle.loads(pickle.dumps(now)).tm_gmtoff, copy.replace(now, tm_zone='Z').tm_zone)

print('--- a class that only names one')


def named(other, **namespace):
    class Meta(type):
        def mro(cls):
            return [cls, other, tuple, object]
    return Meta('C', (tuple,), namespace)


for namespace in ({}, {'n_fields': 4}, {'n_sequence_fields': 0}, {'n_fields': 100, 'n_sequence_fields': 50}, {'__slots__': ()}):
    C = named(os.terminal_size, **namespace)
    print(namespace, C.__mro__)
    for n in range(5):
        show(n, lambda: (tuple(C(range(n))), type(C(range(n))).__name__, getattr(C(range(n)), '__dict__', 'no dict')))
        # (Of a shorter one CPython reads what lies behind it.)
        if n >= 2:
            show('columns, lines', lambda: (C(range(n)).columns, C(range(n)).lines))
        show('repr', lambda: repr(C(range(n))))
        show('__reduce__', lambda: C(range(n)).__reduce__())
        show('__replace__', lambda: tuple(C(range(n)).__replace__(columns=1)))
        show('an attribute', lambda: C(range(n)).nothing)
    show('__new__ of the one named', lambda: tuple(os.terminal_size.__new__(C, (1, 2))))
    show("tuple's", lambda: tuple(tuple.__new__(C, (1, 2, 3))))

    class D(C):
        pass
    show('derived from it', lambda: (D.__mro__, tuple(D(range(3))), vars(D(range(3))) if '__slots__' not in namespace else None))

    class E(tuple):
        pass
    show('given it as a base', setattr, E, '__bases__', (C,))
    show('given it as a base', lambda: (E.__mro__, tuple(E(range(3)))))

print('--- the bases of one are set')
show('to what they are', setattr, time.struct_time, '__bases__', (tuple,))
show('by mro()', lambda: derive(tuple, time.struct_time).__mro__)
show('to another', setattr, time.struct_time, '__bases__', (object,))
show('to another', setattr, time.struct_time, '__bases__', (os.terminal_size,))
print(time.struct_time.__mro__, time.struct_time(range(9)).tm_zone)

print('--- what the types have')
for t in TYPES:
    print(t.__name__, sorted(name for name in vars(t) if not (name.startswith('__') and name.endswith('__')) or 'struct' in name))

print('--- what is written to one')
os.terminal_size.n_fields = 100
show('n_fields = 100', lambda: (os.terminal_size((1, 2)), len(os.terminal_size((1, 2)))))
os.terminal_size.n_fields = 2
os.terminal_size.__struct_sequence_fields__ = 5
show('a name that means nothing', lambda: (os.terminal_size((1, 2)), os.terminal_size((1, 2)).__reduce__(), os.terminal_size((1, 2)).__replace__(lines=3)))
del os.terminal_size.__struct_sequence_fields__
os.terminal_size.columns = 7
show('a field', lambda: (os.terminal_size((1, 2)), os.terminal_size((1, 2)).columns, os.terminal_size((1, 2)).__replace__(columns=3)))

print('--- one that its type has not made, handed to what reads it')
import _thread


def kind(function, *args):
    try:
        function(*args)
        return 'done'
    except Exception as error:
        return type(error).__name__


original = os.sched_param.__dict__['__new__']
del os.sched_param.__new__
print('sched_setparam', kind(lambda: os.sched_setparam(0, os.sched_param(()))))
print('__reduce__', kind(lambda: os.sched_param(()).__reduce__()))
os.sched_param.__new__ = original
C = named(os.sched_param)
print('sched_setparam', kind(lambda: os.sched_setparam(0, tuple.__new__(C))))
print('sched_priority', kind(lambda: tuple.__new__(C, (5,)).sched_priority))
print('__reduce__', tuple.__new__(C, (5,)).__reduce__()[1])
show('excepthook', _thread._excepthook, 5)
show('excepthook', _thread._excepthook, (1, 2, 3, 4))

print('--- types that are found again')
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
flags = type(sys.flags)
sys.flags = 1
print(flags.__name__, flags.n_fields >= 18)
