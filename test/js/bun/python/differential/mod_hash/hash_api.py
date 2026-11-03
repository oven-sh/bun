import warnings
import _md5, _sha1, _sha2, _sha3, _blake2
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
for m in (_md5, _sha1, _sha2, _sha3, _blake2):
    print(m.__name__, sorted(n for n in dir(m) if not n.startswith('__')), m._GIL_MINSIZE)
makers = [_md5.md5, _sha1.sha1, _sha2.sha224, _sha2.sha256, _sha2.sha384, _sha2.sha512, _sha3.sha3_224, _sha3.sha3_256, _sha3.sha3_384, _sha3.sha3_512, _sha3.shake_128, _sha3.shake_256, _blake2.blake2b, _blake2.blake2s]
for make in makers:
    h = make()
    T = type(h)
    print(T, T.__mro__, T.__module__, T.__name__, T.__qualname__, type(make).__name__)
    print([(n, type(v).__name__) for n, v in sorted(T.__dict__.items()) if n not in ('__doc__', '__module__')])
    t(lambda: h)
    t(h.update); t(h.update, 1); t(h.update, 'a'); t(h.update, None); t(h.update, b'a', b'b'); t(h.update, obj=b'a'); t(h.update, data=b'a'); t(h.update, [1]); t(h.update, b'')
    t(h.copy, 1); t(h.copy, x=1)
    if h.digest_size:
        t(h.digest, 1); t(h.hexdigest, 1); t(h.digest, x=1)
    t(make, 1); t(make, 'a'); t(make, b'a', b'b'); t(make, b'a', True); t(make, x=1); t(make, None); t(make, data=None); t(make, b'a', data=b'a'); t(make, b'a', usedforsecurity=False); t(make, data=b'a', usedforsecurity=True)
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        t(make, string=b'a'); t(make, string=None); t(make, string='a')
        print([(x.category.__name__, str(x.message)) for x in w])
        t(make, b'a', string=b'b'); t(make, data=b'a', string=b'b')
    with warnings.catch_warnings():
        warnings.simplefilter('error')
        t(make, string=b'a')
    t(T)
    def sub():
        class S(T): pass
    t(sub)
    def sa(): h.x = 1
    t(sa)
    def sn(): h.name = 'x'
    t(sn)
    def sd(): del h.digest_size
    t(sd)
    def st(): T.x = 1
    t(st)
    t(hash, h) if False else None
    print(h == h.copy(), h != h.copy(), bool(h))
    import pickle, copy
    t(pickle.dumps, h); t(copy.copy, h)
    class Bad:
        def __bool__(self): raise ZeroDivisionError('bool')
    t(make, b'', usedforsecurity=Bad())
    mv = memoryview(bytes(12)).cast('B', (3, 4))
    t(h.update, mv)
    t(h.update, memoryview(bytes(12))[::2])
for n in ('sha3_224', 'sha3_256', 'sha3_384', 'sha3_512', 'shake_128', 'shake_256'):
    h = getattr(_sha3, n)(); print(n, h._capacity_bits, h._rate_bits, h._suffix, h.block_size, h.digest_size, h.name, getattr(_sha3, n).__doc__)
h = _sha3.shake_128()
for f in (h.digest, h.hexdigest):
    t(f); t(f, -1); t(f, 'a'); t(f, 1.0); t(f, 2**29); t(f, 2**29 - 1 and 0); t(f, 2**70); t(f, -2**70); t(f, length=3); t(f, 1, 2); t(f, x=1); t(f, 3, length=3); t(f, True); t(f, None)
print(_blake2.blake2b.__doc__, _blake2.blake2s.__doc__, _md5.MD5Type.__doc__)
print(_md5.md5.__text_signature__, _sha2.sha256.__text_signature__)
