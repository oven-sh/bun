# collections.OrderedDict, the native one.
import collections, copy, gc, pickle, sys, weakref
from collections import OrderedDict
import _collections

def attempt(f, *args, **kwargs):
    try:
        return f(*args, **kwargs)
    except BaseException as e:
        return type(e).__name__, str(e)

print("== what it is")
print(OrderedDict is _collections.OrderedDict, OrderedDict.__module__, OrderedDict.__name__, OrderedDict.__qualname__)
print(OrderedDict.__mro__, OrderedDict.__doc__)
print(sorted(k for k in vars(OrderedDict) if k not in ("__doc__",)))
print(issubclass(OrderedDict, dict), isinstance(OrderedDict(), collections.abc.MutableMapping), isinstance(OrderedDict(), collections.abc.Reversible))
print(OrderedDict.__hash__, attempt(hash, OrderedDict()))
print(type(OrderedDict.__init__).__name__, type(OrderedDict.popitem).__name__, type(vars(OrderedDict)["fromkeys"]).__name__, type(vars(OrderedDict)["__dict__"]).__name__)
for name in ("fromkeys", "setdefault", "pop", "popitem", "move_to_end", "copy", "clear", "keys", "update", "__reduce__", "__sizeof__", "__reversed__"):
    print(name, getattr(OrderedDict, name).__text_signature__)

print("== making one")
pairs = [("c", 1), ("b", 2), ("a", 3), ("d", 4), ("e", 5)]
print(OrderedDict(), OrderedDict(pairs), OrderedDict(dict(pairs)), OrderedDict(**dict(pairs)), OrderedDict(pairs, c=9, z=0))
print(OrderedDict(self=1, other=2), OrderedDict([("a", 1)], a=2))
print(attempt(OrderedDict, 1, 2), attempt(OrderedDict, 1), attempt(OrderedDict, [1]), attempt(OrderedDict, [(1,)]), attempt(OrderedDict, [(1, 2, 3)]), attempt(OrderedDict, [()]))
print(attempt(OrderedDict.__init__), attempt(OrderedDict.__init__, {}), attempt(OrderedDict().update, 1, 2))
od = OrderedDict(pairs)
od.__init__([("z", 26)], c=10)
print(od)

class Keyed:
    def keys(self): return iter("xy")
    def __getitem__(self, key): return key.upper()
class Itemed:
    def items(self): return [("p", 1), ("q", 2)]
print(OrderedDict(Keyed()), OrderedDict(Itemed()), OrderedDict(iter(pairs)), OrderedDict(x for x in pairs))
print(OrderedDict(["ab", "cd"]), OrderedDict(frozendict(a=1)) if "frozendict" in dir(__builtins__) else None)

print("== items")
od = OrderedDict(pairs)
od["b"] = 20
od["f"] = 6
del od["a"]
print(od, len(od), "a" in od, "b" in od, od["b"], od.get("a"), od.get("a", 0), attempt(od.__getitem__, "a"), attempt(od.__delitem__, "a"))
od["a"] = 30
print(list(od), list(reversed(od)), list(od.keys()), list(od.values()), list(od.items()))
print(list(reversed(od.keys())), list(reversed(od.values())), list(reversed(od.items())))
print(attempt(od.__setitem__, [], 1), attempt(od.__delitem__, []), attempt(od.pop, []), attempt(od.move_to_end, []), attempt(od.setdefault, []))

print("== pop, popitem, setdefault")
od = OrderedDict(pairs)
print(od.pop("b"), od.pop("b", None), od.pop("b", 7), od.pop(key="d"), od.pop(key="d", default=8), od.pop("q", default=9), attempt(od.pop, "b"), attempt(od.pop), od)
print(od.popitem(), od.popitem(last=False), od.popitem(False), attempt(od.popitem), attempt(od.popitem, last=False), od)
print(attempt(OrderedDict(pairs).popitem, 1, 2), OrderedDict(pairs).popitem(0), OrderedDict(pairs).popitem([]), OrderedDict(pairs).popitem("x"))
od = OrderedDict(pairs)
print(od.setdefault("c", 9), od.setdefault("x"), od.setdefault("y", 5), od.setdefault(key="z", default=6), od.setdefault("w", default=7), od)

