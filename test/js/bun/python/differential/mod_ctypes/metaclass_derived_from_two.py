# A metaclass derived from two of ctypes' has the methods of both. What those of the metaclass of pointers do with a class that is no pointer, where CPython
# does something: it goes by what is in the place of the type pointed to.
import _ctypes
from ctypes import *

PointerMeta = type(_ctypes._Pointer)


def attempt(what, function):
    try:
        result = function()
        print(what, '|', result if isinstance(result, (int, type(None), type)) else type(result).__name__)
    except Exception as error:
        print(what, '|', type(error).__name__, error)


class ArrayAndPointer(type(Array), PointerMeta): pass
class A(Array, metaclass=ArrayAndPointer):
    _type_ = c_int
    _length_ = 2
for name, value in (('A', A(1, 2)), ('c_int', c_int(3)), ('c_int * 2', (c_int * 2)()), ('pointer', pointer(c_int(1))), ('None', None), ('5', 5), ('c_long', c_long(1))):
    attempt('an array, from_param ' + name, lambda: PointerMeta.from_param(A, value))
attempt('an array, its own from_param', lambda: A.from_param(A()))

class StructureAndPointer(type(Structure), PointerMeta): pass
class S(Structure, metaclass=StructureAndPointer):
    _fields_ = [('a', c_int)]
for name, value in (('S', S()), ('None', None), ('5', 5)):
    attempt('a structure, from_param ' + name, lambda: PointerMeta.from_param(S, value))
attempt('a structure, set_type', lambda: PointerMeta.set_type(S, c_int))
attempt('a structure, _type_', lambda: S._type_)
attempt('a structure, a field', lambda: S(4).a)
attempt('a structure, sizeof', lambda: sizeof(S))
attempt('a structure, set_type 5', lambda: PointerMeta.set_type(S, 5))
for name, value in (('S', S()), ('c_int', c_int(3)), ('None', None), ('5', 5)):
    attempt('a structure with a type, from_param ' + name, lambda: PointerMeta.from_param(S, value))

class UnionAndPointer(type(Union), PointerMeta): pass
class U(Union, metaclass=UnionAndPointer):
    _fields_ = [('a', c_int), ('b', c_double)]
attempt('a union, set_type', lambda: PointerMeta.set_type(U, c_int))
attempt('a union, _type_', lambda: U._type_)
attempt('a union, sizeof', lambda: sizeof(U))

class FunctionAndPointer(type(CFUNCTYPE(None)), PointerMeta): pass
class F(_ctypes.CFuncPtr, metaclass=FunctionAndPointer):
    _flags_ = 1
    _restype_ = None
attempt('a function, from_param 5', lambda: PointerMeta.from_param(F, 5))
attempt('a function, set_type', lambda: PointerMeta.set_type(F, c_int))
attempt('a function, _type_', lambda: F._type_)
attempt('a function, called', lambda: F(lambda: None)())

class SimpleAndPointer(type(c_int), PointerMeta): pass
class I(_ctypes._SimpleCData, metaclass=SimpleAndPointer):
    _type_ = 'i'
for name, value in (('I', I()), ('None', None), ('5', 5)):
    attempt('a simple type, from_param ' + name, lambda: PointerMeta.from_param(I, value))

# _fields_ once there has been an instance.
class SimpleAndStructure(type(c_int), type(Structure)): pass
class J(_ctypes._SimpleCData, metaclass=SimpleAndStructure):
    _type_ = 'i'
J()
attempt('a simple type, _fields_ after an instance', lambda: setattr(J, '_fields_', [('a', c_int)]))
