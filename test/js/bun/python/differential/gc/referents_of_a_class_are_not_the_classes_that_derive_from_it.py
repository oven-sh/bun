# A class does not hold on to the classes that derive from it, so gc.get_referents() does not mention them, nor the weak references by which it knows them. Where the runtime has types of its own
# that derive from object, for what modules written in C++ keep, they are not to be had that way either: whoever has one can write into what the runtime trusts.
import gc, os, signal, sys, time, weakref, _thread


class Base:
    pass


class Derived(Base):
    pass


def names(objects):
    return sorted({x.__name__ for x in objects if isinstance(x, type)})


def reached(roots, depth):
    seen = {}
    todo = list(roots)
    for _ in range(depth):
        found = []
        for x in todo:
            for y in gc.get_referents(x):
                if id(y) not in seen:
                    seen[id(y)] = y
                    found.append(y)
        todo = found
    return list(seen.values())


print('classes among the referents of Base:', names(gc.get_referents(Base)))
print('weak references among them:', sum(isinstance(x, weakref.ReferenceType) for x in gc.get_referents(Base)))
print('Base.__subclasses__():', names(Base.__subclasses__()))
built_in = [object, type, int, str, tuple, list, dict, set, BaseException, Exception]
print('classes that derive from them among the referents of built-in types:', [t.__name__ for t in built_in if any(isinstance(x, type) and x is not t and issubclass(x, t) and t is not object for x in gc.get_referents(t))])
everything = reached(built_in + [os, signal, sys, time, _thread, gc], 3)
print('types whose name begins with an underscore and that no module has:', sorted({x.__name__ for x in everything if isinstance(x, type) and x.__name__ == '_state'}))
print('instances of such types:', sorted({type(x).__name__ for x in everything if type(x).__name__ == '_state'}))
