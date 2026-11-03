# Called from typed_arrays.js.
def describe(x):
    m = memoryview(x)
    return [m.format, m.itemsize, m.nbytes, m.readonly, m.ndim, list(m.shape), list(m.strides), m.c_contiguous, m.obj is x, m.tolist()]

def view(x):
    return memoryview(x)

def get(m, i):
    return m[i]

def put(m, i, v):
    m[i] = v

def tolist(m):
    return m.tolist()

def attempt(f, *args):
    try:
        return repr(f(*args))
    except BaseException as e:
        return type(e).__name__ + ': ' + str(e)

def conversions(x):
    return [repr(bytes(x)), repr(bytearray(x)), repr(b'-'.join([x, x])), repr(b'<' + x), int.from_bytes(x, 'little'), bytes(x).hex(), memoryview(x).hex(), memoryview(x) == bytes(x), bytearray(bytes(x)) == x, b'\x02\x03' in bytes(x), bytes(x).find(x), memoryview(x)[1:3].tolist(), memoryview(x)[::-1].tolist(), memoryview(x).cast('B').tolist()]

def fill(x, data):
    memoryview(x).cast('B')[:] = data

def hashes(x):
    return [attempt(hash, memoryview(x)), attempt(hash, memoryview(x).toreadonly())]

def flags(x):
    out = []
    for fl in (0, 1, 4, 8, 0x18, 0x11c, 0x11d):
        m = memoryview._from_flags(x, fl)
        out.append([fl, m.format, m.itemsize, list(m.shape), m.readonly])
    return out
