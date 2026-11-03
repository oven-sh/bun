# __eq__, __hash__, __lt__ and key functions that change the container that is being searched, compared, sorted or updated.
import collections, heapq, bisect, itertools, functools, operator, array

def show(f):
    try:
        r = f()
        s = repr(r)
        return s if len(s) < 120 else s[:117] + "..."
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:100]

class Evil:
    "Equal to nothing or everything; the first comparisons run the action."
    armed = 0
    def __init__(self, n, answer=False, h=0): self.n, self.answer, self.h = n, answer, h
    def __repr__(self): return "E%d" % self.n
    def __hash__(self):
        Evil.fire()
        return self.h
    def __eq__(self, other):
        Evil.fire()
        return self.answer
    def __lt__(self, other):
        Evil.fire()
        return self.n < getattr(other, "n", 0)
    @classmethod
    def fire(cls):
        if cls.armed > 0:
            cls.armed -= 1
            if cls.armed == 0:
                cls.action()

import sys
GROUP = sys.argv[1] if len(sys.argv) > 1 else None
def run(name, make, op, actions, delays=(1, 2, 3, 5, 9)):
    if GROUP == "--list":
        print(name)
        return
    if GROUP is not None and GROUP != name:
        return
    for action_name, action in actions.items():
        for answer in (False, True):
            for delay in delays:
                Evil.armed = 0
                x = make(answer)
                Evil.action = staticmethod(lambda: action(x))
                Evil.armed = delay
                r = show(lambda: op(x, Evil(100, answer)))
                Evil.armed = 0
                print(name, action_name, answer, delay, "->", r, "|", show(lambda: len(x)))

def evils(answer, n=12): return [Evil(i, answer) for i in range(n)]

seq_actions = {
    "clear": lambda x: x.clear(),
    "pop": lambda x: x.pop(),
    "grow": lambda x: x.extend(Evil(200 + i) for i in range(300)),
    "shrink": lambda x: [x.pop() for _ in range(len(x) - 1)],
}
for kind in (list, collections.deque):
    make = lambda answer, kind=kind: kind(evils(answer))
    name = kind.__name__
    run(name + " in", make, lambda x, e: e in x, seq_actions)
    run(name + ".index", make, lambda x, e: x.index(e), seq_actions)
    run(name + ".count", make, lambda x, e: x.count(e), seq_actions)
    run(name + ".remove", make, lambda x, e: x.remove(e), seq_actions)
    run(name + " ==", make, lambda x, e: x == kind(evils(e.answer)), seq_actions)
    run(name + " <", make, lambda x, e: x < kind(evils(e.answer)), seq_actions)
    run(name + " == rev", make, lambda x, e: kind(evils(e.answer)) == x, seq_actions)
    run("tuple(%s) cmp" % name, make, lambda x, e: (x, 1) == (kind(evils(e.answer)), 1), seq_actions)
    run("min " + name, make, lambda x, e: min(x), seq_actions)
    run("max " + name, make, lambda x, e: max(x, key=lambda v: v), seq_actions)
    run("sorted " + name, make, lambda x, e: sorted(x), seq_actions)
    run("groupby " + name, make, lambda x, e: [(k, len(list(g))) for k, g in itertools.groupby(x)], seq_actions)
    run("set(%s)" % name, make, lambda x, e: len(set(x)), seq_actions)
    run("dict.fromkeys(%s)" % name, make, lambda x, e: len(dict.fromkeys(x)), seq_actions)
    run("Counter(%s)" % name, make, lambda x, e: len(collections.Counter(x)), seq_actions)
