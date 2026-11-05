# Which __eq__ and __hash__ of its keys a dict calls, in what order and how often. With keys whose hashes have the same low bits that depends on where each
# key lies in the table, and so on everything that has happened to the dict: how large the table was made, when it was made anew, which slots
# deletions have left, what was copied as it is. Random programs on one dict, and on two with everything that takes the keys of one into another
# (and into sets); the keys log the calls. A line is a digest of the logs, the answers and the dicts of 25 programs.
# Some keys have the hash of a str, and strs lie among the others, so the programs run in children with a PYTHONHASHSEED.
#     dict_calls_of_keys.py KIND FIRST COUNT OPERATIONS [SHOW]     is such a child (SHOW: print the log of that one program)
import sys, os, hashlib, subprocess
log = []
class Rng:
    def __init__(self, s): self.x = (s * 2654435761 + 12345) & 0xFFFFFFFFFFFFFFFF
    def below(self, n):
        self.x = (self.x * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.x >> 33) % n
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
HASHES = [0, 1, 7, 8, -2, -3, 2 ** 36 - 1, 2 ** 61 - 2, -2 ** 63, 2 ** 63 - 1, 2 ** 32, 2 ** 32 + 7, 12345678901234567, -987654321987654321, 5 << 40, 255, 256, 1 << 20]
def one_dict(seed, nops):
    r = Rng(seed)
    log.clear()
    flavour = r.below(6)
    pool = [HASHES[r.below(len(HASHES))] for _ in range(1 + r.below(4))]
    texts = ['a', 'b', 'key', 'x1', 'x2', 'x3', 'long' * 5]
    def key():
        kind = r.below(10)
        n = r.below(12)
        if flavour == 0 or kind < 5: return K(n, pool[n % len(pool)], 0 if flavour < 4 else r.below(3))
        if kind < 6: return K(n, hash(texts[n % len(texts)]), 0)
        if kind < 8 and flavour != 1: return texts[n % len(texts)]
        if kind < 9 and flavour != 1: return SK(texts[n % len(texts)])
        return n * 1000003 if flavour != 1 else K(n, n, 0)
    d = {}
    for step in range(nops):
        op = r.below(20); k = key()
        log.append('#%d' % op)
        try:
            if op < 7: d[k] = step
            elif op < 10: log.append(repr(d.get(k)))
            elif op < 12: log.append(repr(k in d))
            elif op < 14: log.append(repr(d.pop(k, None)))
            elif op < 15: log.append(repr(d.setdefault(k, step)))
            elif op < 16:
                if d: log.append(repr(d.popitem()))
            elif op < 17:
                try: del d[k]
                except KeyError: log.append('KeyError')
            elif op < 18: log.append(repr(list(d.items())))
            elif op < 19 and flavour == 3: d = dict(d) if r.below(2) else d.copy()
            elif flavour == 3: e = {}; e.update(d); d = e
        except RecursionError: log.append('RecursionError')
    log.append(repr(list(d.items())))
    return ' '.join(log)
