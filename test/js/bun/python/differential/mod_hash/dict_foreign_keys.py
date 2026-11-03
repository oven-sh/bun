# Dicts with str keys that are asked for, or given, keys of other classes that say they are equal to a str: in the middle of iterations, of other lookups, of everything.
import collections, types, sys

class Like:
    def __init__(self, text): self.text = text
    def __hash__(self): return hash(self.text)
    def __eq__(self, other): return self.text == (other.text if isinstance(other, Like) else other)
    def __repr__(self): return 'Like(%r)' % self.text
class S(str): pass
class SH(str):
    def __hash__(self): return hash(str(self))
class SE(str):
    def __eq__(self, other): return str(self).lower() == str(other).lower()
    def __hash__(self): return hash(str(self).lower())
class SN(str):
    __hash__ = None

def fresh(n=50): return {'k%d' % i: i for i in range(n)}

# ---- while iterating ----
d = fresh()
seen = []
for i, k in enumerate(d):
    seen.append(k)
    if i == 10: print(d[Like('k3')], Like('k49') in d, Like('zz') in d)
    if i == 20: print(d.get(SE('K7')), d.get(SH('k8')), d.get(S('k9')))
print(seen == list(fresh()), len(seen))
d = fresh()
it, items, values, rev = iter(d), iter(d.items()), iter(d.values()), reversed(d)
print(next(it), next(items), next(values), next(rev))
keys_view, items_view = d.keys(), d.items()
print(Like('k5') in keys_view, ('k5', 5) in items_view, (Like('k5'), 5) in items_view, (Like('k5'), 6) in items_view)
print(next(it), next(items), next(values), next(rev), len(list(it)), len(list(items)), len(list(values)), len(list(rev)))
print(sorted(keys_view & {Like('k1'), 'k2', 'nope'}, key=repr), sorted(keys_view - {Like('k%d' % i) for i in range(48)}))
d = fresh(5)
try:
    for k in d:
        d[Like('new')] = 1
except RuntimeError as e: print('RuntimeError', e)
d = fresh(5)
for k in d: d[Like(k)] = d[k] * 2          # No new key: the size stays.
print(d)

# ---- every operation, with each kind of key ----
for make in [Like, S, SH, SE, str]:
    d = fresh(8)
    k = make('k3')
    print(make.__name__, d[k], k in d, d.get(k), d.setdefault(k, 'x'), d.pop(k), k in d, d.get(k, 'gone'), d.setdefault(k, 'new'), type(list(d)[-1]).__name__, len(d))
    d[make('k4')] = 'replaced'; print(d['k4'], type([x for x in d if x == 'k4'][0]).__name__, len(d))
    del d[make('k5')]; print('k5' in d, len(d))
    d.update({make('k6'): 'updated', make('other'): 1}); print(d['k6'], d['other'], len(d), 'other' in d, d.get('other'))
    e = {make('a'): 1}; e['a'] = 2; e['b'] = 3; print(e, len(e), type(next(iter(e))).__name__, e[make('b')], e.get(make('c')))
    print({**fresh(3), make('k1'): 'x'}, dict(fresh(3), k1='y'), fresh(3) | {make('k2'): 'z'}, {make('k0'): 0, make('k1'): 1, make('k2'): 2} == fresh(3), fresh(3) == {make('k0'): 0, make('k1'): 1, make('k2'): 2})
try: {'a': 1}[SN('a')]
except TypeError as e: print('TypeError', e)
print({SE('Key'): 1}.get('KEY'), {SE('Key'): 1}.get('key'), {'key': 1}.get(SE('KEY')), {'KEY': 1}.get(SE('key')), {'key': 1, 'KEY': 2}.get(SE('Key')))

# ---- a lookup inside a lookup ----
d = fresh()
class Nosy:
    def __init__(self, v): self.v = v
    def __hash__(self): return hash(self.v)
    def __eq__(self, other):
        # Asks the dict that is being searched, with a key of a class of its own.
        log.append((d.get(Like('k7')), Like('k8') in d))
        return isinstance(other, Nosy) and self.v == other.v
log = []
d[(Nosy(1), 'a')] = 'tuple'
print(d[(Nosy(1), 'a')], d.get((Nosy(2), 'a')), log, d['k7'], d[Like('k9')], len(d))
d = fresh(); log = []
d[(1, 'a')] = 'plain tuple'; d[frozenset([Nosy(5)])] = 'frozenset'
print(d[frozenset([Nosy(5)])], log[:1], d[(1, 'a')], d['k1'])
class HashAsks:
    def __hash__(self):
        log.append(d.get(Like('k2')))
        return 5
d = fresh(); log = []
d[HashAsks()] = 1; print(log, len(d), d['k2'], d.get(5))
class Grows:
    def __hash__(self): return hash('k1')
    def __eq__(self, other):
        for i in range(200): d['g%d' % i] = i
        return other == 'k1'
d = fresh(); print(d[Grows()], len(d), d['g199'], d['k49'])
class Clears:
    def __hash__(self): return hash('k1')
    def __eq__(self, other): d.clear(); return True
