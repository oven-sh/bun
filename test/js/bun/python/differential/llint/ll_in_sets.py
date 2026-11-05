# `k in s` and `k not in s` for sets: the interpreter asks a set or a frozenset itself, and goes by __contains__ for an instance of any class derived from them.
asked = []
def show(label, f):
    del asked[:]
    try:
        r = repr(f())
    except BaseException as e:
        r = type(e).__name__ + ': ' + str(e)
    print('%s | %s | %s' % (label, ' '.join(asked), r))

class K:
    "An element that says when it is asked."
    def __init__(self, n, h): self.n, self.h = n, h
    def __hash__(self): asked.append('h%s' % self.n); return self.h
    def __eq__(self, other):
        asked.append('e%s:%s' % (self.n, getattr(other, 'n', type(other).__name__)))
        return self.n == other.n if isinstance(other, K) else NotImplemented
    def __repr__(self): return 'K%s' % self.n
class Raises:
    def __init__(self, where): self.where = where
    def __hash__(self):
        if self.where == 'hash': raise ZeroDivisionError('in __hash__')
        return 7
    def __eq__(self, other):
        raise ZeroDivisionError('in __eq__')
class NoHash:
    __hash__ = None
class S(str): pass
class SH(str):
    def __hash__(self): asked.append('hSH'); return hash(str(self))
    def __eq__(self, other): asked.append('eSH'); return str(self) == other

class Plain(set): pass
class PlainFrozen(frozenset): pass
class Own(set):
    def __contains__(self, key): asked.append('Own.__contains__'); return 'yes'
class OwnFrozen(frozenset):
    def __contains__(self, key): asked.append('OwnFrozen.__contains__'); return 0
class Calls(set):
    def __contains__(self, key): asked.append('Calls.__contains__'); return set.__contains__(self, key)
class Nothing(set):
    __contains__ = None
class Later(set): pass
class Iterates(set):
    def __iter__(self): asked.append('__iter__'); return iter(())
class Meta(type):
    def __contains__(cls, key): asked.append('Meta.__contains__'); return True
class OfMeta(set, metaclass=Meta): pass

a, b, c = K('a', 7), K('b', 7), K('c', 15)
def isin(k, s): return k in s
def notin(k, s): return k not in s
def both(k, s): return (k in s, k not in s, not k in s, True if k in s else False)

kinds = [('set', set), ('frozenset', frozenset), ('Plain', Plain), ('PlainFrozen', PlainFrozen), ('Own', Own), ('OwnFrozen', OwnFrozen), ('Calls', Calls), ('Nothing', Nothing),
         ('Iterates', Iterates), ('OfMeta', OfMeta)]
for name, kind in kinds:
    for label, items, keys in [
            ('strs', ['alpha', 'beta', ''], ['alpha', 'gamma', '', 'al' + 'pha', S('beta'), SH('beta'), SH('delta'), b'alpha', 'x' * 2000]),
            ('numbers', [1, 2.5, 0, 2 ** 70, -1, True], [1, 1.0, True, 2.5, 0, 0.0, -0.0, False, 2 ** 70, 2.0 ** 70, -1, -2, 3, float('nan'), float('inf'), 1 + 0j, None]),
            ('tuples', [(1, 2), (), ('a', (b'b', None))], [(1, 2), (1.0, 2), (), (2, 1), ('a', (b'b', None)), ('a', [1]), [1, 2]]),
            ('objects', [a, b], [a, b, c, K('a', 7), K('a', 15), K('d', 7)]),
            ('sets', [frozenset({1, 2}), frozenset()], [frozenset({1, 2}), {1, 2}, set(), {3}, Plain({1, 2}), PlainFrozen({2, 1}), {1: 2}, {(1,): [2]}.keys()]),
            ('nothing', [], ['alpha', 1, (), a, None, [], {}, set()]),
            ]:
        s = kind(items)
        for k in keys:
            show('%s of %s: %r' % (name, label, k), lambda: both(k, s))

for name, kind in kinds[:4]:
    s = kind([K('x', 7), 'alpha', 1])
    show('%s: __hash__ raises' % name, lambda: isin(Raises('hash'), s))
    show('%s: __eq__ raises' % name, lambda: isin(Raises('eq'), s))
    show('%s: no __hash__' % name, lambda: isin(NoHash(), s))
    show('%s: a list' % name, lambda: notin([], s))
    show('%s: a dict' % name, lambda: notin({}, s))
    show('%s: a bytearray' % name, lambda: isin(bytearray(b'a'), s))
    show('%s: a set of lists cannot be' % name, lambda: isin({1, 2, 3}, s))
    show('%s: itself' % name, lambda: isin(s, s))

# The very object under another hash than the set has kept: a frozenset finds it, a set does not.
for name, kind in kinds[:4]:
    k = K('m', 3)
    s = kind([k, K('n', 4)])
    k.h = 11 # The same slot of a table of 8.
    show('%s: the hash has changed' % name, lambda: both(k, s))
    k.h = 4 # Another's slot.
    show('%s: the hash has changed to that of another' % name, lambda: both(k, s))

# One place in the code, many kinds of container one after the other, and back.
containers = [{'alpha'}, frozenset({'alpha'}), Plain({'alpha'}), Own(), {'alpha': 1}, ['alpha'], ('alpha',), 'alphabet', Calls({'alpha'}), OwnFrozen(), range(3), iter(['alpha']), {'alpha': 1}.keys(),
              {'alpha': 1}.items(), b'alpha', Nothing(), 5, None, OfMeta, OfMeta({'alpha'})]
for round in range(3):
    for container in containers:
        show('round %d, %s' % (round, type(container).__name__), lambda: isin('alpha', container))

# A class that gets its __contains__ when the place in the code has seen it often.
later = Later({'alpha'})
def often():
    n = 0
    for i in range(300):
        if i == 150: Later.__contains__ = lambda self, key: False
        if i == 250: del Later.__contains__
        n += 'alpha' in later
    return n
show('a __contains__ that comes and goes', often)

# A set that changes while it is asked.
class Clears:
    def __init__(self, s): self.s = s
    def __hash__(self): return 7
    def __eq__(self, other): asked.append('clears'); self.s.clear(); return False
s = {K('x', 7), K('y', 7)}
show('an __eq__ that clears the set', lambda: (isin(Clears(s), s), len(s)))
class Grows(Clears):
    def __eq__(self, other): asked.append('grows'); self.s.update(range(100)); return False
s = {K('x', 7)}
show('an __eq__ that makes the set grow', lambda: (isin(Grows(s), s), len(s)))

# Elsewhere than in an expression of its own.
s = {'alpha', 1, (1, 2)}
show('comprehension', lambda: [k for k in ('alpha', 'beta', 1, 2, (1, 2), (2, 1)) if k in s])
show('while', lambda: next(i for i in range(5) if i not in s))
show('chained', lambda: ('alpha' in s in [True], 1 in s == True, 'alpha' in s is True))
show('operator.contains', lambda: __import__('operator').contains(s, 'alpha'))
show('any', lambda: any(k in s for k in ('x', 'y', 'alpha')))
show('a display', lambda: ('alpha' in {'alpha', 'beta'}, 'gamma' in {'alpha', 'beta'}, 3 in {1, 2, 3}, a in {a, b}))
def match(x):
    match x:
        case k if k in s: return 'in'
        case _: return 'out'
show('a guard', lambda: (match('alpha'), match('beta')))
