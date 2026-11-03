def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

d = {"a": 1, "b": 2}
print(d.get("a"), d.get("z"), d.get("z", 0), d.get("a", 0), d.get(None), d.get(1, "x"), {}.get("a"), {None: 1}.get(None))
t(lambda: d.get())
t(lambda: d.get("a", 1, 2))
t(lambda: d.get(key="a"))
print(d.setdefault("a", 9), d.setdefault("c", 3), d, d.setdefault("e"), d)
t(lambda: d.setdefault())
t(lambda: d.setdefault([], 1))
l = {}; l.setdefault("k", []).append(1); l.setdefault("k", []).append(2); print(l)
d = {"a": 1, "b": 2, "c": 3}
print(d.pop("a"), d, d.pop("z", None), d.pop("z", "dflt"), d.pop("b", "dflt"), d)
t(lambda: d.pop("z"))
t(lambda: d.pop())
t(lambda: d.pop("a", 1, 2))
t(lambda: {}.pop("a"))
t(lambda: {}.pop([]))
t(lambda: {}.pop(("a", 1)))
d = {"a": 1, "b": 2, "c": 3}
print(d.popitem(), d, d.popitem(), d.popitem(), d)
t(lambda: {}.popitem())
t(lambda: {1: 1}.popitem(1))
d = {"a": 1}
print(d.update({"b": 2}), d); d.update(c=3); print(d); d.update([("d", 4)]); print(d); d.update({"a": 0}, e=5); print(d); d.update(); print(d); d.update({}); d.update([]); d.update(zip("fg", (6, 7))); print(d); d.update((("h", 8),)); d.update(x for x in [("i", 9)]); print(d); d.update(d); print(len(d)); d.update(a=-1, b=-2); print(d["a"], d["b"])
t(lambda: {}.update(1))
t(lambda: {}.update([1]))
t(lambda: {}.update([(1,)]))
t(lambda: {}.update([(1, 2, 3)]))
t(lambda: {}.update({}, {}))
t(lambda: {}.update(None))
t(lambda: {}.update("ab"))
t(lambda: {}.update(["ab", "c"]))
print({}.update(["ab"]), dict.fromkeys("ab"), dict.fromkeys("ab", 0), dict.fromkeys([1, 2], []), dict.fromkeys([]), dict.fromkeys(range(3), "x"), dict.fromkeys({"a": 1}), dict.fromkeys((1, 1, 2)), dict.fromkeys({1, 2}, None), dict.fromkeys(iter("a")))
fk = dict.fromkeys("ab", []); fk["a"].append(1); print(fk)
t(lambda: dict.fromkeys())
t(lambda: dict.fromkeys(1))
t(lambda: dict.fromkeys([[]]))
d = {"a": [1]}; c = d.copy(); c["b"] = 2; c["a"].append(2); print(d, c, type(c), c is d)
d = {"a": 1}; print(d.clear(), d, len(d)); d["x"] = 1; print(d)
# Views
d = {"a": 1, "b": 2, "c": 3}
k, v, i = d.keys(), d.values(), d.items()
print(k, v, i, len(k), len(v), len(i), list(k), list(v), list(i), "a" in k, "z" in k, 1 in v, 9 in v, ("a", 1) in i, ("a", 2) in i, ("z", 1) in i, "a" in i, ("a",) in i, ("a", 1, 2) in i, ["a", 1] in i)
d["d"] = 4; print(k, v, i, len(k)); del d["a"]; print(list(k), list(v), list(i))
print(k == {"b", "c", "d"}, k == d.keys(), k != {"b"}, k == ["b", "c", "d"], i == {("b", 2), ("c", 3), ("d", 4)}, v == v, v == d.values(), d.values() == d.values(), k == {"b": 0, "c": 0, "d": 0}.keys())
print(sorted(k & {"b", "x"}), sorted(k | {"x"}), sorted(k - {"b"}), sorted(k ^ {"b", "x"}), sorted({"b", "x"} & k), sorted({"x"} | k), sorted({"b", "x"} - k), sorted({"b", "x"} ^ k), sorted(k & ["b"]), sorted(k | ["y"]), sorted(k - "b"), sorted(k & d.keys()), type(k & {"b"}), type(k | k), sorted(i & {("b", 2)}), sorted(i | {(1, 2)}, key=str), sorted(i - {("b", 2)}), sorted(k & "bc"), sorted(["b"] & k) if False else "")
print(k <= {"b", "c", "d"}, k < {"b", "c", "d"}, k < {"b", "c", "d", "e"}, k >= {"b"}, k > {"b"}, k <= {"b"}, k.isdisjoint({"x"}), k.isdisjoint({"b"}), k.isdisjoint(["x"]), i.isdisjoint([("b", 2)]), i.isdisjoint([("b", 3)]), k.isdisjoint(""), {"b"} <= k, {"b"} < k)
t(lambda: v & {1})
t(lambda: v | v)
t(lambda: v < v)
t(lambda: k & 1)
t(lambda: k < ["b"])
t(lambda: k[0])
t(lambda: len(k[0:1]))
t(lambda: k.add("x"))
t(lambda: hash(k))
t(lambda: hash(v) is not None)
t(lambda: {"a": []}.items() & {1})
t(lambda: v.isdisjoint([]))
t(lambda: type(k)())
print(list(reversed(k)), list(reversed(v)), list(reversed(i)), k.mapping, type(k.mapping).__name__, v.mapping == d, i.mapping["b"])
def set_mapping(): k.mapping["x"] = 1
t(set_mapping)
print(repr({}.keys()), repr({}.values()), repr({}.items()), repr({1: [2]}.items()), repr({"a": {"b": 1}}.values()))
r = {}; r["v"] = r.values(); print(r)
r = {}; r["i"] = r.items(); print(r)
it = iter(d); print(next(it), it.__length_hint__(), list(it), next(it, "end"), it.__length_hint__())
it = iter(d.items()); print(next(it), type(next(it)), it.__length_hint__())
it = iter(d.values()); print(next(it), list(it))
it = iter(d); d["new"] = 1
t(lambda: next(it))
del d["new"]
it = iter(d.keys()); next(it); d.pop("b"); d["b"] = 2
t(lambda: next(it))
print(d.__len__(), d.__getitem__("c"), d.__contains__("c"), d.__eq__(dict(d)), d.__eq__(1), d.__ne__({}), d.__iter__().__next__(), d.__repr__(), d.__setitem__("q", 1), d.__delitem__("q"), d.__reversed__().__next__(), d.__or__({}), d.__class_getitem__(int) if False else "", d.__sizeof__() > 0, d.__lt__({}))
x = {}; dict.__setitem__(x, "a", 1); dict.update(x, b=2); print(x, dict.get(x, "a"), dict.keys(x), dict.__len__(x), dict.pop(x, "a"))
t(lambda: dict.get(1, 2))
t(lambda: dict.get())
t(lambda: dict.keys([]))
t(lambda: {}.nope)
def set_attr(): {}.x = 1
t(set_attr)
# Keys with custom __hash__ and __eq__.
class K:
    def __init__(s, v): s.v = v
    def __hash__(s): return s.v % 3
    def __eq__(s, o): return isinstance(o, K) and s.v == o.v
    def __repr__(s): return "K(%d)" % s.v