class DD(dict): pass
def show_set(s): return list(map(repr, s))
def two_dicts(seed, nops):
    r = Rng(seed)
    log.clear()
    flavour = r.below(6)
    pool = [HASHES[r.below(len(HASHES))] for _ in range(1 + r.below(4))]
    texts = ['a', 'b', 'key', 'x1', 'x2', 'x3', 'long' * 5, 'x4', 'x5', 'x6', 'x7', 'x8']
    def key():
        kind = r.below(10)
        n = r.below(14)
        if flavour == 5: return texts[n % len(texts)] if kind < 9 else K(n, hash(texts[n % len(texts)]), 0)     # strs, and now and then a stranger
        if flavour == 0 or kind < 5: return K(n, pool[n % len(pool)], 0 if flavour < 4 else r.below(3))
        if kind < 6: return K(n, hash(texts[n % len(texts)]), 0)
        if kind < 8 and flavour != 1: return texts[n % len(texts)]
        if kind < 9 and flavour != 1: return SK(texts[n % len(texts)])
        return n * 1000003 if flavour != 1 else K(n, n, 0)
    d, e = {}, {}
    for step in range(nops):
        op = r.below(62); k = key()
        log.append('#%d' % op)
        if op < 10: d[k] = step
        elif op < 12: log.append(repr(d.get(k)))
        elif op < 13: log.append(repr(k in d))
        elif op < 15: log.append(repr(d.pop(k, None)))
        elif op < 16: log.append(repr(d.setdefault(k, step)))
        elif op < 18:
            if d: log.append(repr(d.popitem()))
        elif op < 19:
            try: del d[k]
            except KeyError: log.append('KeyError')
        elif op < 22: d, e = e, d
        elif op < 23: d.update(e)
        elif op < 24: d |= e
        elif op < 25: d = d | e
        elif op < 26: d = {**d, **e}
        elif op < 27: d = dict(e)
        elif op < 28: d = e.copy()
        elif op < 29: d.clear()
        elif op < 30: log.append(repr(d == e))
        elif op < 31: log.append(repr(show_set(set(d))))
        elif op < 32: d = dict.fromkeys(e, step)
        elif op < 33: d = dict.fromkeys(set(e), step) if flavour in (0, 1) else dict.fromkeys(e)
        elif op < 34: log.append(repr(show_set(d.keys() & e.keys())))
        elif op < 35: log.append(repr(show_set(d.keys() | e.keys())))
        elif op < 36: log.append(repr(show_set(d.keys() - e.keys())))
        elif op < 37: d.update(list(e.items()))
        elif op < 38: d = {a: b for a, b in e.items()}
        elif op < 39: d.__init__(e)
        elif op < 40: d = DD(e)
        elif op < 41: d = dict(d, **{t: step for t in texts[:r.below(4)]})
        elif op < 42:
            while len(d) > 2: d.popitem()
        elif op < 43:
            for x in list(d)[:r.below(6)]: del d[x]
        elif op < 45: log.append(repr(list(d.items())))
        elif op < 46: log.append(repr(show_set(d.keys() ^ e.keys())))
        elif op < 47: log.append(repr(show_set(d.keys() ^ list(e))))
        elif op < 48: log.append(repr(show_set(d.keys() - list(e))))
        elif op < 49: log.append(repr(show_set(list(d) - e.keys())))
        elif op < 50: log.append(repr(show_set(set(d) - e.keys())))
        elif op < 51: log.append(repr(show_set(set(d).difference(e))))
        elif op < 52: log.append(repr(show_set(set(d) & e.keys())))
        elif op < 53: log.append(repr(show_set(set(d).symmetric_difference(e))))
        elif op < 54:
            t = set(d); t.update(e); log.append(repr(show_set(t)))
        elif op < 55: log.append(repr((d.keys() <= e.keys(), d.keys() == e.keys(), d.keys().isdisjoint(e.keys()), d.keys() >= set(e))))
        elif op < 56: d.update(**{t: step for t in texts[:r.below(9)]})
        elif op < 57: d = dict.fromkeys(frozenset(e), step)
        elif op < 58: log.append(repr(sorted(map(repr, d.items() & e.items()))))
        elif op < 59: log.append(repr(sorted(map(repr, d.items() - e.items()))))
        elif op < 60: log.append(repr(sorted(map(repr, d.items() ^ e.items()))))
        elif op < 61: log.append(repr(sorted(map(repr, d.items() | e.items()))))
        else:
            t = set(d); t.intersection_update(e); t.add(k); log.append(repr(show_set(t)))
    log.append(repr(list(d.items()))); log.append(repr(list(e.items())))
    for c in (d, e):
        listed = list(c)
        mute = len(log)
        ok = len(listed) == len(c) and all(x in c for x in listed)
        del log[mute:]
        log.append('sound' if ok else 'UNSOUND')
    return ' '.join(log)

if len(sys.argv) > 1:
    run = {'one': one_dict, 'two': two_dicts}[sys.argv[1]]
    first, count, nops = map(int, sys.argv[2:5])
    show = int(sys.argv[5]) if len(sys.argv) > 5 else None
    for start in range(first, first + count, 25):
        digest = hashlib.sha256()
        for seed in range(start, min(start + 25, first + count)):
            text = run(seed, nops)
            digest.update(text.encode())
            if seed == show: print(text)
        print(sys.argv[1], nops, start, digest.hexdigest()[:16])
else:
    children = []
    for hashseed in ('0', '12345'):
        for arguments in (('one', 0, 300, 40), ('one', 1000, 100, 120), ('one', 2000, 200, 15), ('two', 0, 300, 60), ('two', 1000, 100, 150), ('two', 2000, 200, 20)):
            children.append((hashseed, subprocess.Popen([sys.executable, __file__, *map(str, arguments)], env=dict(os.environ, PYTHONHASHSEED=hashseed), stdout=subprocess.PIPE, text=True)))
    for hashseed, child in children:
        out = child.communicate()[0]
        print('PYTHONHASHSEED', hashseed, 'status', child.returncode)
        print(out, end='')
