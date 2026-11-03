import _hashlib as H
def t(f, *a, **k):
    try:
        r = f(*a, **k); print(r.hex() if isinstance(r, bytes) else repr(r))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
P = H.pbkdf2_hmac
for n in ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512_256', 'sha512_224', 'sha3_224', 'sha3_256', 'sha3_384', 'sha3_512', 'blake2b', 'blake2s', 'ripemd160'):
    for it, dk in ((1, None), (2, None), (3, 1), (5, 100), (1000, 20)):
        t(P, n, b'password', b'salt', it, dk)
    t(P, n, b'', b'', 1); t(P, n, b'p' * 300, b's' * 300, 2, 7)
# RFC 6070
t(P, 'sha1', b'password', b'salt', 4096, 20); t(P, 'sha1', b'passwordPASSWORDpassword', b'saltSALTsaltSALTsaltSALTsaltSALTsalt', 4096, 25); t(P, 'sha1', b'pass\0word', b'sa\0lt', 4096, 16)
t(P); t(P, 'sha256', b'p', b's'); t(P, 'nope', b'p', b's', 1); t(P, 'sha256', 'p', b's', 1); t(P, 'sha256', b'p', 's', 1); t(P, 'sha256', b'p', b's', 0); t(P, 'sha256', b'p', b's', -1); t(P, 'sha256', b'p', b's', 2**31); t(P, 'sha256', b'p', b's', 2**70)
t(P, 'sha256', b'p', b's', '1'); t(P, 'sha256', b'p', b's', 1.0); t(P, 'sha256', b'p', b's', 1, 0); t(P, 'sha256', b'p', b's', 1, -1); t(P, 'sha256', b'p', b's', 1, 2**31); t(P, 'sha256', b'p', b's', 1, 'a'); t(P, 'sha256', b'p', b's', 1, None); t(P, 'sha256', b'p', b's', 1, 5)
t(P, b'sha256', b'p', b's', 1); t(P, 1, b'p', b's', 1); t(P, 'shake_128', b'p', b's', 1); t(P, 'SHA1', b'p', b's', 1, 4); t(P, 'sha\0', b'p', b's', 1); t(P, hash_name='sha1', password=b'p', salt=b's', iterations=1, dklen=3); t(P, 'sha256', b'p', b's', 1, 1.5); t(P, 'sha256', bytearray(b'p'), memoryview(b's'), True)
t(P, 'sha256', b'p', b's', 1, 2, 3); t(P, 'nope', 'p', b's', 1); t(P, 'nope', b'p', b's', 0)
S = H.scrypt
# RFC 7914
t(S, b'', salt=b'', n=16, r=1, p=1, dklen=64); t(S, b'password', salt=b'NaCl', n=1024, r=8, p=16, dklen=64)
t(S, b'p', salt=b's', n=2, r=1, p=1); t(S, b'p', salt=b's', n=2, r=1, p=1, dklen=7); t(S, password=b'p', salt=b's', n=16, r=2, p=2, maxmem=10**6, dklen=9); t(S, bytearray(b'p'), salt=memoryview(b's'), n=4, r=3, p=2, dklen=100)
t(S); t(S, b'p'); t(S, b'p', salt=b's'); t(S, b'p', salt=b's', n=2, r=1); t(S, b'p', b's', 2, 1, 1); t(S, 'p', salt=b's', n=2, r=1, p=1); t(S, b'p', salt='s', n=2, r=1, p=1); t(S, b'p', salt=b's', n=3, r=1, p=1); t(S, b'p', salt=b's', n=1, r=1, p=1); t(S, b'p', salt=b's', n=0, r=1, p=1)
t(S, b'p', salt=b's', n=-2, r=1, p=1); t(S, b'p', salt=b's', n=2, r=-1, p=1); t(S, b'p', salt=b's', n='2', r=1, p=1); t(S, b'p', salt=b's', n=2.0, r=1, p=1); t(S, b'p', salt=b's', n=2, r=1, p=1, maxmem=-1)
t(S, b'p', salt=b's', n=2, r=1, p=1, maxmem=2**31); t(S, b'p', salt=b's', n=2, r=1, p=1, maxmem=1); t(S, b'p', salt=b's', n=2, r=1, p=1, dklen=0); t(S, b'p', salt=b's', n=2, r=1, p=1, dklen=2**31); t(S, b'p', salt=b's', n=2**20, r=8, p=1); t(S, b'p', salt=b's', n=2**64, r=8, p=1); t(S, b'p', salt=None, n=2, r=1, p=1)
t(S, b'p', salt=b's', n=2, r=1, p=1, x=1); t(S, b'p', salt=b's', n=2, r=1, p=1, maxmem='a'); t(S, b'p', salt=b's', n=2, r=1, p=1, dklen=2.5)
