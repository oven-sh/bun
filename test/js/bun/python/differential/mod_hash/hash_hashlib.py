# hashlib and hmac, as programs use them.
import hashlib, hmac, io, os, tempfile
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' @ 0x'); j = s.find(' at 0x'); i = i if i >= 0 else j; print(s[:110] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(sorted(hashlib.algorithms_guaranteed), sorted(hashlib.algorithms_available - {'sm3'}))
for n in sorted(hashlib.algorithms_guaranteed):
    f = getattr(hashlib, n); h = f(b'abc'); g = hashlib.new(n, b'abc')
    d = (h.hexdigest(8), g.hexdigest(8)) if n.startswith('shake') else (h.hexdigest(), g.hexdigest())
    print(n, h.name, h.digest_size, h.block_size, d[0], d[0] == d[1], type(h).__name__, type(g).__name__, type(f).__name__)
for n in ('ripemd160', 'sha512_224', 'sha512_256', 'md5-sha1', 'SHA256', 'Blake2b'):
    t(lambda: hashlib.new(n, b'abc').hexdigest())
t(hashlib.new, 'nope'); t(hashlib.new, 'blake2b', b'x', digest_size=5); t(lambda: hashlib.new('blake2b', b'x', digest_size=5).hexdigest()); t(lambda: hashlib.blake2s(b'x', key=b'k', person=b'p').hexdigest()); t(hashlib.new, 'md5', usedforsecurity=False); t(hashlib.sha256, 'str'); t(hashlib.new, 5)
print(hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 1000).hex(), hashlib.scrypt(b'pw', salt=b'na', n=16, r=2, p=1, dklen=16).hex())
b = io.BytesIO(bytes(range(256)) * 1000)
print(hashlib.file_digest(b, 'sha256').hexdigest(), hashlib.file_digest(io.BytesIO(b'abc'), hashlib.md5).hexdigest(), hashlib.file_digest(io.BytesIO(b'abc'), lambda: hashlib.blake2b(digest_size=4)).hexdigest())
fd, p = tempfile.mkstemp()
os.write(fd, b'file contents' * 100000); os.close(fd)
with open(p, 'rb') as f: print(hashlib.file_digest(f, 'sha1').hexdigest())
os.unlink(p)

for dm in ('md5', 'sha1', 'sha256', 'sha512', 'sha3_256', 'blake2b', 'blake2s', hashlib.sha256, hashlib.sha3_512, hashlib.blake2b, lambda d=b'': hashlib.blake2b(d, digest_size=10), hashlib.md5):
    h = hmac.new(b'key', b'The quick brown fox ', dm); h.update(b'jumps over the lazy dog')
    print(h.name, h.digest_size, h.block_size, h.hexdigest(), h.copy().digest() == h.digest(), hmac.digest(b'key', b'The quick brown fox jumps over the lazy dog', dm) == h.digest())
print(hmac.new(b'k' * 200, b'm', 'sha256').hexdigest(), hmac.HMAC(b'', b'', 'sha1').hexdigest())
t(hmac.new, b'k'); t(hmac.new, b'k', b'm'); t(hmac.new, 'k', b'm', 'md5'); t(hmac.new, b'k', 'm', 'md5'); t(hmac.new, b'k', b'm', 'nope'); t(hmac.new, b'k', b'm', 'shake_128'); t(hmac.digest, b'k', b'm', 'nope'); t(hmac.new, b'k', b'm', 5)
print(hmac.compare_digest(b'a', b'a'), hmac.compare_digest('a', 'b'), hmac.compare_digest(bytearray(b'xy'), b'xy'))
t(hmac.compare_digest, 'a', b'a')
import random, uuid, secrets
random.seed('a string seed'); print(random.random(), random.randrange(10**9))
print(uuid.uuid3(uuid.NAMESPACE_DNS, 'python.org'), uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org'), len(secrets.token_hex(8)))
