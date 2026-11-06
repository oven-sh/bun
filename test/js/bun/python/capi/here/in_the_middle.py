# An address in the middle of a symbol stands for no object. CPython follows it.
import _ctypes, ctypes
from ctypes import c_char, cast, py_object

symbols = [id(int), id(ValueError), ctypes.addressof(c_char.in_dll(ctypes.CDLL(None), "_Py_NoneStruct"))]
print([cast(address, py_object).value for address in symbols])
for address in symbols:
    for offset in (1, 8, 15):
        for get in (lambda a: cast(a, py_object).value, _ctypes.PyObj_FromPtr):
            try:
                print(get(address + offset))
            except ValueError as e:
                print(type(e).__name__, e)
