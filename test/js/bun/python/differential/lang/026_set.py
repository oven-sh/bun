def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)
def s(x): return sorted(x, key=repr)

a = {1, 2, 3}; b = {3, 4, 5}
print(a, len(a), 1 in a, 9 in a, 1 not in a, bool(a), bool(set()), set(), {1}, {1, 1, 1}, {1, 1.0, True}, {0, False, 0.0}, type({1}), type({}), type(set()))
print(set([1, 2, 2]), set((1, 2)), s(set("abca")), set(range(5)), set({1: 2}), set({1}), set(x for x in [1, 2]), set([]), set(""), set(frozenset([1])), set(iter([3])), s({(1, 2), "a", None, 1.5, b"x", frozenset()}))
t(lambda: set(1))
t(lambda: set(None))
t(lambda: set(1, 2))
t(lambda: set([[]]))
t(lambda: {[]})
t(lambda: {{}})
t(lambda: {set()})
t(lambda: {(1, [])})
t(lambda: [] in a)
t(lambda: set() in a)
t(lambda: {1} in {frozenset({1})})
t(lambda: a[0])
t(lambda: hash(a))
t(lambda: a + b)
t(lambda: a * 2)
t(lambda: set(a=1))
print(a | b, a & b, a - b, b - a, a ^ b, a | set(), a & set(), a - set(), a ^ set(), a | a, a & a, a - a, a ^ a, a | b | {9}, a & b & {3}, a - b - {1}, set() | set())
print(a.union(b), a.union([7], (8,)), a.union(), a.union("x") - a, a.intersection(b), a.intersection([1, 2], [2, 3]), a.intersection(), a.difference(b), a.difference([1], [2]), a.difference(), a.symmetric_difference(b), a.symmetric_difference([1, 9]), a.union({}), a.union(range(2)), a.intersection(range(2, 10)), a.difference({1: 0}))
t(lambda: a | [1])
t(lambda: a & [1])
t(lambda: a - [1])
t(lambda: a ^ [1])
t(lambda: [1] | a)
t(lambda: a | 1)
t(lambda: a | None)
t(lambda: a.union(1))
t(lambda: a.union([[]]))
t(lambda: a.intersection(1))
t(lambda: a.symmetric_difference())
t(lambda: a.symmetric_difference([1], [2]))
print(a == {3, 2, 1}, a != b, a == frozenset(a), a == [1, 2, 3], a == {1: 0, 2: 0, 3: 0}.keys(), {1, 2} < a, {1, 2} <= a, a <= a, a < a, a > {1}, a >= {1}, a >= a, a > a, {1, 9} < a, {1, 9} <= a, set() < a, set() <= set(), set() < set(), a < b, a > b, a <= b, {1} < {2})
print(a.issubset(a), a.issubset({1, 2, 3, 4}), a.issubset([1, 2, 3]), a.issubset([1]), a.issubset(range(10)), a.issuperset({1}), a.issuperset([1, 2]), a.issuperset([9]), a.issuperset([]), a.isdisjoint(b), a.isdisjoint({9}), a.isdisjoint([]), a.isdisjoint([3]), set().isdisjoint(set()), a.isdisjoint("ab"), set().issubset([]))
t(lambda: a < [1])
t(lambda: a <= 1)
t(lambda: a.issubset(1))
t(lambda: a.isdisjoint(1))
t(lambda: a.isdisjoint([[]]))
x = {1}
print(x.add(2), set(x), x.add(2), set(x), x.add("a") or s(x), x.add(None) or len(x), x.add((1, 2)) or len(x))
t(lambda: x.add([]))
t(lambda: x.add())
t(lambda: x.add(1, 2))
x = {1, 2, 3}
print(x.remove(1), x, x.discard(2), x, x.discard(9), x)
t(lambda: x.remove(9))
t(lambda: x.remove("a"))
t(lambda: x.remove((1, 2)))
t(lambda: x.remove([]))
t(lambda: x.discard([]))
t(lambda: x.remove({9}))
y = {frozenset({1})}; y.remove({1}); print(y); y = {frozenset({1})}; y.discard({1}); print(y, {1} in {frozenset({1})})
x = {1}; print(x.pop(), x)
t(lambda: set().pop())
x = {1, 2, 3}; print(sorted([x.pop(), x.pop(), x.pop()]), x)
x = {1, 2}; print(x.clear(), x, len(x))
x = {1, 2}; c = x.copy(); c.add(3); print(x, c, type(c))
x = {1}; print(x.update([2, 3]), x); x.update({4}, (5,), "a"); print(s(x)); x.update(); x.update([]); x.update(x); print(len(x)); x = {1}; x.update({2: "v"}); x.update(range(3, 5)); print(x)
x = {1, 2, 3, 4}; print(x.intersection_update([1, 2, 9]), x); x.intersection_update({1}, {1, 2}); print(x); x.intersection_update(); print(x)
x = {1, 2, 3, 4}; print(x.difference_update([1], [2]), x); x.difference_update(); print(x); x.difference_update(x); print(x)
x = {1, 2, 3}; print(x.symmetric_difference_update([3, 4]), x); x.symmetric_difference_update(x); print(x)
t(lambda: {1}.update(1))
t(lambda: {1}.update([[]]))
t(lambda: {1}.intersection_update(1))
t(lambda: {1}.difference_update(1))
t(lambda: {1}.symmetric_difference_update(1))
x = y = {1, 2}; x |= {3}; print(x, y is x); x &= {1, 3}; print(x); x -= {1}; print(x); x ^= {3, 4}; print(x, y is x); x |= frozenset({9}); print(x, type(x))
def bad_ior():
    z = {1}; z |= [2]