print("== move_to_end")
od = OrderedDict.fromkeys("abcde")
for key, last in (("c", True), ("c", True), ("a", True), ("e", False), ("e", False), ("b", False), ("d", True)):
    od.move_to_end(key, last)
    print("".join(od), end=" ")
print()
od.move_to_end("a", last=False); od.move_to_end(key="b"); print("".join(od), "".join(reversed(od)))
print(attempt(od.move_to_end, "x"), attempt(od.move_to_end, "x", False), attempt(OrderedDict().move_to_end, "x"), attempt(od.move_to_end))
one = OrderedDict(a=1)
one.move_to_end("a"); one.move_to_end("a", False); print(one)
# The key that is there stays.
od = OrderedDict([(1, "a"), (2, "b")])
od.move_to_end(1.0); print(od); od.move_to_end(True, last=False); print(od)

print("== a queue at either end, for long")
od = OrderedDict()
for i in range(20000):
    od[i] = i
    if i >= 10:
        k, v = od.popitem(last=False)
        assert k == v == i - 10, (k, v, i)
print(list(od))
for i in range(20000):
    od[-i - 1] = i
    od.move_to_end(-i - 1, last=False)
    k, v = od.popitem()
print(list(od))
for i in range(5000):
    first = next(iter(od)); od.move_to_end(first)
    last = next(reversed(od)); od.move_to_end(last, last=False)
    od.move_to_end(first)
print(len(od), sorted(od) == sorted(range(-20000, -19990)), list(od) == list(reversed(list(reversed(od)))))
lru = OrderedDict()
hits = 0
for i in range(30000):
    key = (i * 7919) % 97 if i % 3 else (i * 31) % 13
    if key in lru:
        hits += 1
        lru.move_to_end(key)
    else:
        lru[key] = i
        if len(lru) > 32:
            lru.popitem(last=False)
print(hits, list(lru)[:8], len(lru))
front = OrderedDict()
for i in range(3000):
    front[i] = None
    front.move_to_end(i, last=False)
print(list(front)[:5], list(front)[-5:], list(reversed(front))[:3], len(front))
for i in range(0, 3000, 2):
    del front[i]
print(list(front)[:5], list(front)[-5:], len(front), front.popitem(False), front.popitem())

print("== equality minds the order, between two of them")
a = OrderedDict(pairs); b = OrderedDict(reversed(pairs))
print(a == b, a != b, a == OrderedDict(pairs), a != OrderedDict(pairs), a == dict(b), dict(a) == b, a != dict(b), a == dict(pairs[:-1]), a == 1, a != 1, a == list(pairs))
print(a.__eq__(1), a.__ne__(1), a.__eq__(dict(b)), a.__lt__(b), a.__le__(b), a.__gt__(b), a.__ge__(b), attempt(lambda: a < b))
print(OrderedDict() == OrderedDict(), OrderedDict() == {}, OrderedDict(a=1) == OrderedDict(a=2), OrderedDict(a=1) == OrderedDict(b=1), OrderedDict([(1, 1)]) == OrderedDict([(1.0, True)]))
class Sub(OrderedDict): pass
print(Sub(pairs) == a, a == Sub(pairs), Sub(pairs) == b, Sub(pairs) == dict(b), collections.defaultdict(int, b) == a)

print("== repr")
print(repr(OrderedDict()), repr(a), str(a), Sub(), Sub(pairs), f"{OrderedDict(a=1)!r:>30}")
r = OrderedDict(); r["self"] = r; r["list"] = [r]; print(r)
r = OrderedDict(); r["v"] = r.values(); r["i"] = r.items(); r["k"] = r.keys(); print(r)
print(a.keys(), a.values(), a.items(), OrderedDict().keys(), OrderedDict().values(), OrderedDict().items())

