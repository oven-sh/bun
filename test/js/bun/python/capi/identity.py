# id() is the address that C has for the object. For a built-in type that is the address of a symbol (&PyLong_Type), at all times.
types = [object, bool, bytearray, bytes, complex, dict, enumerate, filter, float, frozenset, list, int, map, memoryview, property, range, reversed, set, slice, super, tuple, type, str, zip]
at_first = [id(t) for t in types]

import _ctypes, copy, ctypes, gc, pickle, sys, weakref
from ctypes import Union, c_ulong, c_void_p, cast, py_object

print("after ctypes was imported:", [id(t) for t in types] == at_first)
written_early = [py_object(t) for t in types]
lib = ctypes.PyDLL(sys.argv[1])
lib.addresses.restype = lib.types.restype = py_object
lib.address_of.restype = c_ulong
lib.address_of.argtypes = [py_object]
print("after a library was loaded:", [id(t) for t in types] == at_first)
print("where C has them:", lib.addresses() == at_first)
print("after C was called:", [id(t) for t in types] == at_first)
print("what C has there:", all(a is b for a, b in zip(lib.types(), types)), len(lib.types()) == len(types))
print("each its own:", len(set(at_first)) == len(types))


class Class:
    pass


class Both(Union):
    _fields_ = [("object", py_object), ("address", c_void_p)]


def bits(holder):
    return c_void_p.from_buffer(holder).value


instance = Class()
others = [Class, instance, None, True, False, 5, 2**70, 1.5, 0.0, (), [], {}, b"bytes", len, Ellipsis, NotImplemented, ValueError, type(iter([])), type(None)]
print("the bits of a py_object:", all(bits(py_object(x)) == id(x) for x in types + others))
print("written early:", all(bits(holder) == id(t) for holder, t in zip(written_early, types)))
print("in a union:", all(Both(x).address == id(x) for x in types + others))
print("as C is handed it:", all(lib.address_of(x) == id(x) for x in types + others))
print("and back:", all(cast(id(x), py_object).value is x for x in types + others))
print("and back:", all(_ctypes.PyObj_FromPtr(id(x)) is x for x in types + others))

print("--- what goes by identity finds the same type")
print(all(pickle.loads(pickle.dumps(t)) is t for t in types))
print(all(copy.copy(t) is t and copy.deepcopy(t) is t for t in types))
print(all(weakref.ref(t)() is t for t in types))
print(all({t: 1}[t] == 1 and hash(t) == hash(t) for t in types))
print([id(t) for t in types] == at_first)

print("--- no other object is where a type is")
where = set(at_first)
many = [Class() for i in range(20000)] + [[i] for i in range(20000)] + [type(f"C{i}", (), {}) for i in range(500)]
print(any(id(x) in where for x in many), sum(id(x) in where for x in gc.get_objects()) <= len(types))
