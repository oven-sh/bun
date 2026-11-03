import _hmac as M, hashlib, _md5, _sha2, _sha3, _blake2, _hashlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' @ 0x'); print(s[:100] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(sorted(n for n in dir(M) if not n.startswith('__')), M.UnknownHashError.__mro__, M.UnknownHashError.__module__, M.HMAC.__mro__, M._GIL_MINSIZE)
print(sorted((n, type(v).__name__) for n, v in M.HMAC.__dict__.items() if n not in ('__doc__', '__module__')))
src = bytes(range(256))
for n in ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3_224', 'sha3_256', 'sha3_384', 'sha3_512', 'sha2_224', 'sha2_256', 'sha2_384', 'sha2_512', 'MD5', 'SHA1', 'SHA224', 'SHA256', 'SHA384', 'SHA512'):
    h = M.new(b'k', b'm', n); print(n, h.name, h.digest_size, h.block_size, h.hexdigest(), M.compute_digest(b'k', b'm', n) == h.digest())
    for kl in (0, 1, 63, 64, 65, 72, 73, 104, 105, 128, 129, 136, 137, 144, 145, 250):
        a = M.new(src[:kl], None, n); a.update(b'ab'); a.update(b'c'); c = a.copy(); c.update(b'd')
        if a.digest() != M.compute_digest(src[:kl], b'abc', n) or c.digest() != M.compute_digest(src[:kl], b'abcd', n): print('differ', n, kl)
        if kl in (0, 250): print(' ', kl, a.hexdigest()[:24])
for n in ('sha512_256', 'shake_128', 'hmac-sha256', 'sha2-256', 'blake2s256', 'blake2b512', 'sha3-256', 'ripemd160', 'Sha256', 'SHA3_256', 'Sha2_512', ''):
    t(M.new, b'k', b'm', n)
for f in ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3_224', 'sha3_256', 'sha3_384', 'sha3_512', 'blake2s_32', 'blake2b_32'):
    print(f, getattr(M, 'compute_' + f)(b'key', b'message').hex(), getattr(M, 'compute_' + f)(b'', b'').hex()[:16], getattr(M, 'compute_' + f)(bytearray(src), memoryview(src)).hex()[:16])
print(M.compute_digest(b'k', b'm', 'blake2b').hex(), M.compute_digest(b'k', b'm', 'blake2s_32').hex())
t(M.new); t(M.new, b'k'); t(M.new, b'k', b'm'); t(M.new, b'k', b'm', None); t(M.new, b'k', None, 'md5'); t(M.new, 'k', b'm', 'md5'); t(M.new, b'k', 'm', 'md5'); t(M.new, b'k', b'm', 1); t(M.new, b'k', b'm', hashlib.sha256); t(M.new, b'k', b'm', hashlib.blake2b); t(M.new, b'k', b'm', len); t(M.new, key=b'k', msg=b'm', digestmod='md5'); t(M.new, b'k', 5, 'md5'); t(M.new, bytearray(b'k'), memoryview(b'm'), 'md5'); t(M.new, b'k', b'm', 'md5', 1); t(M.new, 5, b'm', 'md5'); t(M.new, 'k', b'm', 'nope')
t(M.new, b'k', b'm', _md5.md5); t(M.new, b'k', b'm', _sha2.sha256); t(M.new, b'k', b'm', _sha3.sha3_256); t(M.new, b'k', b'm', _blake2.blake2s); t(M.new, b'k', b'm', _hashlib.openssl_sha1)
h = M.new(b'k', b'm', 'md5'); t(lambda: h); t(h.update); t(h.update, 'a'); t(h.update, msg=b'a'); t(h.update, b'a', b'b'); t(h.update, 1); t(h.digest, 1); t(h.copy, 1); t(h.hexdigest, 1); t(h.copy); t(M.HMAC)
def sn(): h.name = 'x'
t(sn)
def sub():
    class X(M.HMAC): pass
t(sub)
t(M.compute_digest); t(M.compute_digest, b'k', b'm'); t(M.compute_digest, b'k', b'm', 'nope'); t(M.compute_digest, 'k', b'm', 'md5'); t(M.compute_digest, b'k', 'm', 'md5'); t(M.compute_digest, b'k', b'm', hashlib.md5); t(M.compute_digest, key=b'k', msg=b'm', digest='sha1'); t(M.compute_digest, b'k', b'm', None)
t(M.compute_md5); t(M.compute_md5, 'k', b'm'); t(M.compute_md5, b'k', 'm'); t(M.compute_md5, b'k'); t(M.compute_md5, key=b'k', msg=b'm'); t(M.compute_md5, 1, b''); t(M.compute_md5, b'', b'', b'')
