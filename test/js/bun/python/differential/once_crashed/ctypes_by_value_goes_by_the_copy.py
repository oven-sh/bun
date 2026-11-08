# A structure passed by value is passed as a copy. How many bytes of it C is handed goes by the class by which the copy was made.
import gc
import threading
from ctypes import *

libc = CDLL(None)

class One(Structure):
    _fields_ = [('a', c_char)]
class Large(Structure):
    _fields_ = [('a', c_char * 400)]
class TooLarge(Structure):
    _fields_ = [('a', c_char * 800)]

# What is made of the argument is found while a later argument is converted, and passed again when the instance has another class.
def found_for(x):
    gc.collect()
    found = []
    class Later:
        @property
        def _as_parameter_(self):
            found.extend(o for o in gc.get_objects() if type(o).__name__ == 'CArgObject')
            return 0
    libc.abs(x, Later())
    return found
for other in (Large, TooLarge):
    x = (c_char * 800)()
    x.__class__ = One
    found = found_for(x)
    print(len(found), found[0]._obj.__class__.__name__)
    found = found[0]
    x.__class__ = other
    try:
        print(other.__name__, type(libc.abs(found)).__name__)
    except Exception as e:
        print(other.__name__, type(e).__name__, e)
    del found

# _fields_ is being assigned, and code that runs in there makes an instance. As in CPython the class has its fields and its size all the same; the instance has what it was made with.
class Meta(type(Structure)):
    act = None
    def __setattr__(cls, name, value):
        if name == 'a':
            Meta.act(cls)
        super().__setattr__(name, value)
def assign(cls):
    try:
        cls._fields_ = [('a', c_char * 800)]
        return 'assigned'
    except AttributeError as e:
        return 'AttributeError %s' % e
class Late(Structure, metaclass=Meta):
    pass
made = []
Meta.act = lambda cls: made.append(cls())
print(assign(Late))
print(sizeof(Late), sizeof(made[0]), len(bytes(made[0])), len(bytes(Late())))

# The same in another thread, between the copy and the call.
class Later(Structure, metaclass=Meta):
    pass
begun, copied = threading.Event(), threading.Event()
def wait(cls):
    begun.set()
    copied.wait()
Meta.act = wait
result = []
thread = threading.Thread(target=lambda: result.append(assign(Later)))
thread.start()
begun.wait()
class Finishes:
    @property
    def _as_parameter_(self):
        copied.set()
        thread.join()
        return 0
try:
    print(type(libc.abs(Later(), Finishes())).__name__)
except Exception as e:
    print(type(e).__name__, e)
print(result, sizeof(Later))
print('END')
