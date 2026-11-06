# An implementation has types of its own, which no program is to see: object.__subclasses__(), followed to the end, does not know them. Nothing that gc hands out leads to one:
# not the type, not an instance, not the tuples of its bases and its MRO, not a method or a descriptor of its namespace.
import gc, sys
import asyncio, csv, ctypes, datetime, decimal, os, select, signal, time, _thread

def known_types():
    seen = {}; todo = [object]
    while todo:
        t = todo.pop()
        if id(t) not in seen:
            seen[id(t)] = t; todo.extend(type.__subclasses__(t))
    return seen
known = known_types()
def unknown(t):
    if not isinstance(t, type) or id(t) in known: return False
    known.update(known_types())         # To look at an object may import a module.
    return id(t) not in known
def ways(objects):
    found = set()
    for x in objects:
        if unknown(x): found.add('%r itself' % x)
        if unknown(type(x)): found.add('an instance of %r' % type(x))
        if type(x) in (tuple, list):
            for item in x:
                if unknown(item): found.add('%r in a %s of %d' % (item, type(x).__name__, len(x)))
        for name in ('__objclass__', '__self__', '__wrapped__', '__func__'):
            try: y = getattr(x, name)
            except BaseException: continue
            if unknown(y): found.add('%r, %s of a %s' % (y, name, type(x).__name__))
            elif unknown(type(y)): found.add('an instance of %r, %s of a %s' % (type(y), name, type(x).__name__))
    return sorted(found)
print('by gc.get_objects():', ways(gc.get_objects()))
print('by gc.get_referrers(object):', ways(gc.get_referrers(object)))
print('by gc.get_referrers(type):', ways(gc.get_referrers(type)))
print('by gc.get_referents(object):', ways(gc.get_referents(object)))
# Three levels down from all that gc.get_objects() gives.
level = gc.get_objects(); seen = {id(x) for x in level}; found = set()
for depth in range(3):
    below = []
    for x in level:
        for y in gc.get_referents(x):
            if id(y) not in seen:
                seen.add(id(y)); below.append(y)
    found.update(ways(below)); level = below
print('by gc.get_referents(), three levels down from gc.get_objects():', sorted(found))
# A class refers weakly to the classes that derive from it.
class C: pass
class D(C): pass
print('a class among the referrers of one that derives from it:', any(x is object for x in gc.get_referrers(int)), any(x is C for x in gc.get_referrers(D)))
# What belongs to any other type is given as ever.
print('__mro__ and __bases__ of a class among the referrers of the class:', any(x is D.__mro__ for x in gc.get_referrers(D)), any(x is D.__bases__ for x in gc.get_referrers(C)))
print('a method descriptor among the referents of the namespace of its class:', any(x is list.append for x in gc.get_referents(gc.get_referents(list.__dict__)[0])))
