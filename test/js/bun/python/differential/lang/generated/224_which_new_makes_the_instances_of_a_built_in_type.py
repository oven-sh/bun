# The __new__ that a type finds need not be the one that makes its instances: what a type inherits from C goes by __base__.
try: import datetime, os, struct, sys, time, _thread
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import datetime, os, struct, sys, time, _thread')


try:
    def show(label, function, *args):
        try:
            result = function(*args)
        except Exception as error:
            result = (type(error).__name__, str(error))
        try:
            print(label, result)
        except Exception as error:
            print(label, 'printing it:', type(error).__name__, error)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, function, *args):')


try:
    def named(base, *others, **namespace):
        class Meta(type):
            def mro(cls):
                return [cls, *others, *base.__mro__]
        return Meta('C', (base,), namespace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def named(base, *others, **namespace):')


try: print('--- one that only an mro() has put in the way')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- one that only an mro() has put in the way'")


try:
    def init(self, a):
        self.a = a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def init(self, a):')


try: C = named(object, datetime.tzinfo, __init__=init)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C = named(object, datetime.tzinfo, __init__=init)')
try: show('with an __init__', lambda: C(1).a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('with an __init__', lambda: C(1).a)")
try: show('with an __init__', lambda: C())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('with an __init__', lambda: C())")
try: C = named(object, datetime.tzinfo)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C = named(object, datetime.tzinfo)')
try: show('without', lambda: type(C()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without', lambda: type(C()).__name__)")
try: show('without', lambda: C(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without', lambda: C(1))")
try: show('without', lambda: C(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('without', lambda: C(a=1))")
try: show('explicitly', lambda: datetime.tzinfo.__new__(C))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('explicitly', lambda: datetime.tzinfo.__new__(C))")
try: show('explicitly', lambda: type(object.__new__(C)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('explicitly', lambda: type(object.__new__(C)).__name__)")
try: C = named(tuple, os.sched_param)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C = named(tuple, os.sched_param)')
try: show('sched_param', lambda: (tuple(C()), tuple(C((1, 2, 3)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('sched_param', lambda: (tuple(C()), tuple(C((1, 2, 3)))))")
try: show('sched_priority', lambda: C((5,)).sched_priority)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('sched_priority', lambda: C((5,)).sched_priority)")
try: show('__reduce__', lambda: C((5,)).__reduce__()[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__reduce__', lambda: C((5,)).__reduce__()[1])")
try: show('sched_setparam', lambda: os.sched_setparam(0, C((0,))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('sched_setparam', lambda: os.sched_setparam(0, C((0,))))")

try: print('--- among the bases, but not in the line of __base__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- among the bases, but not in the line of __base__'")


try:
    class Plain:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain:')


try:
    class Both(Plain, datetime.tzinfo):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Both(Plain, datetime.tzinfo):')


try: print('Both.__base__.__name__ =>', Both.__base__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Both.__base__.__name__')
try: print('[c.__name__ for c in Both.__mro__] =>', [c.__name__ for c in Both.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Both.__mro__]')
try: show('no arguments', lambda: type(Both()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no arguments', lambda: type(Both()).__name__)")
try: show('arguments', lambda: Both(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('arguments', lambda: Both(1))")
try: show('utcoffset', lambda: Both().utcoffset(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('utcoffset', lambda: Both().utcoffset(None))")


try:
    class BothWithInit(Plain, datetime.tzinfo):
        def __init__(self, a):
            self.a = a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BothWithInit(Plain, datetime.tzinfo):')


try: show('arguments', lambda: BothWithInit(1).a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('arguments', lambda: BothWithInit(1).a)")


try:
    class DictFirst(dict, Plain):
        __new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DictFirst(dict, Plain):')


try: show('object.__new__ in a class derived from dict', lambda: (DictFirst(), DictFirst(a=1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('object.__new__ in a class derived from dict', lambda: (DictFirs...")

try: print('--- one that is written into a built-in type')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- one that is written into a built-in type'")
try:
    for name, other in (('dict', dict.__new__), ('stat_result', os.stat_result.__new__), ('sched_param', os.sched_param.__new__), ('tuple', tuple.__new__), ('object', object.__new__),
            ('struct_time', time.struct_time.__new__), ('int', int.__new__)):
        try: original = os.terminal_size.__dict__['__new__']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: original = os.terminal_size.__dict__['__new__']")
        try: os.terminal_size.__new__ = other
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = other')
        try: show(name, lambda: (os.terminal_size((1, 2)), type(os.terminal_size((1, 2))).__name__, len(os.terminal_size((1, 2))), os.terminal_size((1, 2)).lines))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, lambda: (os.terminal_size((1, 2)), type(os.terminal_size((...')
        try: show(name, lambda: os.terminal_size((1, 2, 3)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, lambda: os.terminal_size((1, 2, 3)))')
        try: show(name, lambda: os.terminal_size())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, lambda: os.terminal_size())')
        try: os.terminal_size.__new__ = original
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = original')
        try: show('back', lambda: os.terminal_size((1, 2)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('back', lambda: os.terminal_size((1, 2)))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, other in (('dict', dict.__new__), ('stat_result', os.stat_r...")
try: os.terminal_size.__new__ = lambda cls, *args: ('written in Python', cls.__name__, args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: os.terminal_size.__new__ = lambda cls, *args: ('written in Python', c...")
try: show('a function', lambda: os.terminal_size((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a function', lambda: os.terminal_size((1, 2)))")
try: os.terminal_size.__new__ = original
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: os.terminal_size.__new__ = original')
try: original = struct.error.__dict__.get('__new__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: original = struct.error.__dict__.get('__new__')")
try: struct.error.__new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: struct.error.__new__ = dict.__new__')
try: show('an exception of a module', lambda: (struct.error('x'), struct.error('x').args))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an exception of a module', lambda: (struct.error('x'), struct.e...")
try: del struct.error.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del struct.error.__new__')
try: show('back', lambda: struct.error('x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('back', lambda: struct.error('x'))")

try: print('--- names that mean nothing')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- names that mean nothing'")
try:
    for name in ('__asyncgen_hooks_type__', '__unraisable_hook_args_type__'):
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('hasattr(sys, name) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', hasattr(sys, name))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(sys, name)')
        try: setattr(sys, name, int)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(sys, name, int)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('__asyncgen_hooks_type__', '__unraisable_hook_args_type_...")
try: show('get_asyncgen_hooks', sys.get_asyncgen_hooks)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('get_asyncgen_hooks', sys.get_asyncgen_hooks)")


try:
    class Raises:
        def __del__(self):
            raise ValueError('in __del__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')


try: sys.unraisablehook = lambda args: print('unraisable', type(args).__name__, len(args), args.exc_type.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.unraisablehook = lambda args: print('unraisable', type(args).__na...")
try: Raises()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Raises()')
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: sys.unraisablehook = sys.__unraisablehook__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = sys.__unraisablehook__')
try: show('unraisablehook', sys.__unraisablehook__, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('unraisablehook', sys.__unraisablehook__, 5)")
try: show('excepthook', _thread._excepthook, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('excepthook', _thread._excepthook, 5)")
