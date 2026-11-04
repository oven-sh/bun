# An __eq__ that changes the dict in the middle of the search that asked it: takes the very key out and puts it back (so that it is the same
# entry again, but found by another way), deletes others, fills, empties, refills, asks for keys of other kinds. Whatever the operation was
# then does, the dict has to be sound afterwards. (All hashes are small numbers of the program's choosing, so nothing depends on the run.)
import collections, hashlib, sys

action = None
trigger = None
class K:
    def __init__(self, n, h=7): self.n = n; self.h = h
    def __hash__(self): return self.h
    def __eq__(self, o):
        global action
        if action and self.n == trigger:
            a, action = action, None
            a()
        return isinstance(o, K) and self.n == o.n
    def __repr__(self): return 'K(%d)' % self.n
class Probe:
    def __hash__(self): return 99
    def __eq__(self, other): return False

def make(kind, holes):
    d = kind()
    keys = [K(i) for i in range(1, 6)]
    for k in keys: d[k] = k.n * 10
    d['s'] = 'str'
    for n in holes: del d[keys[n - 1]]
    return d, keys

def put_back_last(d, keys):
    k, v = d.popitem(); d[k] = v
def put_back_two(d, keys):
    a = d.popitem(); b = d.popitem(); d[b[0]] = b[1]; d[a[0]] = a[1]
def put_back_two_swapped(d, keys):
    a = d.popitem(); b = d.popitem(); d[a[0]] = a[1]; d[b[0]] = b[1]
def take_out_and_put_back(d, keys):
    for k in list(d):
        if isinstance(k, K) and k.n == trigger: v = d.pop(k); d[k] = v
def delete_first(d, keys):
    del d[next(iter(d))]
def delete_it(d, keys):
    for k in list(d):
        if isinstance(k, K) and k.n == trigger: del d[k]
def add_one(d, keys): d[K(50)] = 500
def add_many(d, keys):
    for i in range(100, 140): d[K(i)] = i
def add_strs(d, keys):
    for i in range(40): d['x%d' % i] = i
def empty_and_refill(d, keys):
    items = list(d.items()); d.clear()
    for k, v in items: d[k] = v
def empty(d, keys): d.clear()
def ask_other_kind(d, keys): Probe() in d
def put_back_and_ask(d, keys): put_back_last(d, keys); Probe() in d
def ask_and_put_back(d, keys): Probe() in d; put_back_last(d, keys)
def pop_all_and_put_back(d, keys):
    items = []
    while d: items.append(d.popitem())
    for k, v in reversed(items): d[k] = v
ACTIONS = [put_back_last, put_back_two, put_back_two_swapped, take_out_and_put_back, delete_first, delete_it, add_one, add_many, add_strs, empty_and_refill, empty, ask_other_kind,
           put_back_and_ask, ask_and_put_back, pop_all_and_put_back]

def attempt(f):
    try: return f()
    except Exception as e: return type(e).__name__
OPERATIONS = [('pop', lambda d, k: d.pop(k)), ('pop default', lambda d, k: d.pop(k, 'absent')), ('del', lambda d, k: d.__delitem__(k)), ('store', lambda d, k: d.__setitem__(k, 'new')),
              ('setdefault', lambda d, k: d.setdefault(k, 'new')), ('get', lambda d, k: d.get(k)), ('subscript', lambda d, k: d[k]), ('in', lambda d, k: k in d), ('update', lambda d, k: d.update({k: 'new'})),
              ('in keys', lambda d, k: k in d.keys()), ('in items', lambda d, k: (k, k.n * 10) in d.items()), ('move_to_end', lambda d, k: d.move_to_end(k) if hasattr(d, 'move_to_end') else None),
              ('move_to_end first', lambda d, k: d.move_to_end(k, last=False) if hasattr(d, 'move_to_end') else None)]

def state(d):
    # Everything that is listed is found, and nothing else; then it still takes and gives up keys.
    listed = list(d.items())
    sound = len(listed) == len(d) and all(k in d and d[k] == v for k, v in listed) and len(set(map(id, d))) == len(d)
    absent = [n for n in range(0, 8) if K(n) in d]
    d[K(60)] = 600; d['t'] = 1
    sound = sound and d[K(60)] == 600 and d.pop(K(60)) == 600 and K(60) not in d and d.pop('t') == 1 and list(d.items()) == listed
    for k, v in listed:
        if d.pop(k) != v: sound = False
    return listed, absent, sound and not d

READING = {'get', 'subscript', 'in', 'in keys', 'in items'}
TAKING = {'pop', 'pop default', 'del'}
STORING = {'store', 'setdefault', 'update'}
MOVING = {'move_to_end', 'move_to_end first'}
EVERYTHING = READING | TAKING | STORING | MOVING
# Left out, unless the script is given the argument "all":
#  - what CPython 3.15.2 does not come through: it crashes when the __eq__ empties the dict or OrderedDict, or makes it grow, under pop(), del or
#    move_to_end();
#  - what it answers differently because its search goes on where the key no longer is (several keys taken out and put back: KeyError for a key
#    that is there), and del after one key was put back, which ends in an error of its own there;
#  - what leaves a key in the dict twice, there and here: a key moved to a place that the search has been past, and then stored because it was
#    not found.
COMPARED = {
    take_out_and_put_back: EVERYTHING, delete_first: EVERYTHING, delete_it: EVERYTHING, add_one: EVERYTHING, empty_and_refill: EVERYTHING, ask_other_kind: EVERYTHING,
    put_back_last: READING | MOVING | {'pop', 'pop default'}, put_back_two_swapped: READING | MOVING | {'pop', 'pop default'},
    put_back_and_ask: READING | MOVING | {'pop', 'pop default'}, ask_and_put_back: READING | MOVING | {'pop', 'pop default'},
    add_many: READING | STORING, add_strs: READING | STORING, empty: READING | STORING, put_back_two: MOVING, pop_all_and_put_back: MOVING,
}
everything = sys.argv[1:] == ['all']

for kind in (dict, collections.OrderedDict):
    for act in ACTIONS:
        digest = hashlib.sha256()
        count = unsound = 0
        for holes in ((), (1,), (1, 2), (2,), (4,), (1, 4)):
            for name, operation in OPERATIONS:
                if not everything and name not in COMPARED[act]: continue
                for wanted in (3, 5, 9):
                    for asked in (3, 5):
                        if asked in holes: continue
                        d, keys = make(kind, holes)
                        if act in (put_back_last, put_back_two, put_back_two_swapped, put_back_and_ask, ask_and_put_back): del d['s']        # so that a K is the last
                        trigger = asked
                        action = lambda: act(d, keys)
                        result = attempt(lambda: operation(d, K(wanted)))
                        action = None
                        listed, found, sound = state(d)
                        count += 1
                        unsound += not sound
                        digest.update(repr((holes, name, wanted, asked, result, listed, found, sound)).encode())
        print(kind.__name__, act.__name__, count, 'cases', 'not compared' if everything else digest.hexdigest()[:16], 'not counted' if everything else unsound)