def bad_iand():
    z = {1}; z &= [2]
def bad_isub():
    z = {1}; z -= [2]
def bad_ixor():
    z = {1}; z ^= [2]
t(bad_ior); t(bad_iand); t(bad_isub); t(bad_ixor)
# The order of small ints follows the table.
print({3, 1, 2}, {10, 5, 0}, {8, 0, 16}, {-1, 1, 0}, {100, 200, 300}, set(range(10)), set(range(9, -1, -1)), {5, 13, 21}, {1000, 1, 100, 10}, set([7, 15, 23, 31]), {2 ** 10, 2 ** 20, 2 ** 5}, {-5, -3, -1}, {-2, -1}, {33, 1, 65}, set(range(0, 100, 7)), set(range(20, 0, -3)))
z = set()
for i in (17, 1, 33, 9, 25, 41): z.add(i)
print(z, list(z)); z.remove(1); z.add(49); print(z); z.add(1); print(z)
z = set(range(30)); [z.discard(i) for i in range(0, 30, 3)]; print(z); z |= {100, 50, 75}; print(z)
print({1, 2, 3} | {10, 20}, {10, 20} | {1, 2, 3}, {1, 2, 3, 4, 5} & {5, 4, 9}, {5, 4, 9} & {1, 2, 3, 4, 5}, {1, 2, 3, 4} - {2}, {1, 2} ^ {2, 3}, {9, 8, 7} ^ {7, 6}, set([3, 2, 1]).union([0]), {1.0, 2, 3.5}, {True, 2}, {1.5, 2.5, 0.5}, {10 ** 20, 1}, {2 ** 61 - 1, 0, 1}, {2 ** 61, 1}, {0.0, 1e300})
print([x for x in {4, 2, 8}], sorted({3, 1, 2}), list({2, 1}), tuple({2, 1}), sum({1, 2, 3}), max({1, 5, 3}), min({1, 5, 3}), len({1, 2}), any({0}), all({0, 1}), sorted(map(str, {1, 2})), list(enumerate({7})), {x * 2 for x in {1, 2, 3}}, sorted(zip({1}, {2})))
def grow():
    q = {1}
    for e in q: q.add(e + 1)
t(grow)
def shrink():
    q = {1, 2}
    for e in q: q.discard(e)
t(shrink)
it = iter({1, 2, 3}); print(next(it), it.__length_hint__(), type(it).__name__, sorted(it), next(it, "end"))
print(repr(set()), repr({1}), str({1, 2}), repr({"a"}), repr({(1, 2)}), repr({None}), repr({frozenset()}), repr({frozenset({1})}), repr({1.5}), "%s" % {1}, f"{ {1} }", repr({b"a"}))
class R(set): pass
r = R(); print(repr(r), repr(R([1])), type(R([1]) | {2}), type({2} | R([1])), type(R([1]).copy()), type(R([1]).union([2])), R([1]) == {1}, isinstance(R(), set), len(R("aab")))
print(a.__len__(), a.__contains__(1), a.__and__(b), a.__or__(b), a.__sub__(b), a.__xor__(b), a.__rand__(b), a.__ror__(b), a.__rsub__(b), a.__rxor__(b), a.__eq__(a), a.__eq__(1), a.__le__(a), a.__lt__(1), a.__and__([1]), a.__ge__(b), a.__gt__(b), a.__ne__(b), set.__hash__, a.__iand__({1, 2, 3}), a.__repr__(), a.__sizeof__() > 0)
print(set.__mro__, set.__name__, sorted(n for n in dir(set) if not n.startswith("_")))
big = set(range(100000)); print(len(big), 99999 in big, 100000 in big, sum(big), len(big & set(range(50000, 150000))), len(big | set(range(50000, 150000))), len(big - set(range(50000))), min(big), max(big), list(big)[:5], len(big ^ set(range(1, 100001))))
st = {"s%d" % i for i in range(1000)}; print(len(st), "s999" in st, "s1000" in st, len(st & {"s1", "x"}), sorted(st)[:3])
