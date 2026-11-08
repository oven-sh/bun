# The result of cast() keeps the source alive if it points into it. Code of the program runs between the taking of the address and the making of the result: where the other two arguments
# are converted, their __class__ is asked for. There the source is given another class, by which the result need not keep it. (CPython goes by what the source has kept, and reads memory that it has freed.)
import ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def fresh(letter):
    return bytes(bytearray(letter * 3000))


def churn():
    for i in range(4):
        gc.collect()
    return [fresh(b'j') for i in range(3000)] + [ctypes.create_string_buffer(4096) for i in range(4000)]


def look(result, identity):
    kept = result._objects
    print(type(kept).__name__, isinstance(kept, dict) and identity in [id(value) for value in kept.values()])
    junk = churn()
    print(attempt(lambda: result[0][:8]))
    result[1] = b'written'
    print(sum(1 for other in junk if isinstance(other, ctypes.Array) and any(other.raw[:16])))


def source_of(cls, letter):
    source = cls(fresh(letter))
    ctypes.resize(source, 4096)
    source.__class__ = ctypes.c_char_p * 512
    return source


print('--- the metaclass of the type of the result has a property __class__')
sources = []
class Meta(type(ctypes._Pointer)):
    @property
    def __class__(cls):
        if sources:
            sources.pop().__class__ = ctypes.c_char_p
        return Meta
class Target(ctypes._Pointer, metaclass=Meta):
    _type_ = ctypes.c_char_p
def make():
    sources.append(source_of(ctypes.c_char_p, b'A'))
    identity = id(sources[0])
    result = ctypes.cast(sources[0], Target)
    print(len(sources))
    return result, identity
look(*make())

print('--- the class of the source has one, which acts when it is asked the second time')
asked = []
class Array(ctypes.c_char_p * 512):
    @property
    def __class__(self):
        asked.append(self)
        if len(asked) == 2:
            object.__dict__['__class__'].__set__(self, ctypes.c_char_p)
        return Array
def make():
    source = ctypes.c_char_p(fresh(b'B'))
    ctypes.resize(source, 4096)
    source.__class__ = Array
    result = ctypes.cast(source, ctypes.POINTER(ctypes.c_char_p))
    print(len(asked) >= 2, type(source).__name__)
    asked.clear()
    return result, id(source)
look(*make())

print('--- the source is resized there: the result points to where it was')
class Meta(type(ctypes._Pointer)):
    @property
    def __class__(cls):
        if sources:
            source = sources.pop()
            ctypes.resize(source, 1 << 20)
            source.__class__ = ctypes.c_char_p
        return Meta
class Target(ctypes._Pointer, metaclass=Meta):
    _type_ = ctypes.c_char_p
def make():
    sources.append(source_of(ctypes.c_char_p, b'C'))
    identity = id(sources[0])
    result = ctypes.cast(sources[0], Target)
    print(len(sources))
    return result, identity
look(*make())

print('--- of a simple type all is as it was: the result keeps what the source keeps')
source = ctypes.c_char_p(fresh(b'S'))
result = ctypes.cast(source, ctypes.POINTER(ctypes.c_char))
print(type(result._objects).__name__, result._objects is source._objects, result[0])
