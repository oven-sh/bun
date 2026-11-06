# id() is the address that C has for the object. For a built-in type that is the address of a symbol (&PyLong_Type), at all times.
types = [object, bool, bytearray, bytes, complex, dict, enumerate, filter, float, frozenset, list, int, map, memoryview, property, range, reversed, set, slice, super, tuple, type, str, zip]
at_first = [id(t) for t in types]

import _ctypes, builtins, copy, ctypes, gc, os, pickle, re, sys, types as types_module, weakref
from ctypes import Union, c_char, c_int, c_long, c_ulong, c_void_p, cast, py_object

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

print("--- every symbol that stands for a type")
program = ctypes.CDLL(None)
lib.address_of_first.restype = c_ulong
lib.address_of_first.argtypes = [py_object]
with_symbols = {
    "PyBaseObject_Type": object, "PyBool_Type": bool, "PyByteArrayIter_Type": type(iter(bytearray())), "PyByteArray_Type": bytearray, "PyBytesIter_Type": type(iter(b"")),
    "PyBytes_Type": bytes, "PyCFunction_Type": type(len), "PyCallIter_Type": type(iter(int, 1)), "PyClassMethodDescr_Type": type(dict.__dict__["fromkeys"]),
    "PyComplex_Type": complex, "PyDictItems_Type": type({}.items()), "PyDictIterItem_Type": type(iter({}.items())), "PyDictIterKey_Type": type(iter({})),
    "PyDictIterValue_Type": type(iter({}.values())), "PyDictKeys_Type": type({}.keys()), "PyDictProxy_Type": type(int.__dict__),
    "PyDictRevIterItem_Type": type(reversed({}.items())), "PyDictRevIterKey_Type": type(reversed({})), "PyDictRevIterValue_Type": type(reversed({}.values())),
    "PyDictValues_Type": type({}.values()), "PyDict_Type": dict, "PyEllipsis_Type": type(...), "PyEnum_Type": enumerate, "PyFilter_Type": filter, "PyFloat_Type": float,
    "PyFrozenSet_Type": frozenset, "PyGetSetDescr_Type": types_module.GetSetDescriptorType, "PyListIter_Type": type(iter([])), "PyListRevIter_Type": type(reversed([])),
    "PyList_Type": list, "PyLongRangeIter_Type": type(iter(range(2**70))), "PyLong_Type": int, "PyMap_Type": map, "PyMemberDescr_Type": types_module.MemberDescriptorType,
    "PyMemoryView_Type": memoryview, "PyMethodDescr_Type": type(str.join), "PyModule_Type": type(sys), "PyProperty_Type": property, "PyRangeIter_Type": type(iter(range(1))),
    "PyRange_Type": range, "PyReversed_Type": reversed, "PySeqIter_Type": type(iter(type("S", (), {"__getitem__": None})())), "PySetIter_Type": type(iter(set())),
    "PySet_Type": set, "PySlice_Type": slice, "PySuper_Type": super, "PyTraceBack_Type": types_module.TracebackType, "PyTupleIter_Type": type(iter(())), "PyTuple_Type": tuple,
    "PyType_Type": type, "PyUnicodeIter_Type": type(iter("\u20ac")), "PyUnicode_Type": str, "PyWrapperDescr_Type": type(int.__add__), "PyZip_Type": zip,
    "Py_GenericAliasType": type(list[int]), "_PyWeakref_CallableProxyType": weakref.CallableProxyType, "_PyWeakref_ProxyType": weakref.ProxyType,
    "_PyWeakref_RefType": weakref.ref,
}  # fmt: skip
declared = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "include", "declarations.h")).read()
print(sorted(with_symbols) == sorted(re.findall(r"\b(\w+Type)[,;]", declared)))
exceptions = {name: getattr(builtins, name) for name in re.findall(r"\*PyExc_(\w+)", declared)}
where_c_has = {t: ctypes.addressof(c_char.in_dll(program, name)) for name, t in with_symbols.items()}
where_c_has_exceptions = {name: c_void_p.in_dll(program, f"PyExc_{name}").value for name in exceptions}
print(len(with_symbols), len(set(where_c_has.values())), len(exceptions), len(set(where_c_has_exceptions.values())))
print([t for t, address in where_c_has.items() if not address == id(t) == bits(py_object(t)) == lib.address_of(t) == lib.address_of_first([t])])
print([name for name, address in where_c_has_exceptions.items() for t in [exceptions[name]] if not address == id(t) == bits(py_object(t)) == lib.address_of(t) == lib.address_of_first([t])])
print(all(cast(address, py_object).value is t for t, address in where_c_has.items()), all(cast(address, py_object).value is exceptions[name] for name, address in where_c_has_exceptions.items()))

print("--- the hash that object gives follows id()")
print([x for x in types + others + list(with_symbols.values()) + list(exceptions.values()) if type(x).__hash__ in (object.__hash__, type.__hash__) and hash(x) % 2**64 != (id(x) >> 4 | id(x) << 60) % 2**64])

print("--- an int is one object to C however it was worked out")
lib.is_the_int.argtypes = [py_object, c_long]
lib.is_the_int.restype = c_int
big = 2**40
for x, number in (((big + 5) - big, 5), (2**31 - (2**31 - 7), 7), (big * 3 // big, 3), (int(1e3) // 10, 100), (-(big + 1) + big, -1), (big - big, 0), (0 * -1, 0)):
    print(number, x is number, id(x) == id(number), bits(py_object(x)) == id(number), lib.address_of(x) == id(number), lib.address_of_first([x]) == id(number), lib.is_the_int(x, number))

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
