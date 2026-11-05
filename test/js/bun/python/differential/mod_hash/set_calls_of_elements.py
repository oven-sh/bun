# Which __eq__ and __hash__ of its elements a set calls, in what order and how often, and the order it comes to have: random programs on two sets (or frozensets, or
# instances of classes derived from them) with every operation between them, and with lists, dicts, views and iterators; the elements log the
# calls. A line is a digest of the logs, the answers and the sets of 25 programs. (dict_calls_of_keys.py is the same for dicts.)
# Some elements have the hash of a str, and strs lie among the others, so the programs run in children with a PYTHONHASHSEED.
#     set_calls_of_elements.py FIRST COUNT OPERATIONS [SHOW]     is such a child (SHOW: print the log of that one program)
import sys, os, hashlib, subprocess
class Rng:
    def __init__(self, s): self.x = (s * 2654435761 + 12345) & 0xFFFFFFFFFFFFFFFF
    def below(self, n):
        self.x = (self.x * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.x >> 33) % n
log = []
class K:
    def __init__(self, n, h, mode): self.n = n; self.h = h; self.mode = mode
    def __hash__(self): log.append('h%d' % self.n); return self.h
    def __eq__(self, o):
        log.append('e%d:%s' % (self.n, o.n if isinstance(o, K) else repr(o)))
        if self.mode == 0: return isinstance(o, K) and o.n == self.n
        if self.mode == 1: return False
        return isinstance(o, K) and o.n % 3 == self.n % 3
    def __repr__(self): return 'K%d' % self.n
class SK(str):
    def __eq__(self, o): log.append('se:%s:%s' % (str(self), type(o).__name__)); return str.__eq__(self, o)
    __hash__ = str.__hash__
class SS(set): pass
class FS(frozenset): pass
HASHES = [0, 1, 7, 8, -2, -3, 2 ** 36 - 1, 2 ** 61 - 2, -2 ** 63, 2 ** 63 - 1, 2 ** 32, 2 ** 32 + 7, 12345678901234567, -987654321987654321, 5 << 40, 255, 256, 1 << 20, 9, 16, 17]
def shown(s): return type(s).__name__ + repr(list(map(repr, s)))
def run(seed, nops):
    r = Rng(seed)
    log.clear()
    flavour = r.below(6)
    pool = [HASHES[r.below(len(HASHES))] for _ in range(1 + r.below(4))]
    texts = ['a', 'b', 'key', 'x1', 'x2', 'x3', 'long' * 5, 'x4', 'x5', 'x6', 'x7', 'x8']
    def key():
        kind = r.below(10)
        n = r.below(16)
        if flavour == 5: return texts[n % len(texts)] if kind < 8 else K(n, hash(texts[n % len(texts)]), 0)
        if flavour == 0 or kind < 5: return K(n, pool[n % len(pool)], 0 if flavour < 4 else r.below(3))
        if kind < 6: return K(n, hash(texts[n % len(texts)]), 0)
        if kind < 8 and flavour != 1: return texts[n % len(texts)]
        if kind < 9 and flavour != 1: return SK(texts[n % len(texts)])
        return n * 1000003 if flavour != 1 else K(n, n, 0)
    s, t = set(), set()
    def other():
        "t, as one thing or another"
        k = r.below(9)
        return (t, t, t, list(t), frozenset(t), dict.fromkeys(t), dict.fromkeys(t).keys(), iter(list(t)), FS(t))[k]
    for step in range(nops):
        op = r.below(52); k = key()
        log.append('#%d' % op)
        try:
            if op < 9:
                if isinstance(s, set): s.add(k)
            elif op < 11: log.append(repr(k in s))
            elif op < 13:
                if isinstance(s, set): s.discard(k)
            elif op < 14:
                if isinstance(s, set): s.remove(k)
            elif op < 16:
                if isinstance(s, set) and s: log.append(repr(s.pop()))
            elif op < 19: s, t = t, s
            elif op < 20:
                if isinstance(s, set): s.update(other())
            elif op < 21:
                if isinstance(s, set): s.update(other(), [k])
            elif op < 22:
                if isinstance(s, set): s.intersection_update(other())
            elif op < 23:
                if isinstance(s, set): s.difference_update(other())
            elif op < 24:
                if isinstance(s, set): s.symmetric_difference_update(other())
            elif op < 25: s = s.union(other())
            elif op < 26: s = s.intersection(other())
            elif op < 27: s = s.difference(other())
            elif op < 28: s = s.symmetric_difference(other())
            elif op < 29: s = s | t
            elif op < 30: s = s & t
            elif op < 31: s = s - t
            elif op < 32: s = s ^ t
            elif op < 33: s |= t
            elif op < 34: s &= t
            elif op < 35: s -= t
            elif op < 36: s ^= t
            elif op < 37: log.append(repr((s == t, s != t, s <= t, s < t, s >= t, s > t)))
            elif op < 38: log.append(repr((s.issubset(other()), s.issuperset(other()), s.isdisjoint(other()))))
            elif op < 39: s = s.copy()
            elif op < 40:
                if isinstance(s, set): s.clear()
            elif op < 41: s = set(s)
            elif op < 42: s = frozenset(s)
            elif op < 43: s = SS(s)
            elif op < 44: s = FS(s)
            elif op < 45: s = {x for x in s}
            elif op < 46: s = set(list(s))
            elif op < 47:
                if isinstance(s, set): s.__init__(other())
            elif op < 48:
                if isinstance(s, set):
                    while len(s) > 2: s.pop()
            elif op < 49:
                if isinstance(s, set):
                    for x in list(s)[:r.below(6)]: s.discard(x)
            elif op < 50: log.append(repr(hash(frozenset(s)) == hash(frozenset(list(s)))))
            elif op < 51: s = s.union(other(), other())
            else: log.append(shown(s))
        except KeyError: log.append('KeyError')
    log.append(shown(s)); log.append(shown(t))
    for c in (s, t):
        listed = list(c)
        mute = len(log)
        ok = len(listed) == len(c) and all(x in c for x in listed)
        del log[mute:]
        log.append('sound' if ok else 'UNSOUND')
    return ' '.join(log)

if len(sys.argv) > 1:
    first, count, nops = map(int, sys.argv[1:4])
    show = int(sys.argv[4]) if len(sys.argv) > 4 else None
    for start in range(first, first + count, 25):
        digest = hashlib.sha256()
        for seed in range(start, min(start + 25, first + count)):
            text = run(seed, nops)
            digest.update(text.encode())
            if seed == show: print(text)
        print(nops, start, digest.hexdigest()[:16])
else:
    children = []
    for hashseed in ('0', '12345'):
        for arguments in ((0, 300, 60), (1000, 100, 150), (2000, 200, 20)):
            children.append((hashseed, subprocess.Popen([sys.executable, __file__, *map(str, arguments)], env=dict(os.environ, PYTHONHASHSEED=hashseed), stdout=subprocess.PIPE, text=True)))
    for hashseed, child in children:
        out = child.communicate()[0]
        print('PYTHONHASHSEED', hashseed, 'status', child.returncode)
        print(out, end='')
