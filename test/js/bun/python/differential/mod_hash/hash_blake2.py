import _blake2
def t(f, *a, **k):
    try:
        r = f(*a, **k)
        print(r.hexdigest() if hasattr(r, 'hexdigest') else repr(r))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
for B in (_blake2.blake2b, _blake2.blake2s):
    print(B.__name__, B.SALT_SIZE, B.PERSON_SIZE, B.MAX_KEY_SIZE, B.MAX_DIGEST_SIZE)
    msg = bytes(range(256)) * 3
    for ds in range(1, B.MAX_DIGEST_SIZE + 1):
        h = B(msg, digest_size=ds)
        print(ds, h.digest_size, h.hexdigest())
    for kl in range(0, B.MAX_KEY_SIZE + 1):
        print('key', kl, B(msg[:kl * 5], key=bytes(range(kl))).hexdigest()[:40], B(key=bytes(range(kl))).hexdigest()[:24])
    for sl in range(0, B.SALT_SIZE + 1):
        print('salt', sl, B(b'm', salt=b'S' * sl).hexdigest()[:32], 'person', B(b'm', person=b'P' * sl).hexdigest()[:32])
    print(B(b'm', salt=b'S\0\0').digest() == B(b'm', salt=b'S').digest())
    for kw in (dict(fanout=0), dict(fanout=2), dict(fanout=255), dict(depth=2), dict(depth=255), dict(leaf_size=1), dict(leaf_size=2**32 - 1), dict(node_offset=1), dict(node_offset=2**48 - 1),
               dict(node_depth=1), dict(node_depth=255), dict(inner_size=1), dict(inner_size=B.MAX_DIGEST_SIZE), dict(last_node=True), dict(last_node=False), dict(usedforsecurity=False),
               dict(fanout=2, depth=2, leaf_size=4096, node_offset=3, node_depth=1, inner_size=16, last_node=True, digest_size=20, key=b'k', salt=b's', person=b'p')):
        print(sorted(kw), B(b'tree', **kw).hexdigest())
    # A tree of two leaves, as in the documentation of hashlib.
    FANOUT, DEPTH, LEAF, INNER = 2, 2, 4096, B.MAX_DIGEST_SIZE
    buf = bytes(6000)
    l0 = B(buf[:LEAF], fanout=FANOUT, depth=DEPTH, leaf_size=LEAF, inner_size=INNER, node_offset=0, node_depth=0, last_node=False)
    l1 = B(buf[LEAF:], fanout=FANOUT, depth=DEPTH, leaf_size=LEAF, inner_size=INNER, node_offset=1, node_depth=0, last_node=True)
    root = B(fanout=FANOUT, depth=DEPTH, leaf_size=LEAF, inner_size=INNER, node_offset=0, node_depth=1, last_node=True)
    root.update(l0.digest()); root.update(l1.digest()); print(root.hexdigest())
    h = B(b'a', key=b'k', digest_size=9, last_node=True); c = h.copy(); c.update(b'b'); print(c.hexdigest(), c.digest_size, h.hexdigest(), B(b'ab', key=b'k', digest_size=9, last_node=True).hexdigest())
    for n in (B().block_size - 1, B().block_size, B().block_size + 1, 2 * B().block_size, 2 * B().block_size + 1):
        print(n, B(b'z' * n).hexdigest()[:32], B(b'z' * n, key=b'K').hexdigest()[:32])
    t(B, b'', 1); t(B, digest_size=0); t(B, digest_size=B.MAX_DIGEST_SIZE + 1); t(B, digest_size=-1); t(B, digest_size='a'); t(B, digest_size=2**40)
    t(B, key=b'x' * (B.MAX_KEY_SIZE + 1)); t(B, salt=b'x' * (B.SALT_SIZE + 1)); t(B, person=b'x' * (B.PERSON_SIZE + 1))
    t(B, fanout=256); t(B, fanout=-1); t(B, depth=0); t(B, depth=256); t(B, leaf_size=2**32); t(B, leaf_size=-1); t(B, node_offset=2**64); t(B, node_offset=2**64 - 1); t(B, node_offset=2**48); t(B, node_offset=-1)
    t(B, node_depth=256); t(B, node_depth=-1); t(B, inner_size=B.MAX_DIGEST_SIZE + 1); t(B, inner_size=-1); t(B, last_node=5); t(B, key='a'); t(B, key=None); t(B, salt=1); t(B, person='p'); t(B, x=1)
    t(B, leaf_size=2**64); t(B, leaf_size='a'); t(B, leaf_size=1.0); t(B, node_offset='a'); t(B, leaf_size=2**63); t(B, b'x', data=b'y'); t(B, data=b'x'); t(B, 'str'); t(B, 5); t(B, None)
    t(B, key=bytearray(b'kk'), salt=memoryview(b'ss'), person=bytearray(b'pp'))
    def sub():
        class S(B): pass
    t(sub)
    def seta(): B.SALT_SIZE = 3
    t(seta)
print(sorted((n, getattr(_blake2, n)) for n in dir(_blake2) if n.isupper() or n == '_GIL_MINSIZE'))
