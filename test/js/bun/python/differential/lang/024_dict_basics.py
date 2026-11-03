def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

d = {"a": 1, "b": 2}
print(d, len(d), d["a"], d["b"], "a" in d, "z" in d, 1 in d, "a" not in d, list(d), bool(d), bool({}))
t(lambda: d["z"])
t(lambda: d[1])
t(lambda: d[None])
t(lambda: {}[()])
t(lambda: {}[""])
t(lambda: {}["a'b"])
t(lambda: {}[(1, 2)])
t(lambda: d[[]])
t(lambda: d[{}])
t(lambda: [] in d)
t(lambda: {[]: 1})
t(lambda: {{}: 1})
t(lambda: {set(): 1})
t(lambda: {(1, []): 1})
t(lambda: d.get([]))
def set_unhashable(): d[[]] = 1
t(set_unhashable)
def del_unhashable(): del d[[]]
t(del_unhashable)
d["c"] = 3; print(d); d["a"] = 10; print(d); del d["b"]; print(d); d["b"] = 20; print(d)
def del_missing(): del d["zz"]
t(del_missing)
print({}, {1: 2}, {1: 2, 3: 4}, {"a": {"b": {"c": 1}}}, {1: [1], 2: (2,), 3: {3}}, {None: None, True: False, 1.5: "f", (1, 2): "t", "s": "s", b"b": "b", frozenset(): "fs"}, {1: 2,}, {1: 1, 1: 2}, {1: "a", 1.0: "b", True: "c"}, {0: "a", False: "b", 0.0: "c", -0.0: "d", 0j: "e"}, {"a": 1, **{"b": 2}}, {**{"a": 1}, "a": 2}, {**{}, **{}}, {**{"a": 1}, **{"a": 2, "b": 3}})
print(dict(), dict({"a": 1}), dict([("a", 1), ("b", 2)]), dict((("a", 1),)), dict(a=1, b=2), dict({"a": 1}, b=2), dict([("a", 1)], a=2), dict(zip("ab", [1, 2])), dict([["a", 1]]), dict(["ab", "cd"]), dict(iter([("x", 1)])), dict({}), dict([]), dict(**{"a": 1}), dict({"a": 1}, **{"b": 2}), dict(x for x in [(1, 2)]), dict([(1, 2), (1, 3)]), dict(dict(a=1)))
t(lambda: dict(1))
t(lambda: dict([1]))
t(lambda: dict([(1,)]))
t(lambda: dict([(1, 2, 3)]))
t(lambda: dict(["a"]))
t(lambda: dict(["abc"]))
t(lambda: dict([[]]))
t(lambda: dict(None))
t(lambda: dict({}, {}))
t(lambda: dict([(1, 2), 3]))
t(lambda: dict([([], 1)]))
t(lambda: dict(**{1: 2}))
t(lambda: {**1})
t(lambda: {**[1]})
t(lambda: {**None})
t(lambda: {**"ab"})
class Keys:
    def keys(self): return ["x", "y"]
    def __getitem__(self, k): return k * 2
print(dict(Keys()), {**Keys()}, dict(Keys(), z=1))
# Insertion order is kept.
o = {}
for k in "zyxabc": o[k] = ord(k)
print(list(o), list(o.values()), list(o.items())[:2])
o["y"] = 0; print(list(o)); del o["x"]; o["x"] = 1; print(list(o)); o.pop("z"); o["z"] = 2; print(list(o)); print(list(reversed(o)), list(reversed(o.items()))[:2], list(reversed(o.values())))
print({"b": 1, "a": 2} == {"a": 2, "b": 1}, list({"b": 1, "a": 2}) == list({"a": 2, "b": 1}), {1: 2} == {1: 2}, {1: 2} != {1: 3}, {1: 2} == {1.0: 2.0}, {} == {}, {1: 2} == {2: 1}, {1: 2} == [(1, 2)], {1: [1]} == {1: [1]}, {1: 2} == {1: 2, 3: 4}, {"a": {"b": 1}} == {"a": {"b": 1}}, {1: float("nan")} == {1: float("nan")})
t(lambda: {} < {})
t(lambda: {1: 2} >= {1: 2})
t(lambda: {} + {})
t(lambda: {} * 2)
t(lambda: {} - {})
t(lambda: {} & {})
t(lambda: hash({}))
print({"a": 1} | {"b": 2}, {"a": 1} | {"a": 2}, {} | {}, {"a": 1, "b": 2} | {"b": 3, "c": 4}, {"a": 1}.__or__({"b": 2}), {"a": 1}.__ror__({"a": 0, "b": 2}), {"a": 1}.__or__([("b", 2)]))
t(lambda: {} | [])
t(lambda: {} | [("a", 1)])
t(lambda: [] | {})
t(lambda: {} | None)
t(lambda: {} | 1)
e = f = {"a": 1}; e |= {"b": 2}; print(e, f is e); e |= [("c", 3)]; print(e); e |= {"a": 0}; print(e); e |= (); print(e); e |= Keys(); print(e)
def ior_bad():
    x = {}; x |= 1
