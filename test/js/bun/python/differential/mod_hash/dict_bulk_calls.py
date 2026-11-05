# What takes many keys at once, from a dict, a view or a set into another: which __hash__ and __eq__ of the keys (and values) are called for it, in what
# order, and the order of a resulting set. A container hands on the hashes it has kept, or does not; a search ends early, or does not.
# (The hashes are small numbers of the program's choosing, or that of one str, so nothing depends on the run.)
import collections
log = []
class K:
    def __init__(self, n, h=1): self.n, self.h = n, h
    def __hash__(self): log.append('h%s' % self.n); return self.h
    def __eq__(self, o): log.append('e%s:%s' % (self.n, getattr(o, 'n', o))); return isinstance(o, K) and str(self.n).strip('x') == str(o.n).strip('x')
    def __repr__(self): return 'K%s' % self.n
class Like(K):
    "Hashes like a str, and says that it is equal to it, or not."
    def __init__(self, text, equal): K.__init__(self, 'like_' + text, hash(text)); self.text, self.equal = text, equal
    def __eq__(self, o): log.append('e%s:%s' % (self.n, getattr(o, 'n', o))); return self.equal and o == self.text
    __hash__ = K.__hash__
class DD(dict): pass
def show(label, f, distinct=False):
    log.clear()
    try: r = f()
    except Exception as e: r = type(e).__name__
    l = ' '.join(sorted(set(log)) if distinct else log); log.clear()
    print(label, '|', l, '|', list(r) if isinstance(r, (set, frozenset)) else list(r.items()) if isinstance(r, dict) else r)
def updated(d, *a, **k): d.update(*a, **k); return d

a, b, c = K('a'), K('b'), K('c')
show('intersection stops', lambda: {a}.intersection([a, b, c]))
show('intersection stops 2', lambda: {a, b}.intersection([a, c, b, c]))
show('intersection_update', lambda: (lambda s: (s.intersection_update([a, b, c]), s)[1])({a}))
show('intersection dict', lambda: {a}.intersection({a: 1, b: 2}))
show('& sets', lambda: {a} & {a, b, c})
show('& sets 2', lambda: {a, b, c} & {a})
show('isdisjoint list', lambda: {a}.isdisjoint([b, a, c]))

# Names given as keywords, into a dict with a key that hashes like one of them. (How often a search comes by that key before it ends depends on the
# hash, which is another in each run: so only who was asked.)
_show = show
for equal in (False, True):
    show = lambda label, f: _show(label, f, True)
    show('dict(d, **kw) %s' % equal, lambda: dict({Like('a', equal): 1}, a=2, b=3))
    show('DD(d, **kw) %s' % equal, lambda: DD({Like('a', equal): 1}, a=2, b=3))
    show('update(**kw) %s' % equal, lambda: updated({Like('a', equal): 1}, a=2, b=3))
    show('update(d, **kw) %s' % equal, lambda: updated({}, {Like('a', equal): 1}, a=2, b=3))
    show('__init__(**kw) %s' % equal, lambda: (lambda d: (d.__init__(a=2), d)[1])({Like('a', equal): 1}))
    show('| %s' % equal, lambda: {Like('a', equal): 1} | {'a': 2})
    show('{**d, **e} %s' % equal, lambda: {**{Like('a', equal): 1}, **{'a': 2}})
    show('f(**d) into **kw', lambda: (lambda **kw: kw)(**{'a': 2}))
show = _show

# The mapping behind **: a key that is there already has to be noticed, so each is looked for before it is stored; not in a dict that is empty at the start.
# (A d that has lost an entry: otherwise its table is taken as it is, and nobody is asked.)
def lost_one():
    d = {'x': 0, a: 1, b: 2, c: 3}
    del d['x']
    return d
f = lambda *args, **kw: len(kw)
for label, call in (('f(**d)', lambda d: f(**d)), ('f(z=1, **d)', lambda d: f(z=1, **d)), ('f(**{}, **d)', lambda d: f(**{}, **d)), ('f(**{"z": 1}, **d)', lambda d: f(**{'z': 1}, **d)), ('dict(**d)', lambda d: dict(**d)),
                    ('len(**d)', lambda d: len(**d)), ('{**d}', lambda d: {**d}), ('{"z": 1, **d}', lambda d: {'z': 1, **d}), ('dict(d)', lambda d: dict(d))):
    d = lost_one()
    show(label, lambda: call(d))

