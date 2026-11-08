# ctypes remembers its array types in a dict, and gc.get_objects() hands out every dict. What lies there is looked at before it is believed.
import gc, weakref
from ctypes import *

class Item(Structure): _fields_ = [('x', c_int)]
first = Item * 3
caches = [d for d in gc.get_objects() if type(d) is dict and (Item, 3) in d]
print('dicts that have the key:', len(caches))
class Other: pass
other = Other()
for name, value in (('an object', object()), ('an int', 5), ('None', None), ('a str', 'text'), ('a weak reference to something else', weakref.ref(other)), ('a weak reference to a class', weakref.ref(Other)),
                    ('a weak reference to another array type', weakref.ref(Item * 4)), ('a weak reference to a structure', weakref.ref(Item)), ('the type itself', first)):
    for cache in caches: cache[(Item, 3)] = value
    made = Item * 3
    print('%-40s %s %d %s' % (name, made.__name__, made._length_, made._type_ is Item), len(made()))
print('and it is remembered again:', Item * 3 is made)

# What is written down beside the memory of an instance is not among what gc hands out.
class Thing: pass
thing = Thing()
several = (py_object * 3)(thing, thing, thing)
print('who refers to the object of three items:', sorted(set(type(r).__name__ for r in gc.get_referrers(thing) if r is not globals())))
pointers = (POINTER(c_int) * 3)(pointer(c_int(1)), pointer(c_int(2)), pointer(c_int(3)))
odd = [o for o in gc.get_objects() if type(o) is list and any(type(item).__name__ in ('JSObject', 'JSCell') for item in o)]
print('lists of things that are no objects of Python:', len(odd))
