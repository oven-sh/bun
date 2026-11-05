# A dict places its str keys by a hash that comes for free until it has a reason to place them by hash(): a key that might say it
# is equal to a str, a search that takes too long, a great many keys. The change comes in the middle of whatever the program is doing
# with the dict, and nothing of it is to be seen. Here it is brought about by asking the dict for a Probe.
import collections, copy, gc, json, pickle, random, sys, threading, types, weakref

class Probe:
    def __hash__(self): return 12345
    def __eq__(self, other): return False
def switch(mapping): return Probe() in mapping

class Like:
    def __init__(self, text): self.text = text
    def __hash__(self): return hash(self.text)
    def __eq__(self, other): return self.text == (other.text if isinstance(other, Like) else other)
    def __repr__(self): return 'Like(%r)' % self.text
class S(str): pass
class D(dict): pass
class Missing(dict):
    def __missing__(self, key): return 'missing %r' % (key,)

def names(n, prefix='k'): return [prefix + str(i) for i in range(n)]
def fill(mapping, n):
    for i, k in enumerate(names(n)): mapping[k] = i
    return mapping
FACTORIES = [('dict', dict), ('D', D), ('Missing', Missing), ('OrderedDict', collections.OrderedDict), ('defaultdict', lambda: collections.defaultdict(int)),
             ('Counter', collections.Counter)]
SIZES = [0, 1, 5, 6, 10, 11, 100]

