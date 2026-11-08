# ctypes.cast(id(o), ctypes.py_object).value is o, for every kind of object.
import ctypes, gc

class C:
    pass

def back(o):
    try:
        return ctypes.cast(id(o), ctypes.py_object).value is o
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)

made = ''.join(['made ', 'at ', 'run ', 'time'])
for o in ('abc', 'x', '', 'é' * 3, '\U0001f600', made, made[5:7], made * 100, str(12345), C.__name__, 'a,b'.split(',')[1], b'ab', bytearray(b'c'), 5, 10 ** 30, -1, 1.5, None, True, (1, 2), (), [1], {1: 2}, {1}, C(), C,
          len, ctypes, 3 + 4j, frozenset(), range(3), Ellipsis, NotImplemented, type, object(), back, C.__dict__, iter([]), memoryview(b'')):
    print(type(o).__name__, back(o))

# Through memory, too.
holder = ctypes.py_object(made)
print(holder.value is made)
address = ctypes.c_void_p(id(made))
print(ctypes.py_object.from_buffer(address).value is made)
gc.collect()
print(back(made), back('abc'))

# The id() of a str that has been put together from others stays what it is when the str is read.
left, right = 'x' * 50 + str(len(made)), 'y' * 50 + str(len(made))
joined = left + right
before = id(joined)
hash(joined)
print(id(joined) == before, back(joined))
another = left + right + left
registry = {id(another): another}
another.encode()
print(id(another) in registry, back(another))
third = right + left
print(back(third), third == 'q', back(third))