kd = {K(i): i for i in range(9)}
print(len(kd), kd[K(4)], K(9) in kd, kd.get(K(8)), list(kd)[:4]); del kd[K(3)]; print(len(kd), K(3) in kd, K(6) in kd, K(0) in kd); kd[K(0)] = "replaced"; print(list(kd.items())[0])
class BadHash:
    def __hash__(s): return "x"
class RaisingHash:
    def __hash__(s): raise RuntimeError("no hash")
class RaisingEq:
    def __hash__(s): return 1
    def __eq__(s, o): raise RuntimeError("no eq")
class NoHash:
    __hash__ = None
class EqOnly:
    def __eq__(s, o): return True
t(lambda: {BadHash(): 1})
t(lambda: {RaisingHash(): 1})
t(lambda: {RaisingEq(): 1, RaisingEq(): 2})
t(lambda: {NoHash(): 1})
t(lambda: {EqOnly(): 1})
t(lambda: {1: 1}[RaisingEq()])
class BigHash:
    def __hash__(s): return 2 ** 100
class NegHash:
    def __hash__(s): return -1
class BoolHash:
    def __hash__(s): return True
print(hash(BigHash()), hash(NegHash()), hash(BoolHash()), len({BigHash(): 1, NegHash(): 2}))
same = K(1); print({same: 1}[same], {float("nan"): 1}.get(float("nan")), (lambda n: {n: 1}[n])(float("nan")))
class Evil:
    def __init__(s, d): s.d = d
    def __hash__(s): return 1
    def __eq__(s, o):
        s.d.clear(); return False
ed = {}; ed[Evil(ed)] = 1
t(lambda: ed.get(Evil(ed)))
print(len(ed))
