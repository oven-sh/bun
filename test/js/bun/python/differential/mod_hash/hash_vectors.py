# Digests of many lengths, fed in many ways.
import _md5, _sha1, _sha2, _sha3, _blake2

makers = {
    'md5': _md5.md5, 'sha1': _sha1.sha1, 'sha224': _sha2.sha224, 'sha256': _sha2.sha256, 'sha384': _sha2.sha384, 'sha512': _sha2.sha512,
    'sha3_224': _sha3.sha3_224, 'sha3_256': _sha3.sha3_256, 'sha3_384': _sha3.sha3_384, 'sha3_512': _sha3.sha3_512,
    'blake2b': _blake2.blake2b, 'blake2s': _blake2.blake2s,
}
source = bytes((i * 7 + (i >> 8) * 13 + 5) & 0xff for i in range(70000))
lengths = list(range(0, 300)) + [511, 512, 513, 1023, 1024, 1025, 4095, 4096, 4097, 10000, 65535, 65536, 65537, 70000]
for name, make in makers.items():
    h = make()
    print(name, h.name, h.digest_size, h.block_size, h.hexdigest())
    total = make()
    for n in lengths:
        d = make(source[:n]).digest()
        total.update(d)
        if n in (0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 135, 136, 137, 143, 144, 145, 70000):
            print(' ', n, d.hex())
    print('  all', total.hexdigest())
    # The same data in pieces of all sizes.
    whole = make(source[:5000]).digest()
    for step in (1, 2, 3, 7, 8, 9, 63, 64, 65, 71, 72, 73, 103, 104, 105, 127, 128, 129, 135, 136, 137, 143, 144, 145, 167, 168, 169, 1000):
        h = make()
        for i in range(0, 5000, step):
            h.update(source[i:min(i + step, 5000)])
        if h.digest() != whole:
            print('  pieces differ', step)
    # digest() does not end it.
    h = make(b'abc'); a = h.digest(); b = h.digest(); h.update(b'def'); c = h.digest()
    print(' ', a == b, c == make(b'abcdef').digest(), h.hexdigest() == c.hex(), type(h.hexdigest()), type(c))
    # Copies go their own way.
    h = make(b'abc'); k = h.copy(); h.update(b'1'); k.update(b'2')
    print(' ', type(k) is type(h), h.digest() == make(b'abc1').digest(), k.digest() == make(b'abc2').digest())
    for data in (bytearray(b'xyz'), memoryview(b'xyz'), memoryview(b'wxyz!')[1:4]):
        print(' ', make(data).digest() == make(b'xyz').digest(), end='')
    import array
    print(' ', make(array.array('H', [1, 2, 3])).hexdigest() == make(array.array('H', [1, 2, 3]).tobytes()).hexdigest())

for name, make in (('shake_128', _sha3.shake_128), ('shake_256', _sha3.shake_256)):
    h = make()
    print(name, h.name, h.digest_size, h.block_size, h.hexdigest(16))
    total = _sha2.sha256()
    for n in lengths:
        total.update(make(source[:n]).digest(32 + n % 200))
    print('  all', total.hexdigest())
    h = make(b'abc')
    for out in (0, 1, 2, 31, 32, 33, 135, 136, 137, 167, 168, 169, 335, 336, 337, 1000, 100000):
        d = h.digest(out)
        print(' ', out, len(d), _sha2.sha256(d).hexdigest()[:16], h.hexdigest(out) == d.hex(), h.digest(1000000 if out > 1000 else 2000).startswith(d))
    k = h.copy(); k.update(b'd'); print(' ', k.hexdigest(8), h.hexdigest(8), make(b'abcd').hexdigest(8))