t(ior_bad)
def ior_bad2():
    x = {}; x |= [1]
t(ior_bad2)
for k in {"a": 1, "b": 2}: print(k, end=" ")
for k, v in {"a": 1, "b": 2}.items(): print(k, v, end=" ")
for v in {"a": 1, "b": 2}.values(): print(v, end=" ")
print()
def grow():
    x = {1: 1}
    for k in x: x[k + 1] = 1
t(grow)
def shrink():
    x = {1: 1, 2: 2}
    for k in x: del x[k]
t(shrink)
def grow_items():
    x = {1: 1}
    for k, v in x.items(): x[k + 1] = 1
t(grow_items)
def grow_values():
    x = {1: 1}
    for v in x.values(): x[v + 1] = 1
t(grow_values)
def replace_ok():
    x = {1: 1, 2: 2}
    for k in x: x[k] = 0
    return x
t(replace_ok)
def same_size():
    x = {1: 1, 2: 2}
    for k in x:
        del x[k]; x[k + 10] = 1
t(same_size)
def clear_during():
    x = {1: 1, 2: 2}
    for k in x: x.clear()
t(clear_during)
r = {}; r["self"] = r; print(r, r["self"]["self"] is r)
r = {"l": []}; r["l"].append(r); print(r)
print(str({}), repr({"a": "b"}), str({1: "a'b"}), str({"k": [1, {"n": (1,)}]}), str({(1,): {2}}), "%s" % {"a": 1}, f"{ {'a': 1} }", str({1.0: 2.0, None: ..., "x": b"y"}))
print(sorted({"b": 1, "a": 2}), sorted({"b": 1, "a": 2}.items()), sorted({"b": 1, "a": 2}.values()), max({"a": 1, "b": 0}), min({"a": 1, "b": 0}), sum({1: "x", 2: "y"}), any({0: 1}), all({0: 1}), list(enumerate({"a": 1})), len({1: 1, 2: 2}), max({"a": 1, "b": 0}.items(), key=lambda p: p[1]), tuple({"a": 1}), set({"a": 1}), list(zip({"a": 1}, {"b": 2})), dict(sorted({"b": 1, "a": 2}.items())), list(map(str, {1: 2})), "".join({"a": 1, "b": 2}))
big = {i: i * i for i in range(10000)}
print(len(big), big[9999], 10000 in big, sum(big.values()), list(big)[:3], list(big)[-1])
for i in range(0, 10000, 2): del big[i]
print(len(big), list(big)[:3], 0 in big, 1 in big)
for i in range(0, 100, 2): big[i] = -1
print(len(big), list(big)[-3:], list(big)[:2])
sk = {}
for i in range(1000): sk["k%d" % i] = i
print(len(sk), sk["k999"], "k1000" in sk, list(sk)[:2], sum(sk.values()))
mixed = {1: "int", "1": "str", 1.5: "float", (1,): "tuple", None: "none", b"1": "bytes", 10 ** 30: "big", -1: "neg", "": "empty", (): "unit", frozenset({1}): "fs", True: "bool"}
print(mixed, len(mixed), mixed[1], mixed["1"], mixed[10 ** 30], mixed[frozenset([1])], mixed[1.0], mixed[-1], mixed[-1.0])
print(type({}), dict.__mro__, isinstance({}, dict), dict.__name__, dict.__hash__, type(iter({})).__name__, type({}.keys()).__name__, type({}.values()).__name__, type({}.items()).__name__, type(iter({}.items())).__name__, type(reversed({})).__name__, sorted(n for n in dir(dict) if not n.startswith("_")))
