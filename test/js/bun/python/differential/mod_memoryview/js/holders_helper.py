# Called from holders.js.
import ctypes, weakref
b = bytearray(b'abc')
last = None
def view():
    global last
    v = memoryview(b)
    last = weakref.ref(v)
    return v
def instance():
    global last
    last = None
    return (ctypes.c_char * 3).from_buffer(b)
def blocked():
    try:
        b.append(0)
    except BufferError:
        return True
    b.pop()
    return False
# Whether the view that was handed out last, if it is still there, has been taken from whoever has it.
def released():
    v = last and last()
    if v is None:
        return False
    try:
        v[0]
    except ValueError:
        return True
    return False