print("== views and iterators")
print(type(a.keys()).__name__, type(a.values()).__name__, type(a.items()).__name__, type(iter(a)).__name__, type(reversed(a)).__name__, type(iter(a.items())).__name__, type(reversed(a.values())).__name__)
print(type(a.keys()).__mro__, type(a.values()).__mro__, type(a.items()).__mro__)
print(isinstance(a.keys(), collections.abc.KeysView), isinstance(a.items(), collections.abc.ItemsView), isinstance(a.values(), collections.abc.ValuesView))
print(sorted(a.keys() & {"a", "c", "q"}), sorted(a.keys() | {"q"}), sorted(a.keys() - {"a"}), sorted(a.keys() ^ {"a", "q"}), a.keys() == set("abcde"), a.keys() == b.keys(), a.items() == b.items(), a.keys().isdisjoint("xyz"))
print(len(a.keys()), "a" in a.keys(), ("a", 3) in a.items(), ("a", 4) in a.items(), 3 in a.values(), a.keys().mapping == a, type(a.keys().mapping).__name__)
print(attempt(type(a.keys())), attempt(type(iter(a))))
it = iter(a); print(next(it), iter(it) is it, list(it), list(it), attempt(next, it))
print(attempt(len, iter(a)), hasattr(iter(a), "__length_hint__"), sorted(set(dir(iter(a))) - set(dir(object))))
view = a.keys(); a2 = OrderedDict(pairs); view = a2.items(); a2["new"] = 0; print(list(view)[-1], len(view))

print("== changes while iterating")
def during(make, change):
    od = OrderedDict(pairs)
    it = make(od)
    out = [next(it)]
    change(od)
    out.append(attempt(next, it))
    out.append(attempt(next, it))
    return out
changes = {
    "add": lambda od: od.__setitem__("new", 1),
    "delete": lambda od: od.__delitem__("d"),
    "replace a value": lambda od: od.__setitem__("d", 40),
    "delete and add": lambda od: (od.__delitem__("d"), od.__setitem__("new", 1)),
    "move": lambda od: od.move_to_end("b"),
    "move what is there already": lambda od: od.move_to_end("e"),
    "clear": lambda od: od.clear(),
    "popitem": lambda od: od.popitem(),
    "pop": lambda od: od.pop("a"),
    "setdefault of a new key": lambda od: od.setdefault("new"),
    "setdefault of an old key": lambda od: od.setdefault("a"),
    "update with the same keys": lambda od: od.update(pairs),
}
for name, change in changes.items():
    for maker in (iter, reversed, lambda od: iter(od.values()), lambda od: reversed(od.items())):
        print(name, during(maker, change))
od = OrderedDict(); it = iter(od); od["x"] = 1; print(list(it))
od = OrderedDict(a=1); it = iter(od); print(next(it)); od["x"] = 1; print(attempt(next, it), attempt(next, it))
od = OrderedDict(pairs)
print(attempt(lambda: [od.move_to_end(k) for k in od]), attempt(lambda: [od.pop(k) for k in od]), od)

print("== copies")
s = Sub(pairs); s.attr = [1]
for c in (a.copy(), copy.copy(a), copy.deepcopy(a), s.copy(), copy.copy(s), copy.deepcopy(s)):
    print(type(c).__name__, c, vars(c))
print(a.copy() is not a, a.copy() == a, copy.copy(s).attr is s.attr, copy.deepcopy(s).attr is s.attr, vars(s.copy()))
print(OrderedDict.fromkeys("abc"), OrderedDict.fromkeys("abc", 0), OrderedDict.fromkeys(iterable="ab", value=1), Sub.fromkeys("ab"), type(Sub.fromkeys("ab")).__name__, attempt(OrderedDict.fromkeys), attempt(OrderedDict.fromkeys, 1))
print(dict(a), list(a.items()) == list(dict(a).items()), {**a}, (lambda **kw: kw)(**a), [*a], dict(b) == dict(a))

print("== | and |=")
x = OrderedDict(a=1, b=2); y = OrderedDict(c=3, a=4)
for r in (x | y, y | x, x | {"z": 0, "a": 5}, {"z": 0, "a": 5} | x, Sub(x) | y, x | Sub(y), {"q": 1} | Sub(x)):
    print(type(r).__name__, r)
