import _hashlib as H, hashlib, warnings
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' @ 0x'); print(s[:110] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(sorted(n for n in dir(H) if not n.startswith('__')))
print(sorted(H.openssl_md_meth_names - {'sm3'}), type(H.openssl_md_meth_names), type(H._constructors), sorted(H._constructors.values()), H._GIL_MINSIZE, H.get_fips_mode())
print(all(getattr(H, 'openssl_' + v) is f for f, v in H._constructors.items()))
print(H.UnsupportedDigestmodError.__mro__, H.UnsupportedDigestmodError.__module__)
for T in (H.HASH, H.HASHXOF, H.HMAC):
    print(T, T.__mro__, [(n, type(v).__name__) for n, v in sorted(T.__dict__.items()) if n not in ('__doc__', '__module__')])
    t(T)
    def st(): T.x = 1
    t(st)
def sub():
    class S(H.HMAC): pass
t(sub)
t(H.new); t(H.new, 'nope'); t(H.new, 1); t(H.new, b'md5'); t(H.new, 'md5', 'x'); t(H.new, 'md5', 1); t(H.new, 'md5', b'a', b'b'); t(H.new, 'md5', x=1); t(H.new, 'a\0b')
src = bytes(range(256)) * 5
for n in ('md5', 'MD5', 'sha1', 'sha224', 'SHA256', 'sha384', 'sha512', 'sha512-256', 'SHA512_256', 'sha512_224', 'sha512-224', 'blake2b', 'blake2b512', 'blake2s', 'blake2s256', 'sha3-256', 'sha3_224', 'sha3_256', 'sha3_384', 'sha3_512',
          'ripemd160', 'RIPEMD160', 'md5-sha1', 'SHA2-256', 'sha-256'):
    h = H.new(n)
    print(n, h.name, h.digest_size, h.block_size, type(h).__name__, h.hexdigest(), H.new(n, src).hexdigest(), H.new(n, data=src[:100]).hexdigest()[:16])
    tot = H.new('sha256')
    for l in range(0, 300):
        tot.update(H.new(n, src[:l]).digest())
    print('  ', tot.hexdigest())
for n in ('SHA3_256', 'Sha3_224', 'SHAKE_128', 'BLAKE2B', 'Blake2s', 'Sha512_224', 'SHA512_224', 'md5_sha1', 'Md5', 'ssl3-md5', 'SSL3-SHA1', 'ripemd', 'rmd160', 'RIPEMD-160', 'BLAKE2S-256', 'keccak-256', ''):
    t(lambda: H.new(n).name)
for n in ('shake_128', 'SHAKE128', 'shake_256', 'shake256'):
    h = H.new(n, b'abc'); print(n, h.name, h.digest_size, h.block_size, type(h).__name__, h.hexdigest(20), h.digest(3))
h = H.new('sha256'); t(lambda: h); t(h.update); t(h.update, 'a'); t(h.update, 1); t(h.update, b'', b''); t(h.update, obj=b''); t(h.digest, 1); t(h.copy, 1); t(h.hexdigest, 1); t(h.update, b'x')
c = h.copy(); c.update(b'y'); print(type(c).__name__, c.hexdigest() == H.new('sha256', b'xy').hexdigest(), h.hexdigest() == H.new('sha256', b'x').hexdigest())
x = H.new('shake_128'); t(x.digest); t(x.digest, -1); t(x.digest, 0); t(x.digest, 5); t(x.hexdigest, 5); t(x.hexdigest, 0); t(x.hexdigest, -1); t(x.digest, 2**70); t(x.digest, length=2); t(x.digest, 'a'); t(x.digest, 1, 2); t(lambda: x); t(lambda: type(x.copy()).__name__)
for f in (H.openssl_md5, H.openssl_sha1, H.openssl_sha224, H.openssl_sha256, H.openssl_sha384, H.openssl_sha512, H.openssl_sha3_224, H.openssl_sha3_256, H.openssl_sha3_384, H.openssl_sha3_512):
    print(f.__name__, f().name, f(b'abc').hexdigest(), f(data=b'abc', usedforsecurity=False).hexdigest()[:8])
print(H.openssl_shake_128(b'abc').hexdigest(8), H.openssl_shake_256(b'abc').hexdigest(8))
t(H.openssl_md5, 'a'); t(H.openssl_md5, b'a', b'b'); t(H.openssl_md5, x=1); t(H.openssl_md5, b'a', string=b'b'); t(H.new, 'md5', b'a', string=b'b'); t(H.new, 'nope', b'a', string=b'b')
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    t(H.new, 'md5', string=b'b'); t(H.openssl_md5, string=b'b'); print([(x.category.__name__, str(x.message)[:40]) for x in w])
t(H.new, name='md5', data=b'x')

# HMAC
t(H.hmac_new); t(H.hmac_new, b'k'); t(H.hmac_new, b'k', b'm'); t(H.hmac_new, b'k', b'm', 'nope'); t(H.hmac_new, b'k', b'm', 1); t(H.hmac_new, b'k', b'm', None); t(H.hmac_new, 'k', b'm', 'md5'); t(H.hmac_new, b'k', 'm', 'md5'); t(H.hmac_new, b'k', None, 'md5')
t(H.hmac_new, b'k', digestmod='md5'); t(H.hmac_new, b'k', b'm', hashlib.sha256); t(H.hmac_new, b'k', b'm', H.openssl_sha1); t(H.hmac_new, b'k', b'm', len); t(H.hmac_new, b'k', b'm', 'shake_128'); t(H.hmac_new, b'k', b'm', 'blake2b'); t(H.hmac_new, b'k', b'm', 'sha3_256')
t(H.hmac_new, b'k', b'm', hashlib.blake2b); t(H.hmac_new, b'k', b'm', 'SHA256'); t(H.hmac_new, b'k', b'm', H.openssl_shake_128); t(H.hmac_new, key=b'k', msg=b'm', digestmod='sha1'); t(H.hmac_new, b'k', 5, 'md5')
m = H.hmac_new(b'k', b'm', 'sha256'); t(m.update); t(m.update, 'a'); t(m.update, msg=b'a'); t(m.update, b'a', b'b'); t(m.digest, 1); t(m.copy, 1); t(m.hexdigest); print(m.name, m.digest_size, m.block_size)
c = m.copy(); c.update(b'z'); print(c.hexdigest(), m.hexdigest(), type(c).__name__)
for n in ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512_256', 'sha512_224', 'sha3_224', 'sha3_256', 'sha3_384', 'sha3_512', 'blake2b', 'blake2s', 'ripemd160'):
    for kl in (0, 1, 20, 63, 64, 65, 72, 73, 104, 105, 127, 128, 129, 136, 137, 144, 145, 200):
        key = src[:kl]
        a = H.hmac_digest(key, b'message', n); b = H.hmac_new(key, b'mess', n); b.update(b'age')
        if a != b.digest(): print('differ', n, kl)
        if kl in (0, 20, 200): print(n, kl, a.hex(), b.name, b.digest_size, b.block_size)
t(H.hmac_digest); t(H.hmac_digest, b'k', b'm'); t(H.hmac_digest, b'k', b'm', 'nope'); t(H.hmac_digest, 'k', b'm', 'md5'); t(H.hmac_digest, b'k', 'm', 'md5'); t(H.hmac_digest, b'k', b'm', hashlib.md5); t(H.hmac_digest, b'k', b'm', None); t(H.hmac_digest, key=b'k', msg=b'm', digest='sha1'); t(H.hmac_digest, b'k', b'm', 'shake_128'); t(H.hmac_digest, bytearray(b'k'), memoryview(b'm'), 'md5')

C = H.compare_digest
t(C); t(C, b'a', b'a'); t(C, b'a', b'b'); t(C, b'a', b'ab'); t(C, 'a', 'a'); t(C, 'a', 'b'); t(C, 'a', b'a'); t(C, b'a', 'a'); t(C, '\xe9', '\xe9'); t(C, 'a', 'ሴ'); t(C, 1, 1); t(C, bytearray(b'a'), memoryview(b'a')); t(C, b'', b''); t(C, '', ''); t(C, None, b''); t(C, b'', None); t(C, 1, b'a'); t(C, b'a', 1); t(C, 'a', 1); t(C, b'abc' * 100, b'abc' * 100); t(C, 'abc' * 100, 'abc' * 99 + 'abd'); t(C, a=b'', b=b'')
