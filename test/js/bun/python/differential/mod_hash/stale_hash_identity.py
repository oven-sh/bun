# A key whose hash has changed since it was stored. A search goes by the new hash, so it comes by the key only by chance: here, if the two hashes
# have the same low bits. Then a dict and a frozenset find the very object without looking at the hash they have kept; a set looks at the
# hash first and does not find it. Nobody's __eq__ is asked in any of this. (All hashes are small numbers of the program's choosing.)
import collections, types

class K:
    h = 1
    def __init__(self, name): self.name = name
    def __hash__(self): return K.h
    def __eq__(self, other):
        print('    asked', self.name, getattr(other, 'name', other))
        return self is other
    def __repr__(self): return self.name

class FS(frozenset): pass
class SS(set): pass
class DD(dict): pass

def T(f):
    try: return f()
    except Exception as e: return type(e).__name__

def containers(k):
    yield 'dict', {k: 1}
    yield 'dict among ints', {16: 0, k: 1, 24: 2}
    yield 'subclass of dict', DD({k: 1})
    yield 'OrderedDict', collections.OrderedDict([(k, 1)])
    yield 'defaultdict', collections.defaultdict(int, {k: 1})
    yield 'Counter', collections.Counter([k])
    yield 'mappingproxy', types.MappingProxyType({k: 1})
    yield 'keys', {k: 1}.keys()
    yield 'items', {k: 1}.items()
    yield 'set', {k}
    yield 'set among ints', {16, k, 24}
    yield 'subclass of set', SS([k])
    yield 'frozenset', frozenset([k])
    yield 'frozenset among ints', frozenset([16, k, 24])
    yield 'frozenset of a set', frozenset({k})
    yield 'subclass of frozenset', FS([k])

for new in (1, 9, 17, 1 + (1 << 40), 2, -7):   # 9, 17 and 1 + 2**40 begin at the same slot of a table of 8 as 1; 2 and -7 do not
    K.h = 1
    k = K('k')
    made = list(containers(k))
    K.h = new
    print('hash', new)
    for name, c in made:
        probe = (k, 1) if name == 'items' else k
        row = [probe in c]
        if hasattr(c, 'get'): row += [c.get(k), T(lambda: c[k])]
        if isinstance(c, (set, frozenset)):
            one = {k}
            row += [len(c & one), len(one & c), len(c - one), len(one - c), len(c ^ one), len(c | one), c.issuperset([k]), c.isdisjoint([k]), one <= c, c <= one, c == one, one == c]
        print(' ', name, row)
    # What changes the container, last.
    for name, c in made:
        if isinstance(c, dict):
            print(' ', name, 'setdefault', c.setdefault(k, 5), len(c), 'store', T(lambda: c.__setitem__(k, 6)), len(c), 'pop', T(lambda: c.pop(k)), len(c), 'del', T(lambda: c.__delitem__(k)), len(c))
        elif isinstance(c, set):
            print(' ', name, 'discard', c.discard(k), len(c), 'add', c.add(k), len(c), 'remove', T(lambda: c.remove(k)), len(c))
