# A key is asked whether it is equal to another only if their hashes are the same, all 64 bits of them, however few of those bits a
# table goes by: __eq__ can tell.
class K:
    log = []
    def __init__(self, value, name): self.value, self.name = value, name
    def __hash__(self): return self.value
    def __eq__(self, other):
        K.log.append((self.name, getattr(other, 'name', other)))
        return self is other or (isinstance(other, K) and self.name == other.name)
    def __repr__(self): return 'K(%s)' % self.name

def twins(value):
    """Other hashes of which the upper and the lower half, combined, come to the same as those of `value`, with the same low bits."""
    for b in (8, 1 << 10, 0x12345678 & ~7, 1 << 28):
        yield value ^ (b << 32 | b)

def check(label, container, probes):
    K.log.clear()
    results = []
    for p in probes:
        results.append(p in container)
        if isinstance(container, dict): results += [container.get(p), container.setdefault(p, 'new') == 'new', container.pop(p)]
        else: container.add(p); container.discard(p)
    print(label, results, K.log)

for value in (0, 7, 12345, 2**31, 2**32 - 1, 2**40 + 3, -5, -2**62):
    check('dict %d' % value, {K(value, 'a'): 1}, [K(t, 'b') for t in twins(value)])
    check('set %d' % value, {K(value, 'a')}, [K(t, 'b') for t in twins(value)])
    check('mixed %d' % value, {K(value, 'a'): 1, 'text': 2, 3: 4}, [K(t, 'b') for t in twins(value)])
    check('ints %d' % value, {value: 1}, [K(t, 'b') for t in twins(value)])
for text in ('abc', '', 'é', '€', '\U0001f600', 'x' * 100):
    check('str %r' % text[:5], {text: 1, 'other': 2}, [K(t, 'b') for t in twins(hash(text))])
    check('set of str %r' % text[:5], {text, 'other'}, [K(t, 'b') for t in twins(hash(text))])
    for t in twins(hash(text)):
        d = {K(t, 'a'): 1}
        K.log.clear()
        print(text in d, d.get(text), d.setdefault(text, 2), len(d), d.pop(text), K.log)
    # With the same hash it is asked. (More than once, if the search comes by the same slot again.)
    d = {text: 1, 'other': 2}
    K.log.clear()
    print(K(hash(text), 'same') in d, sorted({(a, b[:5]) for a, b in K.log}))
    d = {K(hash(text), 'same'): 1}
    K.log.clear()
    print(text in d, sorted({(a, b[:5]) for a, b in K.log}))