# From a container that has kept the hashes, and from one that has not.
for name, make in (('dict', dict), ('DD', DD), ('OrderedDict', collections.OrderedDict), ('Counter', collections.Counter), ('defaultdict', lambda x: collections.defaultdict(int, x))):
    # (CPython's OrderedDict looks a key up a second time when it stores it, which keys of one hash would tell: they have two here.)
    p, q = (K('p', 1), K('q', 2)) if name == 'OrderedDict' else (a, b)
    for source_name, source in (('dict', {p: 1, q: 2}), ('DD', DD({p: 1, q: 2})), ('OrderedDict', collections.OrderedDict({p: 1, q: 2})), ('pairs', [(p, 1), (q, 2)]), ('items', {p: 1, q: 2}.items())):
        if name == 'Counter' and source_name in ('pairs', 'items'): continue
        show('%s(%s)' % (name, source_name), lambda: make(source))
        show('%s().update(%s)' % (name, source_name), lambda: updated(make({}), source))
for source_name, source in (('set', {a, b}), ('frozenset', frozenset([a, b])), ('dict', {a: 1, b: 2}), ('keys', {a: 1, b: 2}.keys()), ('list', [a, b]), ('OrderedDict', collections.OrderedDict({a: 1, b: 2}))):
    show('dict.fromkeys(%s)' % source_name, lambda: dict.fromkeys(source))
    show('set(%s)' % source_name, lambda: set(source))
    show('frozenset(%s)' % source_name, lambda: frozenset(source))
    show('set().union(%s)' % source_name, lambda: set().union(source))
    show('{c} - %s' % source_name, lambda: {c}.difference(source))
    show('{c} ^ %s' % source_name, lambda: {c}.symmetric_difference(source))
    show('{a, c} & %s' % source_name, lambda: {a, c}.intersection(source))
    show('{a}.issubset(%s)' % source_name, lambda: {a}.issubset(source))
    show('{a, b, c}.issuperset(%s)' % source_name, lambda: {a, b, c}.issuperset(source))

# The room that dict.fromkeys(set) makes at once shows with hashes that come by few slots of a small table. (-2: one slot of 8, thirteen times.)
for n in range(2, 9):
    ks = [K(i, -2) for i in range(n)]
    s = set(ks); log.clear()
    show('fromkeys(set of %d)' % n, lambda: len(dict.fromkeys(s)))
    show('fromkeys(list of %d)' % n, lambda: len(dict.fromkeys(ks)))

# hash() of a frozendict goes by the hashes that the table has kept, asks each value once, and is remembered.
fd = frozendict({a: K('va', 5), b: K('vb', 6)})
show('hash(frozendict)', lambda: type(hash(fd)).__name__)
show('hash(frozendict) again', lambda: hash(fd) == hash(fd))
show('as a key', lambda: {fd: 1}[fd])
show('of an equal one', lambda: hash(frozendict({a: K('va', 5), b: K('vb', 6)})) == hash(fd))
show('of strs', lambda: hash(frozendict(x=1, y='z')) == hash(frozendict(y='z', x=1)) == hash(frozendict({'x': 1, 'y': 'z'})))
show('with a value that has no hash', lambda: hash(frozendict(x=[])))

# d.items() ^ e.items() looks for a key of both a second time, to take it out; an __eq__ that has changed its mind sends that search elsewhere.
class Fickle:
    asked = 0
    def __hash__(self): return 1
    def __eq__(self, other):
        Fickle.asked += 1
        return Fickle.asked == 1
show('items ^ items, fickle', lambda: {Fickle(): 1}.items() ^ {Fickle(): 1}.items())

# Views.
V = lambda n: K('v%s' % n, 5)
for name, d1, d2 in [('same key equal value', {a: 1}, {K('ax'): 1}), ('same key other value', {a: 1}, {K('ax'): 2}), ('other keys', {a: 1}, {b: 1}), ('two and two', {a: 1, b: 2}, {K('bx'): 2, c: 3}),
                     ('values that log', {a: V(1)}, {K('ax'): V('1x')}), ('values that log, unequal', {a: V(1)}, {K('ax'): V(2)}), ('empty left', {}, {a: 1}), ('empty right', {a: 1}, {}),
                     ('three', {a: 1, b: 2, c: 3}, {K('cx'): 3, K('bx'): 0, K('d'): 4})]:
    for view in ('keys', 'items'):
        v1, v2 = getattr(d1, view)(), getattr(d2, view)()
        for other_name, other in (('view', v2), ('set', set(v2)), ('frozenset', frozenset(v2)), ('list', list(v2))):
            log.clear()
            for op_name, op in (('^', lambda x, y: x ^ y), ('|', lambda x, y: x | y), ('&', lambda x, y: x & y), ('-', lambda x, y: x - y), ('r-', lambda x, y: y - x), ('isdisjoint', lambda x, y: x.isdisjoint(y)),
                                ('<=', lambda x, y: x <= y), ('<', lambda x, y: x < y), ('==', lambda x, y: x == y), ('>=', lambda x, y: x >= y)):
                show('%s %s %s, %s' % (view, op_name, other_name, name), lambda: op(v1, other))