d = fresh()
try: print(d[Clears()])
except KeyError as e: print('KeyError')
print(len(d)); d['a'] = 1; print(d, d[Like('a')])

# ---- a class that changes its mind ----
class Late: pass
late = Late()
d = {'abc': 1, late: 2}
print(d[late], d['abc'])
Late.__eq__ = lambda self, other: other == 'abc' or self is other
Late.__hash__ = lambda self: hash('abc')
print(d[Late()], d['abc'], late in d, len(d))
class LateStr(str): pass
ls = LateStr('abc')
d = {ls: 1, 'x': 2}
print(d['abc'], d[ls], d[LateStr('abc')])
LateStr.__hash__ = lambda self: 12345
print(d['abc'], d.get(LateStr('abc')), 12345 in d)
d = {'abc': 1}
o = Late.__new__(Late); print(d[o]); o.__class__ = type('Other', (), {}); print(d.get(o))

# ---- the dicts of the interpreter ----
ns = types.SimpleNamespace(alpha=1, beta=2)
print(vars(ns)[Like('alpha')], ns.alpha, ns.beta); ns.gamma = 3; print(vars(ns)[Like('gamma')], ns.gamma, sorted(vars(ns)))
class C:
    x = 1
    def m(self): return self.x
c = C(); c.y = 2
print(C.__dict__[Like('x')], Like('m') in C.__dict__, c.__dict__[Like('y')], c.y, c.x, c.m()); c.z = 3; C.w = 4; print(c.z, c.w, c.__dict__[Like('z')], C.__dict__[Like('w')], getattr(c, S('z')), getattr(c, 'w'))
g = {'a': 1, 'b': 2}
print(g[Like('a')], eval('a + b', g), Like('__builtins__') in g); exec('c = a + b', g); print(g['c'], g[Like('c')], eval('c', g))
print(globals()[Like('collections')] is collections, Like('no_such_name') in globals(), collections.__name__)
def f(**kw): return kw[Like('p')], kw.get(SE('Q')), sorted(kw)
print(f(p=1, q=2), f(**{'p': 3, S('q'): 4}))
m = sys.modules; print(m[Like('sys')] is sys, 'sys' in m, m['sys'] is sys)
import os; print(Like('PATH') in os.environ._data or True)

# ---- other kinds of dict ----
od = collections.OrderedDict((('k%d' % i, i) for i in range(6)))
print(od[Like('k2')]); od.move_to_end(Like('k1')); od.move_to_end(SE('K4'), last=False); print(list(od), od.pop(Like('k0')), od.popitem(), list(reversed(od)))
dd = collections.defaultdict(int, a=1); dd[Like('a')] += 1; dd[Like('b')] += 1; print(dict(dd), dd['b'])
cn = collections.Counter('abca'); cn[Like('a')] += 5; cn.update([Like('b'), 'b', S('c')]); print(sorted(cn.items(), key=repr), cn['a'])
mp = types.MappingProxyType({'a': 1}); print(mp[Like('a')], Like('a') in mp)
cm = collections.ChainMap({'a': 1}, {'b': 2}); print(cm[Like('b')], Like('a') in cm)
us = collections.UserString('abc'); print({'abc': 1}[us], {us: 1}['abc'], us in {'abc'}, 'abc' in {us}, len({us, 'abc'}))

# ---- sets ----
s = {'k%d' % i for i in range(50)}
n = 0
for x in s:
    n += 1
    if n == 10: print(Like('k3') in s, SE('K4') in s, Like('zz') in s, S('k5') in s)
print(n, len(s), len(s | {Like('k1'), Like('new')}), len(s & {Like('k1'), Like('new')}), len(s - {Like('k1')}), len(s ^ {Like('k1'), 'new'}), s >= {Like('k1')}, {Like('k1')} <= s, s.isdisjoint({Like('k1')}))
s.discard(Like('k1')); s.remove(SE('K2')); s.add(Like('k3')); print(len(s), 'k1' in s, 'k2' in s, sum(1 for x in s if x == 'k3'), type([x for x in s if x == 'k3'][0]).__name__)
print(frozenset(['a', 'b']) == frozenset([Like('a'), Like('b')]), hash(frozenset(['a', 'b'])) == hash(frozenset([Like('a'), Like('b')])), {('a', 1): 2}[(Like('a'), 1)], ('a', 1) in {(Like('a'), 1)})

# ---- many keys, mixed, removed, added again ----
d = {}
for i in range(3000):
    d['s%d' % i] = i
    if i % 7 == 0: d[i] = -i
    if i % 11 == 0: d[('t', i)] = i
    if i % 500 == 499: d[Like('s%d' % (i - 100))] = 'like'
    if i % 3 == 0 and i: del d['s%d' % (i - 1)]
print(len(d), sum(1 for k in d if isinstance(k, str)), d['s2899'], d[Like('s2999')], d[2996], d[('t', 2992)], [d['s%d' % i] for i in (399, 899, 1399)], 's2' in d, Like('s2') in d)
print(list(d)[:6], list(d)[-4:])
big = {str(i): i for i in range(200000)}
print(all(big[str(i)] == i for i in range(0, 200000, 997)), big[Like('199999')], len(big), next(iter(big)), big.popitem())
