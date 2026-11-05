# A set or a dict keeps the hash of each key, and hands it on when another dict or set is made of it. If the class of a key has been given
# another __hash__ or __eq__ since, or the key another class, what was kept is no longer what hash() says: the key is where its old hash put
# it. Here the keys are instances of classes derived from str, whose text may not even have been put together yet.
# (Each container has one key, and the other hash differs from str's in the last bit: so a search by one never comes by the place
# that goes with the other, whatever the hashes are in this run.)
import collections, sys

A = 'x' * 100; B = str(len(sys.argv)) * 50
MAKERS = [('concatenation', lambda: A + B), ('literal', lambda: 'abc'), ('join', lambda: ''.join([A, B])), ('short concatenation', lambda: A[:2] + B[:2]), ('slice', lambda: (A + B)[3:90]),
          ('repeated', lambda: B * 4), ('wide', lambda: '€' * 40 + B), ('format', lambda: '%s-%s' % (A, B))]

def report(label, k, text, d):
    print(' ', label, k in d, text in d, d.get(k, 'no') if isinstance(d, dict) else None, d.get(text, 'no') if isinstance(d, dict) else None, [type(x).__name__ for x in d], len(d))
def updated(d, o): d.update(o); return d

for label, make in MAKERS:
    print(label)
    other = hash(make()) ^ 1              # (of another object with the same text: the key's own is left as it was made)
    def other_hash(self): return other
    text = make()

    # __hash__ taken away after the key was stored.
    class S(str): __hash__ = other_hash
    k = S(make()); s = {k}; f = frozenset(s); o = {k: 1}
    del S.__hash__
    for name, d in [('fromkeys(set)', dict.fromkeys(s)), ('fromkeys(frozenset)', dict.fromkeys(f)), ('dict(dict)', dict(o)), ('copy', o.copy()), ('update', updated({}, o)), ('|', {} | o),
                    ('**', {**o}), ('set(dict)', set(o)), ('set(set)', set(s)), ('set | set', s | set()), ('frozenset(dict)', frozenset(o)),
                    ('the dict itself', o), ('the set itself', s)]:
        report('taken away: ' + name, k, text, d)
    # Into a dict that holds strs. (Whether a search by the new hash comes by the key there depends on the hashes of this run.)
    d = updated({'p': 1, 'r': 2}, dict.fromkeys(s))
    print('  taken away: into a dict of strs', len(d), sorted(type(x).__name__ for x in d), 'p' in d, 'r' in d, type(k in d).__name__, type(text in d).__name__, len(d.copy()), len(set(d)))
    report('taken away: by a loop', k, text, {x: None for x in s})       # (this asks for the hash, so it comes last)

    # __hash__ given after.
    class T(str): pass
    k = T(make()); s = {k}; o = {k: 1}
    T.__hash__ = other_hash
    for name, d in [('fromkeys(set)', dict.fromkeys(s)), ('copy', o.copy()), ('update', updated({}, o)), ('set(dict)', set(o)), ('the dict itself', o), ('the set itself', s), ('by a loop', {x: None for x in s})]:
        report('given: ' + name, k, text, d)

    # __eq__ given after.
    class U(str): __hash__ = str.__hash__
    k = U(make()); s = {k}; o = {k: 1}
    U.__eq__ = lambda self, other: False
    for name, d in [('fromkeys(set)', dict.fromkeys(s)), ('copy', o.copy()), ('update', updated({}, o)), ('set(dict)', set(o)), ('the set itself', s), ('by a loop', {x: None for x in s})]:
        report('__eq__ given: ' + name, k, text, d)

    # Another class for the key.
    class V(str): __hash__ = other_hash
    class W(str): pass
    k = V(make()); s = {k}; o = {k: 1}
    k.__class__ = W
    for name, d in [('fromkeys(set)', dict.fromkeys(s)), ('copy', o.copy()), ('update', updated({}, o)), ('set(dict)', set(o)), ('the dict itself', o), ('the set itself', s)]:
        report('__class__: ' + name, k, text, d)
    report('__class__: by a loop', k, text, {x: None for x in s})
    k = W(make()); s = {k}; o = {k: 1}
    k.__class__ = V
    for name, d in [('fromkeys(set)', dict.fromkeys(s)), ('copy', o.copy()), ('update', updated({}, o)), ('set(dict)', set(o)), ('the dict itself', o), ('the set itself', s), ('by a loop', {x: None for x in s})]:
        report('__class__ back: ' + name, k, text, d)

# A hash of the program's that has the same 32 bits once its halves are put together.
def swapped(h):
    u = h & 0xFFFFFFFFFFFFFFFF
    v = ((u & 0xFFFFFFFF) << 32) | (u >> 32)
    return v - (1 << 64) if v >> 63 else v
class K(str):
    def __hash__(self): return swapped(hash(str(self)))
for text in ('m', 'abc', 'x' * 70):
    d = {K(text): 1}
    print(hash(K(text)) == hash(text), d.get(text), K(text) in d, len({K(text): 1, text: 2}), len({text: 2, K(text): 1}))

# A small hash of the program's, kept by a set for a text that nobody has put together yet; then the class loses its __hash__, and the key goes with
# the kept hash into a dict that holds strs.
class H5(str):
    def __hash__(self): return 5
for label, make in MAKERS:
    H5.__hash__ = lambda self: 5
    k = H5(make()); s = {k}
    del H5.__hash__
    f = dict.fromkeys(s)
    d = {'p': 1, 'r': 2}
    d.update(f)
    print('small hash,', label, len(f), len(d), sorted(type(x).__name__ for x in d), type(k in d).__name__, type(make() in d).__name__, 'p' in d, 'r' in d)