print(attempt(lambda: x | [("a", 1)]), attempt(lambda: [("a", 1)] | x), x.__or__(1), x.__ror__(1), attempt(x.__ior__, 1))
z = x; z |= y; print(z is x, x); z |= [("k", 1)]; print(x); z |= Keyed(); print(x)

print("== pickling")
for proto in range(pickle.HIGHEST_PROTOCOL + 1):
    for value in (a, s, OrderedDict()):
        back = pickle.loads(pickle.dumps(value, proto))
        assert type(back) is type(value) and back == value and list(back) == list(value) and vars(back) == vars(value), (proto, value, back)
red = a.__reduce__(); print(red[0], red[1], red[2], red[3], type(red[4]).__name__, list(red[4]))
red = s.__reduce__(); print(red[0].__name__, red[1], red[2], red[3], list(red[4]))
print(a.__reduce_ex__(2)[:2], a.__reduce_ex__(4)[2:4])
rec = OrderedDict(); rec[1] = rec
back = pickle.loads(pickle.dumps(rec)); print(back[1] is back, type(back).__name__)
for make in (iter, reversed, lambda od: iter(od.keys()), lambda od: iter(od.values()), lambda od: iter(od.items()), lambda od: reversed(od.items())):
    it = make(a); next(it)
    red = it.__reduce__()
    print(red[0] is iter, red[1], list(pickle.loads(pickle.dumps(it))), list(copy.copy(it)), next(it))
it = iter(a); list(it); print(it.__reduce__()[1])

print("== attributes, weak references, slots")
od = OrderedDict(); od.x = 1; print(vars(od), od.__dict__, od.x, od, attempt(getattr, od, "y"))
od.__dict__ = {"y": 2}; print(od.y, vars(od)); del od.y; print(vars(od))
w = weakref.ref(od); print(w() is od, weakref.getweakrefcount(od))
class Slotted(OrderedDict):
    __slots__ = ("x",)
sl = Slotted(a=1); sl.x = 5; sl.other = 6; print(sl, sl.x, vars(sl), copy.copy(sl).x, pickle.loads(pickle.dumps(sl)).x)
print(OrderedDict.__dictoffset__ != 0, OrderedDict.__weakrefoffset__ != 0)
print(sys.getsizeof(OrderedDict(pairs)) > sys.getsizeof(dict(pairs)), sys.getsizeof(OrderedDict()) > sys.getsizeof({}))

print("== what subclasses override is what gets called")
class Loud(OrderedDict):
    def __setitem__(self, key, value):
        log.append(("set", key, value)); super().__setitem__(key, value)
    def __getitem__(self, key):
        log.append(("get", key)); return super().__getitem__(key)
    def __delitem__(self, key):
        log.append(("del", key)); super().__delitem__(key)
    def __contains__(self, key):
        log.append(("in", key)); return super().__contains__(key)
    def __iter__(self):
        log.append(("iter",)); return super().__iter__()
    def keys(self):
        log.append(("keys",)); return super().keys()
    def items(self):
        log.append(("items",)); return super().items()
    def __missing__(self, key):
        log.append(("missing", key)); return "missing"
def logged(f, *args, **kwargs):
    global log
    log = []
    result = attempt(f, *args, **kwargs)
    return result, log
print(logged(Loud, [("a", 1)], b=2))
l = Loud(a=1, b=2)
print(logged(l.update, {"c": 3}, d=4))
print(logged(l.update, OrderedDict(e=5)))
print(logged(l.update, Loud(f=6)))
print(logged(l.setdefault, "a", 9)); print(logged(l.setdefault, "g", 9))
print(logged(l.pop, "a")); print(logged(l.pop, "a", None)); print(logged(l.pop, "nope"))
print(logged(l.popitem)); print(logged(l.popitem, last=False))
print(logged(l.move_to_end, "c")); print(logged(l.copy)); print(logged(Loud.fromkeys, "xy", 0)); print(logged(l.clear))
l = Loud(a=1, b=2)
print(logged(repr, l)); print(logged(l.__eq__, OrderedDict(a=1, b=2))); print(logged(l.__reduce__)[1]); print(logged(list, l)); print(logged(dict, l)); print(logged(lambda: l | {"z": 1})); print(logged(lambda: {"z": 1} | l))
print(logged(lambda: l["nope"])); print(logged(l.get, "nope")); print(logged(list, l.values())); print(logged(list, OrderedDict.items(l))); print(logged(copy.copy, l)); print(logged(OrderedDict, l))
class Missing(OrderedDict):
    def __missing__(self, key): return 0
