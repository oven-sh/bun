# A HASHXOF is a HASH: what HASH defines can be asked of a SHAKE object. And layouts.
import _hashlib, _hmac, hashlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
HASH, XOF = _hashlib.HASH, _hashlib.HASHXOF
for name in 'shake_128', 'shake_256':
    h = _hashlib.new(name, b'abc')
    t(HASH.digest, h); t(HASH.hexdigest, h); t(HASH.digest_size.__get__, h); t(XOF.digest_size.__get__, h); print(h.digest_size, h.block_size, h.name)
    t(HASH.block_size.__get__, h); t(HASH.name.__get__, h); t(HASH.copy(h).hexdigest, 8); t(h.hexdigest, 8); HASH.update(h, b'def'); t(HASH.hexdigest, h); t(h.hexdigest, 40)
    t(super(XOF, h).digest); t(super(XOF, h).hexdigest)
t(XOF.digest, _hashlib.new('sha256'), 4); t(XOF.digest_size.__get__, _hashlib.new('sha256')); t(HASH.digest, 1); t(HASH.digest, _hashlib.hmac_new(b'k', b'm', 'sha256'))
t(_hashlib.HMAC.digest, _hmac.new(b'k', b'm', 'sha256')); t(_hmac.HMAC.digest, _hashlib.hmac_new(b'k', b'm', 'sha256'))

class P: pass
class H(HASH): pass
class X(XOF): pass
p = P(); t(setattr, p, '__class__', H); t(setattr, p, '__class__', X); print(type(p).__name__)
t(H); t(X); t(HASH.__new__, H); t(object.__new__, H)
for bases in (XOF, HASH), (HASH, XOF), (HASH, dict), (HASH, Exception), (H, X), (X, H), (HASH, P):
    t(lambda: [c.__name__ for c in type('Y', bases, {}).__mro__])
for cls in _hashlib.HMAC, _hmac.HMAC, type(hashlib.md5()), type(hashlib.sha3_256()), type(hashlib.blake2b()):
    t(lambda: type('Y', (cls,), {}))

# Everything there is a name for, through the three ways to use it.
for name in sorted(_hashlib.openssl_md_meth_names - {'sm3'}):
    h = _hashlib.new(name, b'abc' * 100); c = h.copy(); c.update(b'x' * 300)
    if name.startswith('shake'):
        print(name, h.hexdigest(20), c.hexdigest(200)[-40:])
        continue
    print(name, h.hexdigest(), c.hexdigest())
    for length in 1, h.digest_size, 2 * h.digest_size + 3:
        t(_hashlib.pbkdf2_hmac(name, b'password', b'salt', 3, length).hex)
    t(_hashlib.pbkdf2_hmac(name, b'p' * 300, b's' * 300, 2).hex); t(_hashlib.pbkdf2_hmac(name, b'', b'', 1).hex)
    t(_hashlib.hmac_digest(b'key', b'message', name).hex); t(_hashlib.hmac_digest(b'k' * 300, b'', name).hex)
    m = _hashlib.hmac_new(b'key', b'mess', name); n = m.copy(); m.update(b'age'); print(m.hexdigest(), n.hexdigest(), m.name, m.digest_size, m.block_size)
