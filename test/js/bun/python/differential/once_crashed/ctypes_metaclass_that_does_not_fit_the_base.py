# What a metaclass of ctypes knows of a class is written by its __init__, which can be made to run on a class with any base: by a metaclass derived from two
# of them, or by type.__new__() and a call. The kind of cell of the instances, and what the methods of the base do with it, must not go by that.
# (CPython itself dies in most of these.)
import ctypes, _ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


bases = dict(Structure=ctypes.Structure, Union=ctypes.Union, Array=ctypes.Array, Pointer=_ctypes._Pointer, Simple=_ctypes._SimpleCData, Func=_ctypes.CFuncPtr)
metas = {name: type(base) for name, base in bases.items()}


class Both(type(ctypes.Array), type(_ctypes.CFuncPtr)):
    pass


class T(_ctypes.CFuncPtr, metaclass=Both):
    _type_ = ctypes.c_int
    _length_ = 5
    _flags_ = 1


functions = [T() for i in range(1000)]
for x in functions:
    x.errcheck = len
    x.restype = ctypes.c_int
gc.collect()
print(ctypes.sizeof(T), {(x.restype, x.errcheck) for x in functions})


class All(*metas.values()):
    pass


def make(kind, base):
    namespace = {'_fields_': [('a', ctypes.c_int), ('b', ctypes.c_void_p)], '_type_': ctypes.c_int if kind in ('Array', 'Pointer') else 'i', '_length_': 5, '_flags_': 1}
    made = type.__new__(All, 'T', (bases[base],), dict(namespace))
    metas[kind].__init__(made, 'T', (bases[base],), dict(namespace))
    return made


for base in bases:
    for kind in metas:
        made = make(kind, base)
        try:
            xs = [made() for i in range(50)]
        except TypeError as e:
            print(base, 'with what', kind, 'knows |', e)
            continue
        row = []
        for x in xs:
            if base == 'Func':
                x.errcheck = len
                x.restype = ctypes.c_int
                x.argtypes = (ctypes.c_int,)
        gc.collect()
        x = xs[25]
        if base == 'Func':
            row += [x.errcheck, x.restype, x.argtypes]
        if base == 'Array':
            row += [attempt(lambda: len(x)), attempt(lambda: x[0]), attempt(lambda: x.__setitem__(0, 1)), attempt(lambda: x[:2]), attempt(lambda: x.__setitem__(slice(0, 2), (1, 2))), attempt(lambda: list(x))]
        if base == 'Pointer':
            row += [attempt(lambda: bool(x)), attempt(lambda: x.contents), attempt(lambda: x[0])]
        if base == 'Simple':
            row += [attempt(lambda: x.value), attempt(lambda: setattr(x, 'value', 1))]
        print(base, 'with what', kind, 'knows |', type(x).__mro__[1].__name__, ctypes.sizeof(x), *row)

print('--- a base that is none of ctypes')
for base in (list, dict, int, str, object):
    X = type(ctypes.Structure)('X', (base,), {'_fields_': [('a', ctypes.c_int)]})
    print(base.__name__, '|', attempt(X) if base is not object else 'made', '|', attempt(lambda: X.from_buffer_copy(b'1234')), '|', attempt(lambda: X.from_buffer(bytearray(4))), '|', attempt(lambda: X.from_address(0)),
        '|', attempt(lambda: (X * 2)()[0]))

print('--- the methods of one metaclass, on a class that another one knows about')


def two(first, second, base, **namespace):
    return type('MM', (metas[first], metas[second]), {})('T', (bases[base],), namespace)


T = two('Simple', 'Structure', 'Simple', _type_='i')
print(attempt(lambda: setattr(T, '_fields_', [('big', ctypes.c_long * 1000)])), ctypes.sizeof(T), attempt(T))
T = two('Array', 'Structure', 'Array', _type_=ctypes.c_int, _length_=5)
print(attempt(lambda: setattr(T, '_fields_', [('big', ctypes.c_long * 1000)])), ctypes.sizeof(T), attempt(lambda: T()[0]))
T = two('Simple', 'Pointer', 'Simple', _type_='d')
print(attempt(lambda: metas['Pointer'].set_type(T, ctypes.c_int)), attempt(lambda: T.from_param(1.5) is not None), attempt(lambda: ctypes.CDLL(None).abs(T(1.5)) is not None))
T = two('Array', 'Pointer', 'Array', _type_=ctypes.c_int, _length_=2)
print(attempt(lambda: metas['Pointer'].set_type(T, T)), attempt(lambda: bytes(T())), attempt(lambda: metas['Pointer'].from_param(T, 1)))
T = two('Structure', 'Simple', 'Structure', _fields_=[('a', ctypes.c_int)])
print(attempt(lambda: metas['Simple'].from_param(T, 1)))
T = two('Array', 'Simple', 'Array', _type_=ctypes.c_int, _length_=2)
print(attempt(lambda: metas['Simple'].from_param(T, 1)))
