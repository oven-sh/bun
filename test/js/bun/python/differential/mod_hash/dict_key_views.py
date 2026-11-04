# The set operations of key and item views: the order of the result (the keys are ints, so no seed matters), and which __hash__ and __eq__ are called for it.
log = []
class K:
    def __init__(self, n): self.n = n
    def __hash__(self): log.append('h%d' % self.n); return self.n
    def __eq__(self, o): log.append('e%d:%d' % (self.n, o.n)); return self.n == o.n
    def __repr__(self): return 'K%d' % self.n
def ev(): r = ' '.join(log); log.clear(); return r
import itertools
for n in (0, 1, 3, 5, 6, 8, 11, 16, 20, 22, 40):
    d = {i * 7 % 64: i for i in range(n)}
    e = [i * 5 % 64 for i in range(n // 2 + 1)]
    for name, f in [('|', lambda: d.keys() | e), ('&', lambda: d.keys() & e), ('-', lambda: d.keys() - e), ('^', lambda: d.keys() ^ e), ('r|', lambda: set(e) | d.keys()), ('r&', lambda: set(e) & d.keys()), ('r-', lambda: set(e) - d.keys()), ('r^', lambda: set(e) ^ d.keys()),
                    ('items |', lambda: d.items() | [(1, 1)]), ('items &', lambda: d.items() & [(0, 0), (7, 1)]), ('items -', lambda: d.items() - [(0, 0)]), ('items ^', lambda: d.items() ^ [(0, 0), (99, 99)]),
                    ('| dict', lambda: d.keys() | {1: 1, 2: 2}), ('| keys', lambda: d.keys() | {1: 1, 2: 2}.keys()), ('& keys', lambda: d.keys() & {0: 1, 7: 2, 9: 3}.keys()), ('set', lambda: set(d)), ('set keys', lambda: set(d.keys())), ('frozenset', lambda: frozenset(d))]:
        print(n, name, list(f()))
for n in (1, 3, 5, 6, 11):
    d = {K(i): i for i in range(n)}; ev()
    other = [K(i) for i in range(0, n + 2, 2)]
    for name, f in [('|', lambda: d.keys() | other), ('&', lambda: d.keys() & other), ('-', lambda: d.keys() - other), ('^', lambda: d.keys() ^ other), ('isdisjoint', lambda: d.keys().isdisjoint(other)), ('==', lambda: d.keys() == set(d)),
                    ('<=', lambda: d.keys() <= set(d)), ('set', lambda: set(d)), ('set keys', lambda: set(d.keys())), ('dict', lambda: dict(d)), ('== dict', lambda: d == dict(d)), ('fromkeys', lambda: dict.fromkeys(d)), ('list', lambda: list(d.keys())),
                    ('items &', lambda: d.items() & [(K(0), 0)]), ('items |', lambda: d.items() | [(K(0), 0)])]:
        ev(); r = f(); print(n, name, len(r) if hasattr(r, '__len__') else r, '|', ev())
