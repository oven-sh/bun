# Whatever fills a dict from another container in one go (update, |=, |, __init__, copy, fromkeys, displays with **, Counter, OrderedDict,
# sets made of dicts and dicts made of sets), for targets in every state a dict can be in: new, emptied in several ways (which leaves
# dead entries and used slots behind), cleared, half full, asked for a key of the program's before or after; and for sources likewise.
# The sizes go across the sizes of the tables. After each: nothing is lost, nothing is there twice, the order is right.
# There are 18,799 cases, which take a build with assertions minutes. So only every nth is gone through, beginning with the kth: n and k are the arguments, 16 and 0 if there
# are none. slow/dict_bulk_paths_all.py goes through all. (dict_modes_early.py runs this again in processes where dicts change the way they place strs early, in the
# middle of such loops.)
import collections, copy, hashlib, sys, types

EVERY, FIRST = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (16, 0)
case = 0
def wanted():
    global case
    case += 1
    return case % EVERY == FIRST

class Probe:
    def __hash__(self): return 12345
    def __eq__(self, other): return False
class S(str): pass
class D(dict): pass
MISSING = object()

def asked(d):
    Probe() in d
    return d

# ---- Targets: (name, function of n giving a dict and the items it should have) ----
def names(prefix, n): return [prefix + str(i) for i in range(n)]
def filled(n, prefix='t'): return {k: i for i, k in enumerate(names(prefix, n))}
def t_new(n): return {}, []
def t_deleted(n):
    d = filled(n)
    for k in list(d): del d[k]
    return d, []
def t_deleted_backwards(n):
    d = filled(n)
    for k in reversed(list(d)): del d[k]
    return d, []
def t_popitem(n):
    d = filled(n)
    while d: d.popitem()
    return d, []
def t_popitem_then_deleted(n):
    d = filled(n)
    for _ in range(min(2, n)): d.popitem()
    for k in list(d): del d[k]
    return d, []
def t_popped(n):
    d = filled(n)
    for k in names('t', n)[::2] + names('t', n)[1::2]: d.pop(k)
    return d, []
def t_cleared(n):
    d = filled(n); d.clear()
    return d, []
def t_asked_then_emptied(n):
    d = asked(filled(n))
    for k in list(d): del d[k]
    return d, []
def t_emptied_then_asked(n):
    d = filled(n)
    for k in list(d): del d[k]
    return asked(d), []
def t_emptied_of_ints(n):
    d = {i: i for i in range(n)}
    for k in list(d): del d[k]
    return d, []
def t_emptied_of_all_kinds(n):
    d = filled(n); d[1] = 1; d[(1, 'a')] = 2; d[None] = 3
    for k in list(d): del d[k]
    return d, []
