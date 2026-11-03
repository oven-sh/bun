# The arguments are converted after the buffers are taken: what their methods run cannot take the memory away.
import _hashlib, _hmac, _blake2, hashlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
class N:
    "A number, a truth value or bytes, which tries to empty the bytearray when it is asked for them."
    def __init__(self, data, value): self.data, self.value = data, value
    def attempt(self): t(self.data.clear); t(self.data.extend, b'x' * 100000)
    def __index__(self): self.attempt(); return self.value
    def __bool__(self): self.attempt(); return bool(self.value)
    def __buffer__(self, flags): self.attempt(); return memoryview(self.value)
d = bytearray(b'password'); t(lambda: _hashlib.pbkdf2_hmac('sha256', d, b'salt', N(d, 2)) == _hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 2)); d.clear()
d = bytearray(b'salt'); t(lambda: _hashlib.pbkdf2_hmac('sha256', b'password', d, 2, N(d, 7)) == _hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 2, 7)); d.clear()
d = bytearray(b'password'); t(lambda: _hashlib.pbkdf2_hmac('blake2s', d, b'salt', N(d, 2)) == _hashlib.pbkdf2_hmac('blake2s', b'password', b'salt', 2)); d.clear()
d = bytearray(b'password'); t(lambda: _hashlib.scrypt(d, salt=b'salt', n=N(d, 2), r=1, p=1) == _hashlib.scrypt(b'password', salt=b'salt', n=2, r=1, p=1)); d.clear()
d = bytearray(b'salt'); t(lambda: _hashlib.scrypt(b'password', salt=d, n=2, r=1, p=1, dklen=N(d, 9)) == _hashlib.scrypt(b'password', salt=b'salt', n=2, r=1, p=1, dklen=9)); d.clear()
d = bytearray(b'key'); t(lambda: _hashlib.hmac_digest(d, N(d, b'message'), 'sha256') == _hashlib.hmac_digest(b'key', b'message', 'sha256')); d.clear()
d = bytearray(b'key'); t(lambda: _hmac.compute_digest(d, N(d, b'message'), 'sha256') == _hashlib.hmac_digest(b'key', b'message', 'sha256')); d.clear()
d = bytearray(b'key'); t(lambda: _hmac.compute_sha1(d, N(d, b'message')) == _hashlib.hmac_digest(b'key', b'message', 'sha1')); d.clear()
d = bytearray(b'same'); t(_hashlib.compare_digest, d, N(d, b'same')); d.clear()
d = bytearray(b'key'); t(lambda: _blake2.blake2b(key=d, fanout=N(d, 1)).digest() == _blake2.blake2b(key=b'key').digest()); d.clear()
d = bytearray(b'salt'); t(lambda: _blake2.blake2b(salt=d, last_node=N(d, 0)).digest() == _blake2.blake2b(salt=b'salt').digest()); d.clear()
d = bytearray(b'me'); t(lambda: _blake2.blake2s(person=d, depth=N(d, 1), usedforsecurity=N(d, 1)).digest() == _blake2.blake2s(person=b'me').digest()); d.clear()
d = bytearray(b'data'); t(lambda: _hashlib.new('sha256', d, usedforsecurity=N(d, 1)).digest() == hashlib.sha256(b'data').digest()); d.clear()