m = Missing(a=1); print(m["x"], m.pop("x", None), attempt(m.pop, "x"), m.setdefault("x", 5), m.get("y"), m)

print("== keys that misbehave")
class Key:
    def __init__(self, h): self.h = h
    def __hash__(self): return self.h
    def __eq__(self, other): return isinstance(other, Key) and self.h == other.h
    def __repr__(self): return f"Key({self.h})"
od = OrderedDict((Key(i % 3), i) for i in range(6)); print(od)
keys = [Key(i) for i in range(4)]
od = OrderedDict.fromkeys(keys)
keys[1].h = 100
print(attempt(list, od), attempt(list, od.values())[0], attempt(list, od.items())[0], attempt(repr, od)[0], attempt(od.copy)[0], len(od))
class Bad:
    def __hash__(self): return 1
    def __eq__(self, other): raise ZeroDivisionError("eq")
od = OrderedDict(); od[Bad()] = 1
print(attempt(od.__setitem__, Bad(), 2), attempt(od.move_to_end, Bad()), attempt(od.pop, Bad()), attempt(od.__contains__, Bad()), len(od))
class Mutator:
    def __init__(self, od): self.od = od
    def __hash__(self): return 7
    def __eq__(self, other):
        self.od.clear(); return True
x = OrderedDict(); y = OrderedDict(); x[Mutator(x)] = 1; y[Mutator(y)] = 1
print(attempt(x.__eq__, y))

print("== going behind its back with dict's own methods")
od = OrderedDict(pairs)
dict.__setitem__(od, "c", 100); print(od["c"], list(od))
print(dict.__len__(od), dict.__contains__(od, "a"), dict.__getitem__(od, "a"), dict.get(od, "a"), sorted(dict.keys(od)), type(dict.keys(od)).__name__, dict.__eq__(od, dict(od)), dict.copy(od) == od, type(dict.copy(od)).__name__)

print("== the garbage collector")
class Node: pass
n = Node(); od = OrderedDict(n=n); n.od = od; w = weakref.ref(n); del n, od; gc.collect(); print(w())
od = OrderedDict(a=1); it = iter(od); w = weakref.ref(od); del od; gc.collect(); print(w() is not None); list(it); gc.collect(); print(w())

print("== in the library")
import functools, inspect, json, pprint, csv, io, configparser, typing
print(json.dumps(OrderedDict(pairs)), json.loads('{"b": 1, "a": 2}', object_pairs_hook=OrderedDict))
pprint.pprint(OrderedDict(pairs)); pprint.pprint(OrderedDict((f"key{i}", list(range(i))) for i in range(8)), width=40); pprint.pprint(OrderedDict())
print(pprint.pformat(OrderedDict(pairs).keys()), pprint.pformat(OrderedDict(pairs).items(), width=20), pprint.pformat(Sub(pairs)))
print(inspect.signature(lambda a, *b, c=1, **d: 0).parameters.__class__.__name__, typing.OrderedDict[str, int], OrderedDict[str, int], typing.get_origin(typing.OrderedDict[str, int]) is OrderedDict)
P = collections.namedtuple("P", "x y"); print(P(1, 2)._asdict())
c = collections.Counter("abracadabra"); print(OrderedDict(c.most_common()))
print(collections.ChainMap(OrderedDict(a=1), OrderedDict(b=2))["b"], sorted(OrderedDict(b=1, a=2)), max(OrderedDict(b=1, a=2)), OrderedDict(sorted(dict(pairs).items())))
match OrderedDict(a=1, b=2):
    case {"a": x, **rest}: print(x, rest, type(rest).__name__)