# ---- Every operation, before and after ----
def show(mapping): return '%s %d %s' % (type(mapping).__name__, len(mapping), list(mapping.items())[:4] + list(mapping.items())[-2:])
OPERATIONS = [
    ('getitem', lambda d: [d[k] for k in list(d)]),
    ('get', lambda d: (d.get('k0'), d.get('k3'), d.get('nope'), d.get('nope', 5), d.get(''), d.get('k'))),
    ('contains', lambda d: ('k0' in d, 'k5' in d, 'k99' in d, 'k100' in d, '' in d, 0 in d, None in d, ('k0',) in d, b'k0' in d)),
    ('setitem old', lambda d: [d.__setitem__(k, -1) for k in list(d)[::2]] and show(d)),
    ('setitem new', lambda d: [d.__setitem__(k, -1) for k in names(30, 'n')] and show(d)),
    ('delitem', lambda d: [d.__delitem__(k) for k in list(d)[::3]] and show(d)),
    ('pop', lambda d: ([d.pop(k) for k in list(d)[1::2]], d.pop('nope', 'default'), show(d))),
    ('popitem', lambda d: ([d.popitem() for _ in range(len(d) // 2)], show(d))),
    ('setdefault', lambda d: (d.setdefault('k0', 7), d.setdefault('fresh', 8), d.setdefault('fresh', 9), show(d))),
    ('update', lambda d: (d.update({'k0': 'u', 'u1': 1}), d.update([('u2', 2), ('k1', 'u')]), d.update(u3=3, k2='u'), show(d))),
    ('or', lambda d: (show(d | {'k0': 'o', 'o1': 1}), show({'k0': 'o', 'o1': 1} | d), show(d))),
    ('ior', lambda d: (d.__ior__({'k0': 'o', 'o1': 1}) is d, show(d))),
    ('copy', lambda d: (show(d.copy()), show(copy.copy(d)), show(copy.deepcopy(d)), show(dict(d)), show({**d}), d.copy() == d)),
    ('pickle', lambda d: [show(pickle.loads(pickle.dumps(d, protocol))) for protocol in (0, 2, 5)]),
    ('clear', lambda d: (d.clear(), show(d), d.update(a=1), show(d), 'a' in d, 'k0' in d)),
    ('views', lambda d: (list(d.keys())[:3], list(d.values())[:3], list(d.items())[:3], list(reversed(d))[:3], list(reversed(d.items()))[:2], len(d.keys()), 'k0' in d.keys(), ('k0', 0) in d.items(), 0 in d.values())),
    ('view sets', lambda d: (sorted(d.keys() & {'k0', 'k1', 'zz'}), sorted(d.keys() | {'zz'})[-2:], sorted(d.keys() - {'k0'})[:2], sorted(d.keys() ^ {'k0', 'zz'})[-2:], d.keys() == set(d), d.keys().isdisjoint(['zz']), d.keys() <= set(names(200)))),
    ('to set', lambda d: (sorted(set(d))[:3], sorted(frozenset(d))[:3], hash(frozenset(d)) == hash(frozenset(list(d)[::-1])), set(d) == set(list(d)), sorted({'k0', 'zz'} - d.keys()), sorted({'k0', 'zz'}.intersection(d)), sorted({'k0', 'zz'}.difference(d)), sorted({'k0', 'zz'}.symmetric_difference(d))[-2:])),
    ('fromkeys', lambda d: (show(dict.fromkeys(d)), show(dict.fromkeys(d, 1)), show(type(d).fromkeys(d, 2)) if type(d) not in (collections.defaultdict, collections.Counter) else None, show(dict.fromkeys(sorted(set(d)))))),
    ('equal', lambda d: (d == dict(d), dict(d) == d, d == {**d, 'x': 1}, d != dict(d), d == dict(reversed(list(d.items()))), d == fill({}, len(d)))),
    ('kwargs', lambda d: ((lambda **kw: show(kw))(**d), (lambda k0=None, **kw: (k0, show(kw)))(**d), dict(**d) == d)),
    ('json', lambda d: (json.dumps(d)[:60], json.loads(json.dumps(d)) == d, json.dumps(d, sort_keys=True)[:60])),
    ('repr', lambda d: (repr(d)[:70], str(d)[-30:], sorted(d)[:3], min(d, default=None), max(d, default=None), len(d), bool(d), list(d) == list(d.keys()))),
    ('other keys', lambda d: (d.update({1: 'int', (1, 2): 'tuple', None: 'none', 2.5: 'float', b'k0': 'bytes', frozenset('ab'): 'frozenset'}), d[1], d[1.0], d[True], d[(1, 2)], d[None], d[2.5], d[b'k0'], d[frozenset('ba')], len(d), d.get('k0'))),
    ('subclass keys', lambda d: (d.get(S('k0')), S('k0') in d, d.setdefault(S('s1'), 1), d['s1'], d.get(S('s1')), type(list(d)[-1]).__name__, d.pop('s1'), 's1' in d, S('s1') in d)),
    ('like keys', lambda d: (d.get(Like('k0')), Like('k0') in d, Like('zz') in d, d.setdefault(Like('l1'), 1), d.get('l1'), d['l1'] if 'l1' in d else None, d.pop('l1', None), len(d))),
]
for label, factory in FACTORIES:
    for n in SIZES:
        for name, operation in OPERATIONS:
            plain, switched = fill(factory(), n), fill(factory(), n)
            switch(switched)
            try: a = operation(plain)
            except Exception as e: a = type(e).__name__, str(e)
            try: b = operation(switched)
            except Exception as e: b = type(e).__name__, str(e)
            if n in (0, 6, 100) or a != b or list(plain.items()) != list(switched.items()):
                print(label, n, name, a == b, list(plain.items()) == list(switched.items()), plain == switched, repr(b)[:300])

# ---- OrderedDict's own ----
for when in range(4):
    od = fill(collections.OrderedDict(), 12)
    if when == 0: switch(od)
    od.move_to_end('k3'); od.move_to_end('k7', last=False)
    if when == 1: switch(od)
    print(when, od.popitem(), od.popitem(last=False), list(od)[:3], list(reversed(od))[:3])
    if when == 2: switch(od)
    od['k3'] = 'again'; od.move_to_end('k0', last=False); del od['k5']
    print(when, list(od), od == fill(collections.OrderedDict(), 12), od == dict(od), list(od.items())[-1])
c = collections.Counter('the quick brown fox jumps over the lazy dog'.split())
switch(c); c.update(['the', 'cat']); c.subtract(['dog']); print(c.most_common(2), c['the'], c['nope'], sorted((+c).items()), sorted((c & collections.Counter(the=1, cat=5)).items()), c.total())
dd = collections.defaultdict(list)
for i, w in enumerate('a b c a b a'.split()):
    dd[w].append(i)
    if i == 2: switch(dd)
print(dict(dd), dd['zz'], len(dd))
cm = collections.ChainMap({'a': 1}, {'a': 2, 'b': 3}); print([switch(m) for m in cm.maps], cm['a'], cm['b'], 'c' in cm, sorted(cm))

# ---- In the middle of an iteration ----
for n in (1, 5, 6, 40):
    for at in sorted({0, 1, n // 2, n - 1}):
        d = fill({}, n)
        seen = []
        for i, (a, b, c, e) in enumerate(zip(d, d.items(), d.values(), reversed(d))):
            if i == at: switch(d)
            seen.append((a, b, c, e))
        print(n, at, len(seen), seen == [(k, (k, i), i, 'k%d' % (n - 1 - i)) for i, k in enumerate(names(n))])
d = fill({}, 20)
it = iter(d); next(it); switch(d); d['new'] = 1
try: next(it)
except RuntimeError as e: print('RuntimeError', e)
d = fill({}, 20)
it = iter(d); next(it); switch(d); d['k5'] = 'same size'; print(next(it), it.__length_hint__(), len(list(it)))
d = fill({}, 20)
it = iter(d.items()); first = next(it); state = it.__reduce__(); switch(d); print(first, state[1][0][:2], next(it))

# ---- Around every size at which the table grows, with and without entries that were removed ----
bad = []
for n in range(0, 90):
    for removed in (0, n // 2):
        d = fill({}, n)
        for k in names(removed): del d[k]
        switch(d)
        for k in names(60, 'x'): d[k] = k
        expected = [(k, i) for i, k in enumerate(names(n))][removed:] + [(k, k) for k in names(60, 'x')]
        if list(d.items()) != expected or any(d[k] != v for k, v in expected) or any(k in d for k in names(removed)) or 'zz' in d: bad.append((n, removed))
        e = fill({}, n)
        for k in names(60, 'x'):
            e[k] = k
            if k == 'x%d' % (n % 60): switch(e)
        for k in names(removed): del e[k]
        if e != d or list(e) != list(d): bad.append((n, removed, 'e'))
print('sizes', bad)

# ---- A lookup, an insertion, a removal during which the dict is asked for a Probe ----
class Nosy:
    """Equal to whatever has the same number. Each comparison is noted, and asks the dict for a Probe."""
    log = []
    def __init__(self, number, target=None): self.number, self.target = number, target
    def __hash__(self): return 7
    def __eq__(self, other):
        Nosy.log.append((self.number, getattr(other, 'number', other)))
        if self.target is not None: switch(self.target)
        return isinstance(other, Nosy) and self.number == other.number
    def __repr__(self): return 'Nosy(%d)' % self.number
def tuples(target, n): return [(Nosy(i, target),) for i in range(n)]   # A tuple does not say that it is equal to a str; what is in it may do anything.
for action in ('get', 'set', 'setdefault', 'pop', 'contains', 'del'):
    d = fill({}, 10)
    for t in tuples(None, 4): d[t] = t[0].number
    Nosy.log.clear()
    key = (Nosy(3, d),)
    if action == 'get': r = d.get(key)
    elif action == 'set': d[key] = 'set'; r = d[(Nosy(3),)]
    elif action == 'setdefault': r = d.setdefault(key, 'x')
    elif action == 'pop': r = d.pop(key)
    elif action == 'contains': r = key in d
    else: del d[key]; r = None
    # (In which order keys with one hash are come by, and how often, depends on where the others are.)
    print(action, r, len(d), sorted(set(Nosy.log)), d['k3'], d.get('zz'), [d.get((Nosy(i),)) for i in range(5)])
d = fill({}, 10)
for t in tuples(d, 4): d[t] = t[0].number
Nosy.log.clear()
print(d.get((Nosy(9),)), sorted(set(Nosy.log)), d.setdefault((Nosy(9),), 'added'), len(d), d['k9'])
# The first comparison empties the dict, or fills it again.
class Wrecker:
    def __init__(self, target, refill): self.target, self.refill = target, refill
    def __hash__(self): return hash('k3')
    def __eq__(self, other):
        target, self.target = self.target, None
        if target is not None:
            target.clear()
            target.update(fill({}, self.refill))
        return False
for refill in (0, 3, 4, 50):
    d = fill({}, 10)
    print(refill, d.get(Wrecker(d, refill)), len(d), d.get('k3'), d.get('k2'))
    d = fill({}, 10)
    d[Wrecker(d, refill)] = 'w'; print(refill, len(d), d.get('k3'), [type(k).__name__ for k in d][-1:])
    d['after'] = 1; print(d['after'], 'k3' in d, 'nope' in d)
    d = fill({}, 10)
    print(d.setdefault(Wrecker(d, refill), 'w'), len(d), d.pop(Wrecker(d, refill), 'gone'), len(d), Wrecker(d, refill) in d, len(d))

# ---- Against a model: a few thousand operations on keys of all kinds ----
def texts():
    wide, astral = 'é€x', '\U0001f600€éx'
    pool = ['', 'a', 'b', 'ab', 'key', 'Key', 'x' * 70, 'x' * 71, 'é', 'é' * 70, '€', '€uro', '€' * 70, '\U0001f600', 'a\U0001f600', '\ud800', '0', '1', 'None']
    # The same texts made in other ways: not interned, cut out of wider ones, decoded.
    again = [''.join(list(t)) for t in pool] + [wide[2:], astral[3:], (astral + 'ab')[4:], wide[:1], wide[1:2], b'key'.decode(), 'KEY'.lower(), sys.intern('k' + 'ey'), str(0), repr(None)]
    return pool, again
pool, again = texts()
others = [0, 1, -1, 2**70, 1.5, None, True, (), ('a',), ('a', 1), b'', b'a', b'key', frozenset(), frozenset('ab'), 0.0, 1.0, (None, ('x',))]
rng = random.Random(20260101)
mismatches = 0
for round_number in range(40):
    d, model = {}, []          # The model: pairs in the order of insertion.
    def find(key):
        for i, (k, v) in enumerate(model):
            if k is key or k == key: return i
        return -1
    for step in range(250):
        kind = rng.random()
        key = rng.choice(pool + again) if kind < .6 else S(rng.choice(pool)) if kind < .7 else Like(rng.choice(pool)) if kind < .72 and round_number % 2 else rng.choice(others)
        what = rng.randrange(12)
        i = find(key)
        if what < 4:
            d[key] = step
            if i < 0: model.append((key, step))
            else: model[i] = (model[i][0], step)
        elif what < 6:
            if (d.get(key, 'no') != (model[i][1] if i >= 0 else 'no')) or ((key in d) != (i >= 0)): mismatches += 1
        elif what < 8:
            if d.pop(key, 'no') != (model.pop(i)[1] if i >= 0 else 'no'): mismatches += 1
        elif what == 8:
            if d.setdefault(key, step) != (model[i][1] if i >= 0 else step): mismatches += 1
            if i < 0: model.append((key, step))
        elif what == 9 and model:
            if d.popitem() != model.pop(): mismatches += 1
        elif what == 10 and rng.random() < .15:
            switch(d)
        elif what == 11 and rng.random() < .05:
            d.clear(); model.clear()
        if step % 25 == 0 and ([(type(k), k, v) for k, v in d.items()] != [(type(k), k, v) for k, v in model] or len(d) != len(model)): mismatches += 1
    if list(d.items()) != model or dict(model) != d or d.copy() != d or pickle.loads(pickle.dumps({k: v for k, v in d.items() if type(k) is not Like})) != {k: v for k, v in d.items() if type(k) is not Like}: mismatches += 1
print('model', mismatches)

# ---- The same text however it came about ----
d = {t: i for i, t in enumerate(pool)}
for stage in range(2):
    print(stage, [d.get(t) for t in again], [d.get(S(t)) for t in pool] == list(range(len(pool))), [t in d for t in ('A', 'x' * 69, '€' * 69, 'é' * 71, '\udc00')])
    switch(d)
interned, made = sys.intern('some_name'), ''.join(['some', '_', 'name'])
d = {interned: 1}; print(d[made], switch(d), d[made], d[interned], made is interned or made == interned)
d = {made: 1}; print(d[interned], switch(d), d[made], d[interned])

# ---- Namespaces ----
class C:
    a = 1
    def method(self): return self.a
o = C(); o.b = 2
print(switch(vars(C)), switch(C.__dict__), C.a, o.a, o.method(), o.b, 'a' in vars(C), vars(C)['a'], Like('a') in vars(C), vars(C).get(Like('a')))
C.c = 3; del C.a; C.a = 10; setattr(C, 'd', 4)
print(C.a, C.c, C.d, o.method(), [k for k in vars(C) if not k.startswith('__')], switch(vars(o)), vars(o), o.__dict__.get(Like('b')), o.b)
o.e = 5; del o.b; print(vars(o), getattr(o, 'e'), hasattr(o, 'b'))
namespace = {}
exec('x = 1\ndef f(): return x, y, len\ndef g(v):\n    global x\n    x = v\ny = 2', namespace)
f, g = namespace['f'], namespace['g']
for i in range(300): f(); g(i)
print(f()[:2], switch(namespace), f()[:2], g(-1), f()[:2], namespace['x'])
namespace['y'] = 'changed'; namespace['z'] = 0; del namespace['z']; print(f()[:2]); namespace['len'] = 'shadow'; print(f()); del namespace['len']; print(f()[2] is len)
del namespace['y']
try: f()
except NameError as e: print('NameError', e)
module = types.ModuleType('m'); module.a = 1
print(switch(vars(module)), module.a, setattr(module, 'b', 2), module.b, sorted(k for k in vars(module) if not k.startswith('__')), vars(module).get(Like('a')))
def warm(): return switch, Probe, names
for i in range(300): warm()
print(switch(globals()), warm() == (switch, Probe, names), 'warm' in globals(), globals().get(Like('warm')) is warm)
def keywords(**kw): r = switch(kw); kw['extra'] = 1; return r, kw, kw.get('a'), kw.get(Like('a'))
print(keywords(a=1, b=2), keywords(**{'a': 1}), keywords(**{S('a'): 1}), keywords(**fill({}, 3)), keywords())
d = fill({}, 3); switch(d); print(keywords(**d), (lambda k0, k1, k2: (k0, k1, k2))(**d), '{k0} {k2}'.format(**d), '%(k1)s' % d, '{k1}'.format_map(d))
print(type('T', (), fill({}, 3)).k2, switch(sys.modules), 'sys' in sys.modules, __import__('sys') is sys)
proxy = types.MappingProxyType(fill({}, 5)); print(switch(proxy), proxy['k1'], proxy.get(Like('k2')), dict(proxy) == fill({}, 5), proxy | {'z': 1} == {**fill({}, 5), 'z': 1})
# A mappingproxy is hashed and compared as what it wraps.
class Wrapped(dict):
    def __hash__(self): return hash('k1')
    def __eq__(self, other): return other == 'k1'
print(fill({}, 5).get(types.MappingProxyType(Wrapped())), types.MappingProxyType(Wrapped()) in fill({}, 5), types.MappingProxyType(Wrapped()) in {'k2': 1})

# ---- Sets go by hash() from the start ----
s = set(names(50))
print(switch(s), Like('k3') in s, S('k3') in s, 'k3' in s, Like('zz') in s, len(s | {Like('k1'), S('k2'), 'new'}), sorted(s & {Like('k1'), S('k2'), 'zz'}, key=str), s == set(fill({}, 50)), s == fill({}, 50).keys())
print(hash(frozenset(names(50))) == hash(frozenset(reversed(names(50)))) == hash(frozenset(fill({}, 50))), hash(frozenset([S('a'), 'b'])) == hash(frozenset(['a', S('b')])), hash(('a', 'b')) == hash((S('a'), ''.join(['b']))))
d = fill({}, 50); switch(d); print(set(d) == s, frozenset(d) == s, s.issubset(d), s.issuperset(d), s.isdisjoint(d), len(s.union(d)), len(s.difference(d)), s - d.keys(), d.keys() - s, s ^ d.keys())
s.difference_update(fill({}, 10)); s.symmetric_difference_update(d); s.intersection_update(d); print(sorted(s), len(s)); s.update(d); print(len(s))

# ---- Weak dictionaries ----
class Thing:
    def __init__(self, name): self.name = name
things = [Thing(n) for n in names(8)]
by_name = weakref.WeakValueDictionary((t.name, t) for t in things)
by_thing = weakref.WeakKeyDictionary((t, t.name) for t in things)
print(switch(by_name.data), switch(by_thing.data), by_name['k3'].name, by_thing[things[3]], 'k9' in by_name, by_name.get(Like('k2')).name, len(by_name), len(by_thing))
del things[2:6]; t = None; gc.collect()
print(sorted(by_name), sorted(by_thing.values()), 'k3' in by_name, by_name.get('k7').name)
by_name['again'] = things[0]; print(sorted(by_name.keys()), len(weakref.WeakSet(things)))

# ---- Threads ----
shared = fill({}, 200)
errors = []
barrier = threading.Barrier(5)
def work(number):
    try:
        barrier.wait()
        for i in range(400):
            shared['t%d_%d' % (number, i)] = i
            if shared['k%d' % (i % 200)] != i % 200 or shared.get('t%d_%d' % (number, i // 2)) != (i // 2 if i // 2 % 3 or not i else None): errors.append((number, i))
            if number == 0 and i == 100: switch(shared)
            if i % 3 == 0: del shared['t%d_%d' % (number, i)]
    except Exception as e: errors.append(repr(e))
threads = [threading.Thread(target=work, args=(n,)) for n in range(5)]
for t in threads: t.start()
for t in threads: t.join()
print(errors, len(shared), sorted(shared) == sorted(names(200) + ['t%d_%d' % (n, i) for n in range(5) for i in range(400) if i % 3]))
