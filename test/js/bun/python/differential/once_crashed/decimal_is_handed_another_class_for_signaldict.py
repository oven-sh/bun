# While it is imported, _decimal makes a class from collections.abc.MutableMapping by a call of type(): so Python code makes it, and hands back what it likes. The
# traps and flags of every Context were made as instances of that, whatever it was. (CPython itself dies in most of these.)
import collections.abc
import sys

for name, handed in (('list', list), ('dict', dict), ('int', int), ('str', str), ('object', object), ('type', type), ('Exception', Exception), ('five', 5), ('None', None)):
    class Meta(type):
        def __new__(meta, name, bases, namespace):
            if name == 'SignalDict':
                return handed
            return super().__new__(meta, name, bases, namespace)

    class Fake(metaclass=Meta): pass

    collections.abc.MutableMapping = Fake
    for module in ('_decimal', 'decimal'):
        sys.modules.pop(module, None)
    try:
        import _decimal
        context = _decimal.Context()
        print(name, type(context.traps), repr(context.traps)[:40], flush=True)
        context.traps.append(1)
    except Exception as error:
        print(name, type(error).__name__, error)

# A class of the program's own that is derived from the mixin as well is as good as the one asked for.
class Keeps(type):
    def __new__(meta, name, bases, namespace):
        return super().__new__(meta, 'Mine' if name == 'SignalDict' else name, bases, namespace)

class Plain(metaclass=Keeps):
    def __repr__(self): return 'mine'

collections.abc.MutableMapping = Plain
sys.modules.pop('_decimal', None)
import _decimal
context = _decimal.Context()
print(type(context.traps).__name__, [c.__name__ for c in type(context.traps).__mro__], context.traps[_decimal.Inexact], len(context.traps), repr(context.traps))