make_list = lambda answer: evils(answer)
run("list.sort", make_list, lambda x, e: x.sort(), seq_actions)
run("list.sort key", make_list, lambda x, e: x.sort(key=lambda v: (Evil.fire(), v.n)[1]), seq_actions)
run("list.sort reverse", make_list, lambda x, e: x.sort(reverse=True), seq_actions)
run("heapify", make_list, lambda x, e: heapq.heapify(x), seq_actions)
run("heappush", make_list, lambda x, e: heapq.heappush(x, e), seq_actions)
run("heappop", make_list, lambda x, e: heapq.heappop(x), seq_actions)
run("heapreplace", make_list, lambda x, e: heapq.heapreplace(x, e), seq_actions)
run("heappushpop", make_list, lambda x, e: heapq.heappushpop(x, e), seq_actions)
run("heapify_max", make_list, lambda x, e: heapq.heapify_max(x), seq_actions)
run("heappop_max", make_list, lambda x, e: heapq.heappop_max(x), seq_actions)
run("heappush_max", make_list, lambda x, e: heapq.heappush_max(x, e), seq_actions)
run("nlargest", make_list, lambda x, e: heapq.nlargest(3, x), seq_actions)
run("merge", make_list, lambda x, e: list(heapq.merge(x, evils(False)))[:3], seq_actions)
run("bisect_left", make_list, lambda x, e: bisect.bisect_left(x, e), seq_actions)
run("bisect_right", make_list, lambda x, e: bisect.bisect_right(x, e), seq_actions)
run("insort", make_list, lambda x, e: bisect.insort(x, e), seq_actions)
run("insort key", make_list, lambda x, e: bisect.insort(x, e, key=lambda v: (Evil.fire(), v.n)[1]), seq_actions)
run("operator.indexOf", make_list, lambda x, e: operator.indexOf(x, e), seq_actions)
run("operator.countOf", make_list, lambda x, e: operator.countOf(x, e), seq_actions)
run("list.extend(self iter)", make_list, lambda x, e: x.extend(v for v in x if (Evil.fire(), len(x) < 100)[1]), seq_actions)

set_actions = {
    "clear": lambda x: x.clear(),
    "pop": lambda x: x.pop(),
    "grow": lambda x: x.update(range(1000)),
    "add evil": lambda x: x.add(Evil(300)),
    "discard": lambda x: x.discard(1),
}
make_set = lambda answer: set(evils(answer)) | {1, 2, 3}
other_set = lambda e: set(evils(e.answer, 6)) | {2, 3, 4}
for name, op in [
    ("in", lambda x, e: e in x), ("add", lambda x, e: x.add(e)), ("remove", lambda x, e: x.remove(e)), ("discard", lambda x, e: x.discard(e)),
    ("|", lambda x, e: len(x | other_set(e))), ("&", lambda x, e: len(x & other_set(e))), ("-", lambda x, e: len(x - other_set(e))), ("^", lambda x, e: len(x ^ other_set(e))),
    ("|=", lambda x, e: x.__ior__(other_set(e)) is x), ("&=", lambda x, e: x.__iand__(other_set(e)) is x), ("-=", lambda x, e: x.__isub__(other_set(e)) is x), ("^=", lambda x, e: x.__ixor__(other_set(e)) is x),
    ("r|", lambda x, e: len(other_set(e) | x)), ("r&", lambda x, e: len(other_set(e) & x)), ("r-", lambda x, e: len(other_set(e) - x)), ("r^", lambda x, e: len(other_set(e) ^ x)),
    ("==", lambda x, e: x == other_set(e)), ("<=", lambda x, e: x <= other_set(e)), (">=", lambda x, e: x >= other_set(e)), ("<", lambda x, e: x < other_set(e)),
    ("isdisjoint", lambda x, e: x.isdisjoint(other_set(e))), ("issubset list", lambda x, e: x.issubset(evils(e.answer))), ("issuperset list", lambda x, e: x.issuperset(evils(e.answer))),
    ("update list", lambda x, e: x.update(evils(e.answer))), ("intersection_update list", lambda x, e: x.intersection_update(evils(e.answer))),
    ("difference_update list", lambda x, e: x.difference_update(evils(e.answer))), ("symmetric_difference_update list", lambda x, e: x.symmetric_difference_update(evils(e.answer))),
    ("update dict", lambda x, e: x.update(dict.fromkeys(evils(e.answer)))), ("difference dict", lambda x, e: len(x.difference(dict.fromkeys(evils(e.answer))))),
    ("copy", lambda x, e: len(x.copy())), ("frozenset", lambda x, e: len(frozenset(x))), ("set in set", lambda x, e: x in {frozenset(x)}),
    ("union many", lambda x, e: len(x.union(evils(e.answer), other_set(e), x))), ("repr", lambda x, e: len(repr(x)) > 0), ("list", lambda x, e: len(list(x))),
]:
    run("set " + name, make_set, op, set_actions)

