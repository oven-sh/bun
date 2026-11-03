def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print(max(1, 2), max(2, 1), max(1, 2, 3), max([1, 3, 2]), max((1,)), max("abc"), max("a", "b"), max([1, 2.5]), max(1, 1.0), max(1.0, 1), max(True, 1), max(1, True), max([[1, 2], [1, 3]]), max((1, "a"), (1, "b")), max({1: 9, 2: 0}), max({3, 1, 2}), max(range(5)), max(x for x in [1, 5, 2]), max(-1, -2), max(2 ** 70, 2 ** 69), max(float("inf"), 1), max("é", "z"), max(b"ab"), max([1], default=0), max([], default=0), max([], default=None), max((), default="d"), max(iter([]), default=[]), max("a", "B", key=str.lower), max([1, -3, 2], key=abs), max(1, -3, 2, key=abs), max([1, 2], key=None), max(1, 2, key=None), max(["aa", "b", "cc"], key=len), max([(1, "x"), (1, "y")], key=lambda p: p[0]), max([], key=abs, default="kd"), max([3], key=lambda v: 1 / 0 if False else v))
print(min(1, 2), min(2, 1), min(3, 1, 2), min([3, 1, 2]), min("abc"), min(1, 1.0), min(1.0, 1), min(True, 1), min(1, True), min([[1, 2], [1, 3]]), min({1: 9, 2: 0}), min(range(5)), min(range(5, 0, -1)), min(-1, -2), min(float("-inf"), 1), min([], default=0), min([1], default=0), min("a", "B", key=str.lower), min([1, -3, 2], key=abs), min(["aa", "b", "cc", "d"], key=len), min([(1, "x"), (1, "y")], key=lambda p: p[0]), min(0.0, -0.0), min(-0.0, 0.0), max(0.0, -0.0), max(-0.0, 0.0))
nan = float("nan"); print(max(nan, 1), max(1, nan), min(nan, 1), min(1, nan), max([1, nan, 2]), max([nan, 1, 2]), min([1, nan, 0]), max([2, nan, 1]))
for f in (max, min):
    t(lambda: f()); t(lambda: f(1)); t(lambda: f([])); t(lambda: f(())); t(lambda: f("")); t(lambda: f(iter([]))); t(lambda: f(None)); t(lambda: f(1, "a")); t(lambda: f([1, "a"])); t(lambda: f([1, None])); t(lambda: f(1, 2, default=0)); t(lambda: f([1], nope=1)); t(lambda: f([1, 2], key=1)); t(lambda: f([1, 2], key=lambda: 0)); t(lambda: f(1j, 2j)); t(lambda: f([{}, {}])); t(lambda: f(key=abs)); t(lambda: f(default=1)); t(lambda: f([1], [2], default=0)); t(lambda: f(object(), object())); t(lambda: f([], key=abs)); t(lambda: f({}, default="empty dict")); t(lambda: f([1, 2], key=lambda v: [v, "a"][v - 1]))
calls = []
def k(v): calls.append(v); return -v
print(max([3, 1, 2], key=k), calls); calls.clear(); print(min(3, 1, 2, key=k), calls)
class C:
    def __init__(s, v): s.v = v
    def __lt__(s, o): log.append("%d<%d" % (s.v, o.v)); return s.v < o.v
    def __gt__(s, o): log.append("%d>%d" % (s.v, o.v)); return s.v > o.v
    def __repr__(s): return "C%d" % s.v
