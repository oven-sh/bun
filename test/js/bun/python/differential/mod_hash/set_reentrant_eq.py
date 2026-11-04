# An __eq__ that changes the set in the middle of the operation that asked it: who is asked after that, what the operation answers, what the set
# holds, and that it is sound: as many elements as it says, each of them found, and pop() gets them all. (All hashes are small numbers of
# the program's choosing, so nothing depends on the run.)
import hashlib
log = []
class R:
    def __init__(self, h, t): self.h, self.t, self.act = h, t, None
    def __hash__(self): return self.h
    def __repr__(self): return self.t
    def __eq__(self, o):
        if o is self: return True
        log.append('%s==%s' % (self.t, o.t))
        a, self.act = self.act, None
        if a: a()
        return self.answer if hasattr(self, 'answer') else False
def case(name, with_dummy, actor, action, operation, answer=None):
    global s
    log.clear()
    Z, A, B, C = R(1, 'Z'), R(1, 'A'), R(1, 'B'), R(1, 'C')
    U = R(4, 'U')
    s = set()
    for k in (Z, A, B, C, U): s.add(k)
    if with_dummy: s.discard(Z)
    log.clear()
    keys = dict(Z=Z, A=A, B=B, C=C, U=U)
    keys[actor].act = lambda: action(keys)
    if answer is not None: keys[actor].answer = answer
    X = R(1, 'X')
    try: r = operation(X)
    except Exception as e: r = type(e).__name__
    calls = ' '.join(log); log.clear()
    for k in keys.values(): k.act = None
    listed = list(s)
    sound = len(listed) == len(s) and all(k in s for k in listed) and len(s.copy()) == len(listed) and len(frozenset(s)) == len(listed)
    log.clear()
    popped = 0
    while popped <= len(listed) and s: s.pop(); popped += 1
    rows.append('%s dummy %d actor %s %s -> %s %s len %d %s sound %s popped %s' % (name, with_dummy, actor, operation.__name__, r, calls, len(listed), listed, sound, popped == len(listed)))
    return sound and popped == len(listed)
def add(x): return s.add(x)
def contains(x): return x in s
def discard(x): return s.discard(x)
def remove(x): return s.remove(x)
def update(x): return s.update([x])
ACTIONS = [
    ('nothing', lambda k: None), ('add another hash', lambda k: s.add(R(3, 'n3'))), ('discard another hash', lambda k: s.discard(k['U'])), ('add same hash', lambda k: s.add(R(1, 'N'))),
    ('discard A', lambda k: s.discard(k['A'])), ('discard C', lambda k: s.discard(k['C'])), ('discard B', lambda k: s.discard(k['B'])), ('discard and add U', lambda k: (s.discard(k['U']), s.add(k['U']))),
    ('discard and add A', lambda k: (s.discard(k['A']), s.add(k['A']))), ('discard and add B', lambda k: (s.discard(k['B']), s.add(k['B']))), ('discard and add C', lambda k: (s.discard(k['C']), s.add(k['C']))),
    ('clear', lambda k: s.clear()), ('clear and refill', lambda k: (s.clear(), s.update([k['A'], k['B'], k['C']]))), ('grow', lambda k: s.update(range(100, 130))), ('pop', lambda k: s.pop()),
]
def union(x): return len(s | {x})
def ior(x): s.__ior__({x})
def difference(x): return len(s - {x})
def isub(x): s.__isub__({x})
def intersection(x): return len(s & {x})
def symmetric(x): s.symmetric_difference_update([x])
def equal(x): return s == {x}
def issuperset(x): return s.issuperset([x])
def isdisjoint(x): return s.isdisjoint([x])
for operation in (add, contains, discard, remove, update, union, ior, difference, isub, intersection, symmetric, equal, issuperset, isdisjoint):
    for with_dummy in (0, 1):
        rows = []
        unsound = 0
        for actor in ('A', 'B', 'C'):
            for name, action in ACTIONS:
                for answer in (None, True):
                    unsound += not case(name + (' then equal' if answer else ''), with_dummy, actor, action, operation, answer)
        print(operation.__name__, with_dummy, len(rows), 'cases', hashlib.sha256('\n'.join(rows).encode()).hexdigest()[:16], unsound, 'unsound')
        if len(__import__('sys').argv) > 1: print('\n'.join(rows))