def t_refilled(n):
    d = filled(n)
    for k in list(d): del d[k]
    d.update(filled(n // 2, 'u'))
    for k in list(d): del d[k]
    return d, []
def t_half(n):
    d = filled(n)
    for k in names('t', n)[::2]: del d[k]
    return d, [(k, i) for i, k in enumerate(names('t', n)) if i % 2]
def t_shares_keys(n):
    d = {k: -1 for k in names('k', n)[::3]}
    return d, list(d.items())
def t_shares_keys_asked(n):
    d, items = t_shares_keys(n)
    return asked(d), items
def t_one_left(n):
    d = filled(n)
    for k in names('t', n)[:-1]: del d[k]
    return d, list(d.items())
TARGETS = [t_new, t_deleted, t_deleted_backwards, t_popitem, t_popitem_then_deleted, t_popped, t_cleared, t_asked_then_emptied, t_emptied_then_asked, t_emptied_of_ints,
           t_emptied_of_all_kinds, t_refilled, t_half, t_shares_keys, t_shares_keys_asked, t_one_left]

# ---- Sources ----
def s_plain(n): return filled(n, 'k')
def s_asked(n): return asked(filled(n, 'k'))
def s_with_holes(n):
    d = filled(n + n // 2 + 2, 'k')
    for k in names('k', n + n // 2 + 2)[n:]: del d[k]
    return d
def s_with_holes_in_front(n):
    d = filled(n // 2 + 2, 'x'); d.update(filled(n, 'k'))
    for k in names('x', n // 2 + 2): del d[k]
    return d
def s_all_kinds(n):
    d = filled(n, 'k'); d[7] = 'int'; d[(1, 'a')] = 'tuple'; d[None] = 'None'; d[b'k1'] = 'bytes'; d[2.5] = 'float'; d[frozenset([1, 2])] = 'frozenset'
    return d
def s_subclass_keys(n): return {(S(k) if i % 3 == 0 else k): i for i, k in enumerate(names('k', n))}
def s_ordered(n): return collections.OrderedDict(filled(n, 'k'))
def s_derived(n): return D(filled(n, 'k'))
def s_counter(n): return collections.Counter(filled(n, 'k'))
def s_proxy(n): return types.MappingProxyType(filled(n, 'k'))
SOURCES = [s_plain, s_asked, s_with_holes, s_with_holes_in_front, s_all_kinds, s_subclass_keys, s_ordered, s_derived, s_counter, s_proxy]

# ---- What is done ----
def o_update(d, s): d.update(s); return d
def o_ior(d, s): d |= s; return d
def o_init(d, s): d.__init__(s); return d
def o_or(d, s): return d | dict(s)
def o_display(d, s): return {**d, **s}
def o_update_pairs(d, s): d.update(list(s.items())); return d
def o_update_keywords(d, s):
    if all(type(k) is str for k in s): d.update(**s)
    else: d.update(s)
    return d
def o_loop(d, s):
    for k in s: d[k] = s[k]
    return d
def o_setdefault(d, s):
    for k in s:
        if k in d: d[k] = s[k]
        else: d.setdefault(k, s[k])
    return d
OPERATIONS = [o_update, o_ior, o_init, o_or, o_display, o_update_pairs, o_update_keywords, o_loop, o_setdefault]

def problems_of(d, expected):
    found = []
    if len(d) != len(expected): found.append(('len', len(d), len(expected)))
    if list(d.items()) != expected: found.append('items or their order')
    if list(reversed(d)) != [k for k, v in reversed(expected)]: found.append('reversed')
    for k, v in expected:
        if k not in d or d.get(k, MISSING) != v or d[k] != v or k not in d.keys() or (k, v) not in d.items():
            found.append(('lost', k)); break
    for k in ('nope', 'k', 't', '', 12345, ('k0',)):
        if k in d: found.append(('found', k))
    for k, v in expected: d[k] = v
    if len(d) != len(expected) or list(d.items()) != expected: found.append('stored twice')
    if type(d) is dict and d != dict(expected): found.append('not equal to what it should be')
    return found

def merged(items, source):
    result = dict(items)                 # (small, and made pair by pair)
    for k in source: result[k] = source[k]
    return list(result.items())

TARGET_SIZES = [5, 6, 11, 22, 43]
SOURCE_SIZES = [0, 1, 5, 6, 10, 11, 21, 22, 43, 86]
def go_through(operations, targets, sources):
    digest = hashlib.sha256()
    bad = []
    count = 0
    for target in targets:
        for source in sources:
            for n in TARGET_SIZES:
                for m in SOURCE_SIZES:
                    count += 1
                    if not wanted(): continue
                    operation = operations[count % len(operations)]
                    d, items = target(n)
                    s = source(m)
                    expected = merged(items, s)
                    d = operation(d, s)
                    found = problems_of(d, expected)
                    if found and len(bad) < 5: bad.append((operation.__name__, target.__name__, source.__name__, n, m, found))
                    digest.update(repr(list(d.items())).encode())
                    if problems_of(dict(s) if type(s) is types.MappingProxyType else s, list(s.items())) and len(bad) < 5: bad.append(('the source', source.__name__, m))
    return count, digest.hexdigest()[:16], bad
# Each way of filling for itself where a dict that is empty takes all that another dict has.
EMPTY = [t for t in TARGETS if not t(6)[1]]
for operations in ([o_update], [o_ior], [o_init]) if EVERY == 1 else ([o_update, o_ior, o_init],):
    print(operations[0].__name__, *go_through(operations, EMPTY, [s_plain, s_asked, s_with_holes, s_all_kinds, s_subclass_keys]))
# All ways by turns for everything.
print('all', *go_through(OPERATIONS, TARGETS, SOURCES))

# ---- Copies, and dicts made of other things ----
def c_copy(s): return s.copy()
def c_dict(s): return dict(s)
def c_copy_module(s): return copy.copy(s)
def c_deepcopy(s): return copy.deepcopy(s)
def c_comprehension(s): return {k: v for k, v in s.items()}
def c_ordered(s): return collections.OrderedDict(s)
def c_counter(s): return collections.Counter(s)
def c_derived(s): return D(s)
def c_zip(s): return dict(zip(s.keys(), s.values()))
def c_defaultdict(s): return collections.defaultdict(int, s)
def c_chainmap(s): return dict(collections.ChainMap({}, s))
for make in [c_copy, c_dict, c_copy_module, c_deepcopy, c_comprehension, c_ordered, c_counter, c_derived, c_zip, c_defaultdict, c_chainmap]:
    bad = []
    for source in SOURCES:
        if source is s_proxy and make in (c_copy_module, c_deepcopy): continue
        if source is s_all_kinds and make is c_counter: continue
        for m in SOURCE_SIZES + [170, 171, 342]:
            if not wanted(): continue
            s = source(m)
            found = problems_of(make(s), list(s.items()))
            if found and len(bad) < 5: bad.append((source.__name__, m, found))
            # And a copy of the copy, after the copy has lost and got keys.
            c = make(s)
            for k in list(c)[::2]: del c[k]
            c['new'] = 1
            found = problems_of(dict(c), list(c.items())) + problems_of(c.copy(), list(c.items()))
            if found and len(bad) < 5: bad.append((source.__name__, m, 'second copy', found))
    print(make.__name__, bad)

# ---- Sets and dicts, each made of the other ----
bad = []
for source in SOURCES:
    for m in SOURCE_SIZES + [170, 171]:
        if not wanted(): continue
        s = source(m)
        keys = list(s)
        for made in (set(s), frozenset(s), set(s.keys()), set().union(s), set(keys) | s.keys(), s.keys() | set(), s.keys() & set(keys), {*s}):
            if len(made) != len(keys) or any(k not in made for k in keys) or 'nope' in made: bad.append(('set of dict', source.__name__, m))
        t = set(names('k', m)[::2]); t.update(s)
        if len(t) != len(keys) or any(k not in t for k in keys): bad.append(('update', source.__name__, m))
        t = set(names('k', m)[::2]); t.symmetric_difference_update(s)
        if t != set(keys) - set(names('k', m)[::2]): bad.append(('symmetric_difference_update', source.__name__, m))
        t = set(keys) | {'more'}; t.difference_update(s)
        if t != {'more'}: bad.append(('difference_update', source.__name__, m))
        t = set(keys) | {'more'}; t.intersection_update(s)
        if t != set(keys): bad.append(('intersection_update', source.__name__, m))
        if (set(keys) - s.keys()) or (s.keys() - set(keys)) or (s.keys() ^ set(keys)) or not set(keys).issubset(s) or not set(keys).issuperset(s) or (keys and set(keys).isdisjoint(s)): bad.append(('operators', source.__name__, m))
        for of in (lambda: set(keys), lambda: frozenset(keys), s.keys, lambda: keys, lambda: iter(keys), lambda: s, lambda: tuple(keys)):
            for target in (t_new, t_deleted, t_popitem_then_deleted):
                d = dict.fromkeys(of(), 0)
                if sorted(map(repr, d)) != sorted(map(repr, keys)) or problems_of(d, list(d.items())): bad.append(('fromkeys', source.__name__, m, type(of()).__name__))
                e, _ = target(11)
                e.update(d)
                if problems_of(e, list(d.items())): bad.append(('update with fromkeys', source.__name__, m, type(of()).__name__, target.__name__))
        for cls in (D, collections.OrderedDict, collections.Counter, collections.defaultdict):
            d = cls.fromkeys(set(keys), 0) if cls is not collections.Counter else collections.Counter(set(keys))
            if len(d) != len(keys) or any(k not in d for k in keys): bad.append(('fromkeys of a class', source.__name__, m, cls.__name__))
print('sets and dicts', bad[:5])

# ---- Counter, which adds up in C ----
bad = []
for target in TARGETS:
    for n in (6, 11, 43):
        for m in (5, 10, 11, 22, 43, 86):
            if not wanted(): continue
            d, items = target(n)
            c = collections.Counter(); c.update(d)
            for k in list(c): del c[k]
            c.update(names('k', m)); c.update(names('k', m)[::2]); c.update(filled(m, 'k')); c.subtract(names('k', m)[::3])
            expected = [(k, 1 + (i % 2 == 0) + i - (i % 3 == 0)) for i, k in enumerate(names('k', m))]
            if list(c.items()) != expected or any(k not in c for k, v in expected): bad.append((target.__name__, n, m))
print('Counter', bad[:5])
