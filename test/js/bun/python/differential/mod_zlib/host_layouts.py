# __class__ assignment and subclassing with the types of the modules written against the libraries of Bun, which are not base types.
import zlib, sqlite3, _hashlib, _hmac, _md5, _sha3, _blake2, _zstd
def t(f, *a):
    try:
        print(repr(f(*a))[:100])
    except BaseException as e:
        print(type(e).__name__ + ':', e)
class P: pass
C = type(zlib.compressobj()); D = type(zlib.decompressobj())
for cls in C, D, zlib._ZlibDecompressor, sqlite3.Blob, sqlite3.PrepareProtocol, _hashlib.HMAC, _hmac.HMAC, type(_md5.md5()), _sha3.sha3_224, _sha3.shake_128, _blake2.blake2b, _zstd.ZstdDict, _zstd.ZstdCompressor, _zstd.ZstdDecompressor:
    p = P(); t(setattr, p, '__class__', cls)
    t(lambda: type('X', (cls,), {}))
o = zlib.compressobj(); t(setattr, o, '__class__', D); t(setattr, o, '__class__', P)
o = zlib.decompressobj(); t(setattr, o, '__class__', zlib._ZlibDecompressor)
t(setattr, C, 'x', 1); t(setattr, zlib._ZlibDecompressor, 'x', 1)