dict_actions = {
    "clear": lambda x: x.clear(),
    "popitem": lambda x: x.popitem(),
    "grow": lambda x: x.update((i, i) for i in range(1000)),
    "add evil": lambda x: x.__setitem__(Evil(300), 1),
    "del": lambda x: x.pop(1, None),
}
for kind in (dict, collections.OrderedDict, collections.defaultdict, collections.Counter):
    def make_dict(answer, kind=kind):
        d = kind()
        for v in evils(answer): d[v] = v.n
        d[1] = 1; d[2] = 2
        return d
    def other_dict(e, kind=kind):
        d = {}
        for v in evils(e.answer, 6): d[v] = v.n
        d[2] = 2; d[3] = 3
        return d
    for name, op in [
        ("[]", lambda x, e: x[e]), ("[]=", lambda x, e: x.__setitem__(e, 1)), ("del", lambda x, e: x.__delitem__(e)), ("in", lambda x, e: e in x), ("get", lambda x, e: x.get(e)),
        ("pop", lambda x, e: x.pop(e, "default")), ("setdefault", lambda x, e: x.setdefault(e, 5)), ("update", lambda x, e: x.update(other_dict(e))), ("update pairs", lambda x, e: x.update([(v, 1) for v in evils(e.answer)])),
        ("==", lambda x, e: x == other_dict(e)), ("== same", lambda x, e: x == dict(x)), ("|", lambda x, e: len(x | other_dict(e))), ("|=", lambda x, e: x.__ior__(other_dict(e)) is x), ("r|", lambda x, e: len(other_dict(e) | x)),
        ("copy", lambda x, e: len(x.copy())), ("dict()", lambda x, e: len(dict(x))), ("keys &", lambda x, e: len(x.keys() & other_dict(e).keys())), ("keys |", lambda x, e: len(x.keys() | other_dict(e).keys())),
        ("keys -", lambda x, e: len(x.keys() - other_dict(e).keys())), ("keys ^", lambda x, e: len(x.keys() ^ other_dict(e).keys())), ("keys ==", lambda x, e: x.keys() == other_dict(e).keys()),
        ("keys <=", lambda x, e: x.keys() <= other_dict(e).keys()), ("keys isdisjoint", lambda x, e: x.keys().isdisjoint(evils(e.answer))), ("e in keys", lambda x, e: e in x.keys()),
        ("items &", lambda x, e: len(x.items() & other_dict(e).items())), ("items ==", lambda x, e: x.items() == other_dict(e).items()), ("in items", lambda x, e: (e, 1) in x.items()), ("in values", lambda x, e: e in x.values()),
        ("list", lambda x, e: len(list(x))), ("items list", lambda x, e: len(list(x.items()))), ("reversed", lambda x, e: len(list(reversed(x)))), ("repr", lambda x, e: len(repr(x)) > 0),
        ("fromkeys", lambda x, e: len(type(x).fromkeys(x))), ("move_to_end", lambda x, e: x.move_to_end(e)), ("popitem last", lambda x, e: x.popitem()), ("od popitem first", lambda x, e: x.popitem(last=False)),
        ("Counter +", lambda x, e: len(x + x)), ("Counter update", lambda x, e: x.update(evils(e.answer))), ("subtract", lambda x, e: x.subtract(evils(e.answer))), ("most_common", lambda x, e: len(x.most_common(2))),
        ("**", lambda x, e: len((lambda **k: k)(**{"a": 1})),), ("ChainMap", lambda x, e: collections.ChainMap(x, other_dict(e)).get(e)),
    ]:
        if name in ("Counter +", "Counter update", "subtract", "most_common") and kind is not collections.Counter: continue
        if name in ("move_to_end", "od popitem first") and kind is not collections.OrderedDict: continue
        run(kind.__name__ + " " + name, make_dict, op, dict_actions, delays=(1, 2, 4, 8))
