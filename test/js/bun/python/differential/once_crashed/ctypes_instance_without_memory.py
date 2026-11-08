# An instance of ctypes that has no memory: nobody gets to see one.
import gc
import warnings
from ctypes import *

seen = []
def look(self, where):
    try:
        seen.append((where, type(self).__name__, len(bytes(self))))
    except Exception as e:
        seen.append((where, type(self).__name__, type(e).__name__, str(e)))

class S(Structure):
    _fields_ = [('a', c_int), ('b', c_int)]
    def __del__(self):
        look(self, '__del__')

def attempt(what, act):
    try:
        r = act()
        print(what, '|', type(r).__name__)
        del r
    except Exception as e:
        print(what, '|', type(e).__name__, e)
    gc.collect()
    print('   ', seen)
    seen.clear()

# Refused: beyond what the pointer points into. No instance is made, so none is finalized.
two = (S * 2)()
p = cast(two, POINTER(S))
attempt('p[0]', lambda: p[0])
attempt('p[1]', lambda: p[1])
attempt('p[2]', lambda: p[2])
attempt('p[-1]', lambda: p[-1])
class Wide(Structure):
    _fields_ = [('a', c_int * 100)]
    def __del__(self):
        look(self, '__del__')
w = cast(two, POINTER(Wide))
attempt('w.contents', lambda: w.contents)
attempt('w[0]', lambda: w[0])
attempt('null.contents', lambda: POINTER(S)().contents)
attempt('from_buffer, too small', lambda: Wide.from_buffer(bytearray(8)))
attempt('from_buffer', lambda: S.from_buffer(bytearray(8)))
attempt('from_buffer_copy, too small', lambda: Wide.from_buffer_copy(bytes(8)))

# A key that is no str in the dict of the class is asked whether it is '__del__' when an instance is made, and looks for instances.
class Key:
    on = False
    def __hash__(self):
        return hash('__del__')
    def __eq__(self, other):
        if Key.on:
            Key.on = False
            seen.append('asked')
            for o in gc.get_objects():
                if type(o).__name__ == 'K':
                    look(o, 'key')
        return False
def fresh():
    return type(Structure)('K', (Structure,), {'_fields_': [('a', c_int)], Key(): 1})
memory = bytearray(4)
four = c_int()
warnings.simplefilter('ignore')
for what, act in (('K()', lambda K: K()), ('array[1]', lambda K: (K * 2)()[1]), ('pointer[1]', lambda K: cast((K * 2)(), POINTER(K))[1]), ('pointer.contents', lambda K: cast((K * 2)(), POINTER(K)).contents),
                  ('from_buffer', lambda K: K.from_buffer(memory)), ('from_buffer_copy', lambda K: K.from_buffer_copy(memory)), ('from_address', lambda K: K.from_address(addressof(four))),
                  ('a field', lambda K: type(Structure)('Outer', (Structure,), {'_fields_': [('k', K)]})().k), ('in_dll', lambda K: K.in_dll(CDLL(None), 'environ'))):
    K = fresh()
    Key.on = True
    attempt(what, lambda: act(K))
    Key.on = False

# Memory that is not to be had. The class is given a __del__ afterwards, and the instances that there are get it: there is none.
class Big(Structure):
    _fields_ = [('a', c_char * 2 ** 62)]
try:
    Big()
except MemoryError:
    print('MemoryError')
finalized = []
Big.__del__ = lambda self: finalized.append(addressof(self))
gc.collect()
gc.collect()
print('finalized', finalized)

# The address 0 is the program's own doing. (CPython ends here.)
zero = c_int.from_address(0)
for what, act in (('bytes', lambda: bytes(zero)), ('memoryview', lambda: memoryview(zero)), ('value', lambda: zero.value)):
    try:
        print(what, act())
    except ValueError as e:
        print(what, 'ValueError', e)
print('END')