log = []; print(max(C(1), C(3), C(2)), log); log.clear(); print(min(C(2), C(1), C(3)), log); log.clear(); print(sorted([C(2), C(1), C(3)]), log)
# sorted
print(sorted([3, 1, 2]), sorted((3, 1, 2)), sorted("bca"), sorted({3: 0, 1: 0}), sorted({3, 1, 2}), sorted(range(3, 0, -1)), sorted([]), sorted(x for x in [2, 1]), sorted([3, 1, 2], reverse=True), sorted([3, 1, 2], reverse=False), sorted([3, 1, 2], reverse=1), sorted([3, 1, 2], reverse=0), sorted(["b", "A", "c"]), sorted(["b", "A", "c"], key=str.lower), sorted([1, -2, 3], key=abs), sorted([1, -2, 3], key=abs, reverse=True), sorted([1, 2.5, 0]), sorted([True, 0, 2]), sorted([(2, "a"), (1, "b"), (1, "a")]), sorted([[2], [1, 5], [1]]), sorted(["é", "z", "a", "😀", "Z"]), sorted([b"b", b"a"]), sorted([1, 2], key=None), sorted([-0.0, 0.0]), sorted([0.0, -0.0]), sorted([2 ** 70, 1, -(2 ** 70)]), sorted(["aa", "a", ""]), sorted([None] * 1), sorted([(1, None), (0, None)]))
pairs = [(1, "a"), (0, "b"), (1, "c"), (0, "d"), (1, "e")]
print(sorted(pairs, key=lambda p: p[0]), sorted(pairs, key=lambda p: p[0], reverse=True), sorted(pairs, key=lambda p: -p[0]))
src = [3, 1, 2]; r = sorted(src); print(src, r, r is src, type(sorted((1,))), type(sorted("a")))
print(sorted(range(100), key=lambda v: (v % 7, -v))[:10], sorted(range(50), key=lambda v: v * 37 % 50) == list(sorted(range(50), key=lambda v: v * 37 % 50)), sorted([(i * 7919) % 1000 for i in range(300)])[:8], sorted([(i * 7919) % 1000 for i in range(300)], reverse=True)[:8], sorted(list(range(100)) + list(range(100)))[:6], sorted([5] * 10 + [1] * 3)[:5], sorted(list(range(64, 0, -1)))[:5], sorted([str(i) for i in range(25)])[:12])
t(lambda: sorted()); t(lambda: sorted(1)); t(lambda: sorted(None)); t(lambda: sorted([1, "a"])); t(lambda: sorted(["a", 1])); t(lambda: sorted([1, None])); t(lambda: sorted([1j, 2j])); t(lambda: sorted([{}, {}])); t(lambda: sorted([1], abs)); t(lambda: sorted([1], None, True)); t(lambda: sorted([1], nope=1)); t(lambda: sorted([1, 2], key=1)); t(lambda: sorted([1, 2], key=lambda: 0)); t(lambda: sorted([1, 2], reverse="yes")); t(lambda: sorted([1, 2], reverse=None)); t(lambda: sorted([1, 2], reverse=1.5)); t(lambda: sorted([object(), object()])); t(lambda: sorted([[1], ["a"]])); t(lambda: sorted([(1, 2), (1, "a")])); t(lambda: sorted([1, 2], key=lambda v: 1 / (v - 2))); t(lambda: sorted([{1}, {2}])); t(lambda: sorted(iterable=[1])); t(lambda: sorted([int, str]))
print(sorted([{1, 2}, {1}, {1, 2, 3}], key=len), sorted([{1}, {1, 2}]), sorted([{2}, {1}]) in ([{2}, {1}], [{1}, {2}]))
print(sorted([nan, 1, 0])[1:] if False else "", len(sorted([nan, 1, 0])))
# any, all
print(any([]), any([0]), any([0, 1]), any([0, "", None]), any("a"), any(""), any({0: 1}), any({1: 0}), any(range(1)), any(range(2)), any(x > 2 for x in range(5)), any([[]]), any([[0]]), any(()), any({0}), any(iter([0, 0, 2])), all([]), all([1]), all([1, 0]), all([1, "a", [0]]), all(""), all("a"), all({0: 1}), all({1: 0}), all(range(1)), all(range(1, 3)), all(x < 5 for x in range(5)), all([[]]), all(()), all([None]), all([True, 1, 1.5, "x", (0,)]))
def gen(vals):
    for v in vals: print("yield", v, end="; "); yield v
print(any(gen([0, 1, 2]))); print(all(gen([1, 0, 2]))); print(any(gen([0, 0]))); print(all(gen([1, 1])))
it = iter([0, 1, 2, 3]); print(any(it), list(it)); it = iter([1, 0, 2, 3]); print(all(it), list(it))
t(lambda: any()); t(lambda: any(1)); t(lambda: any(None)); t(lambda: any([1], [2])); t(lambda: all()); t(lambda: all(1)); t(lambda: all(None)); t(lambda: all(iterable=[])); t(lambda: any(1 / 0 for _ in [1]))
class NB:
    def __bool__(s): raise ValueError("no bool")
t(lambda: any([NB()])); t(lambda: all([NB()])); t(lambda: any([1, NB()])); t(lambda: all([0, NB()]))
# len
print(len([]), len([1, 2]), len(()), len("abc"), len("é😀"), len(b"ab"), len({}), len({1: 2}), len(set()), len({1, 2}), len(range(10)), len(range(0, 10, 3)), len(range(10, 0, -3)), len(range(5, 0)), len(bytearray(3)), len(frozenset([1])), len({}.keys()), len({1: 2}.items()), len({1: 2}.values()), len(range(2 ** 62)), len(memoryview(b"abc")), len("\U0001F600" * 3), len("a\0b"), len([[]]), len(((),)), len(frozendict(a=1)))
# hash
print(hash(0), hash(1), hash(-1), hash(-2), hash(2 ** 61 - 1), hash(2 ** 61), hash(2 ** 61 + 1), hash(-(2 ** 61 - 1)), hash(2 ** 100), hash(-(2 ** 100)), hash(1.0), hash(1.5), hash(-1.0), hash(0.0), hash(-0.0), hash(float("inf")), hash(float("-inf")), hash(0.1), hash(1e100), hash(1e-100), hash(True), hash(False), hash(1 + 0j), hash(1j), hash(1 + 1j), hash(-1j))
print(hash(()), hash((1,)), hash((1, 2)), hash((1, (2, 3))), hash(((),)), hash(frozenset()), hash(frozenset({1})), hash(frozenset({1, 2, 3})), hash(range(0)), hash(range(3)), hash(range(1, 4, 2)))
print(hash(None) == hash(None), hash("") , hash(b""), hash("a") == hash("a"), hash(b"a") == hash("a"), hash(slice(1, 2, 3)) == hash(slice(1, 2, 3)), hash(3.0) == hash(3), hash(2.0 ** 70) == hash(2 ** 70), hash(0.5) == hash(0.5 + 0j), hash(int) == hash(int), hash(len) == hash(len), hash((1, 2)) == hash((1.0, 2.0)), hash(frozenset({1, 2})) == hash(frozenset({2, 1})), hash(...) == hash(...), hash(frozendict()) == hash(frozendict()), hash(frozendict(a=1, b=2)) == hash(frozendict(b=2, a=1)))
for v in ([], {}, set(), bytearray(), [1], ([],), (1, [2]), {1: 2}.keys(), {1: 2}.items(), {1: 2}.values() if False else [], slice([], 1), frozendict(a=[]), memoryview(bytearray(b"a"))):
    t(lambda: hash(v))
t(lambda: hash()); t(lambda: hash(1, 2))
