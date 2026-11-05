# Keys that are instances of classes derived from str, with an __eq__ or a __hash__ of their own or without, stored and looked for, in dicts
# and sets of all kinds: who is found, and who is asked. (How often a key is asked depends on how often the search comes by its slot, which
# depends on the hashes: so what is shown is who was asked what, not how many times.)
import collections

log = []
def events():
    seen = sorted(set(log)); log.clear(); return seen
class S(str): pass
class Never(str):
    def __eq__(self, other): log.append(('Never.__eq__', type(other).__name__)); return False
    __hash__ = str.__hash__
class Always(str):
    def __eq__(self, other): log.append(('Always.__eq__', type(other).__name__)); return True
    __hash__ = str.__hash__
class Hashes(str):
    def __hash__(self): log.append(('Hashes.__hash__',)); return str.__hash__(self)
class Fold(str):
    def __eq__(self, other): log.append(('Fold.__eq__', type(other).__name__)); return str(self).lower() == str(other).lower()
    def __hash__(self): log.append(('Fold.__hash__',)); return hash(str(self).lower())
class Unsure(str):
    def __eq__(self, other): log.append(('Unsure.__eq__', type(other).__name__)); return NotImplemented
    __hash__ = str.__hash__
class Like:
    def __init__(self, text): self.text = text
    def __eq__(self, other): log.append(('Like.__eq__', type(other).__name__)); return self.text == (other.text if isinstance(other, Like) else other)
    def __hash__(self): log.append(('Like.__hash__',)); return hash(self.text)
KINDS = [str, S, Never, Always, Hashes, Fold, Unsure, Like]
class D(dict): pass
MAPPINGS = [dict, D, collections.OrderedDict, lambda pairs=(): collections.defaultdict(int, pairs), collections.Counter]
SETS = [set, frozenset]

for stored in KINDS:
    for probe in KINDS:
        for make in MAPPINGS:
            d = make([(stored('m'), 1), ('other', 2)]); made = events()
            row = [stored.__name__, probe.__name__, type(d).__name__, made]
            p = probe('m'); log.clear()
            row += [p in d, events(), d.get(p), events(), d.setdefault(p, 3), len(d), events(), type(next(iter(d))).__name__]
            d = make([(stored('m'), 1), ('other', 2)]); log.clear()
            d[p] = 4; row += [len(d), sorted(map(str, d.values())), events()]
            d = make([(stored('m'), 1), ('other', 2)]); log.clear()
            row += [d.pop(p, 'absent'), len(d), events()]
            d = make([(stored('m'), 1), ('other', 2)]); log.clear()
            row += [p in d.keys(), (p, 1) in d.items(), events(), len(d | {p: 5}) if make is not MAPPINGS[4] else None, events(), d == {p: 1, 'other': 2}, events()]
            print(*row)
        for make in SETS:
            s = make([stored('m'), 'other']); log.clear()
            p = probe('m'); log.clear()
            row = [stored.__name__, probe.__name__, make.__name__, p in s, events(), len(s | {p}), events(), len(s & {p}), events(), len(s - {p}), events(), s == {p, 'other'}, events(), s.isdisjoint([p]), events()]
            if make is set:
                s.add(p); row += [len(s), events()]; s.discard(p); row += [len(s), events()]
            print(*row)
        print(stored.__name__, probe.__name__, 'displays', len({stored('m'): 1, probe('m'): 2}), events(), len({stored('m'), probe('m')}), events(), len(dict([(stored('m'), 1), (probe('m'), 2)])), events(),
              len(dict.fromkeys([stored('m'), probe('m')])), events(), len({**{stored('m'): 1}, **{probe('m'): 2}}), events())
# Other texts, and upper case for the one that folds.
for stored, probe in [(Fold('KEY'), 'key'), (Fold('KEY'), 'KEY'), ('key', Fold('KEY')), ('KEY', Fold('key')), (Never('a'), 'b'), (Always('a'), 'b'), ('a', Always('b')), (Always('a'), Always('b'))]:
    log.clear()
    print(type(stored).__name__, str(stored), type(probe).__name__, str(probe), probe in {stored: 1}, events(), probe in {stored}, events(), len({stored: 1, probe: 2}), events())
# Many strs around them, so that the dict has been through what a dict of strs goes through.
for stored in KINDS:
    d = {'k%d' % i: i for i in range(100)}
    d[stored('m')] = 'stored'; log.clear()
    print(stored.__name__, d.get('m'), events(), d.get('k5'), d.get('nope'), events(), 'm' in d, len(d), d.pop('m', 'absent'), len(d), events())
