# The metaclass of Array, for a class that is not derived from Array: its instances are plain objects, and have no raw and no value. (CPython reads them as arrays.)
import ctypes


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


for item in (ctypes.c_char, ctypes.c_wchar):
    class T(metaclass=type(ctypes.Array)):
        _type_ = item
        _length_ = 4
    t = T()
    print(T.__mro__, ctypes.sizeof(T), sorted(n for n in vars(T) if n in ('raw', 'value')))
    print(attempt(lambda: t.raw), '|', attempt(lambda: t.value))
    print(attempt(lambda: setattr(t, 'raw', b'x')), '|', attempt(lambda: setattr(t, 'value', b'y')), '|', vars(t))
    real = item * 4
    for name in ('raw', 'value'):
        if name in vars(real):
            print(name, attempt(lambda: vars(real)[name].__get__(t)), '|', attempt(lambda: vars(real)[name].__set__(t, b'x')))

# With Array, or with any class of ctypes, for a base they are there.
class A(ctypes.Array):
    _type_ = ctypes.c_char
    _length_ = 4
a = A(b'a', b'b')
print(a.raw, a.value)
class Both(type(ctypes.Array), type(ctypes.Structure)):
    pass
class S(ctypes.Structure, metaclass=Both):
    _type_ = ctypes.c_char
    _length_ = 4
s = S()
s.raw = b'ab'
print(s.raw, s.value, ctypes.sizeof(s))
