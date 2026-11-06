# The dict of any class can come into the hands of the program, and gc.get_referents(object) hands out types that Python was never to see.
# Whatever is written there, what a struct sequence is made of and which types the runtime makes are not taken from it on trust.
import gc, grp, os, pwd, resource, shutil, signal, sys, threading, time


class Door:
    def __ror__(self, other):
        return other


def real(cls):
    return cls.__dict__ | Door()


def forget(cls):
    type.__dict__['__abstractmethods__'].__set__(cls, ())
    del real(cls)['__abstractmethods__']


class Names(type):
    def mro(cls):
        return [cls, os.terminal_size, tuple, object]


class C(tuple, metaclass=Names):
    pass


def f(*args, **keywords):
    return 42


def use(make):
    for arguments in ((), ((1, 2),), ((1, 2, 3),)):
        try:
            x = make(*arguments)
            tuple.__repr__(x), len(x), x.columns, x.lines, x.__reduce__(), hash(x), list(x), x == x
        except Exception:
            pass


print('--- the __new__ of tuple, for a class that only names a struct sequence')
original = real(tuple)['__new__']
for name, value in (('5', 5), ('1.5', 1.5), ('None', None), ('a str', 'x'), ('an object', object()), ('C', C), ('f', f), ('staticmethod', staticmethod(f)), ('len', len), ('tuple.__len__', tuple.__len__),
                    ('dict.__new__', dict.__new__), ('int.__new__', int.__new__), ('list.__new__', list.__new__), ('type.__new__', type.__new__), ('sched_param.__new__', os.sched_param.__new__)):
    for hears in (True, False):
        real(tuple)['__new__'] = value
        if hears:
            forget(tuple)
        use(C)
        use(lambda *arguments: os.terminal_size.__new__(C, *arguments))
        real(tuple)['__new__'] = original
        forget(tuple)
    print(name, 'is over')
del real(tuple)['__new__']
forget(tuple)
use(C)
real(tuple)['__new__'] = original
forget(tuple)
print('deleted is over')
print(tuple(C((1, 2))), os.terminal_size((1, 2)))

print('--- the types that the runtime finds again')


def makers():
    hooks = []
    threading.excepthook = hooks.append
    thread = threading.Thread(target=lambda: 1 / 0)
    thread.start()
    thread.join()
    threading.excepthook = threading.__excepthook__
    return [type(x).__name__ for x in (os.stat('/'), os.statvfs('/'), os.uname(), os.times(), os.sched_getparam(0), shutil.get_terminal_size(), resource.getrusage(0), pwd.getpwuid(0), grp.getgrgid(0),
                                       time.gmtime(0), time.localtime(0), time.strptime('2020', '%Y'), sys.get_asyncgen_hooks(), hooks[0])]


before = makers()
for hidden in [t for t in gc.get_referents(object) if isinstance(t, type) and t.__name__ == '_state']:
    namespace = real(hidden)
    for key, value in list(namespace.items()):
        # (locale.Error is kept there too, and is still taken on trust.)
        if isinstance(value, type) and issubclass(value, tuple):
            for other in (5, None, 'x', [], int, tuple, os.terminal_size, time.struct_time):
                namespace[key] = other
                try:
                    makers()
                except Exception:
                    pass
            namespace[key] = value
print(makers() == before, before)
