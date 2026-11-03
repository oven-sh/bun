def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

l = []
print(l.append(1), l, l.append([2]), l, l.append(None), l)
l = [1]
print(l.extend([2, 3]), l); l.extend((4,)); l.extend("ab"); l.extend(range(2)); l.extend({7: 8}); l.extend(x for x in [9]); l.extend([]); l.extend(iter([10])); print(l)
l = [1, 2]; l.extend(l); print(l)
t(lambda: [].extend(1))
t(lambda: [].extend(None))
t(lambda: [].extend())
t(lambda: [].extend([1], [2]))
t(lambda: [].append())
t(lambda: [].append(1, 2))
l = [1, 2, 3]
l.insert(0, "a"); print(l); l.insert(2, "b"); print(l); l.insert(100, "c"); print(l); l.insert(-1, "d"); print(l); l.insert(-100, "e"); print(l); l.insert(len(l), "f"); print(l); l.insert(True, "g"); print(l)
t(lambda: [].insert(0))
t(lambda: [].insert("a", 1))
t(lambda: [].insert(1.0, 1))
t(lambda: [].insert(None, 1))
l = [1, 2, 3, 4, 5]
print(l.pop(), l, l.pop(0), l, l.pop(1), l, l.pop(-1), l, l.pop(-1), l)
t(lambda: [].pop())
t(lambda: [1].pop(1))
t(lambda: [1].pop(-2))
t(lambda: [1].pop("a"))
t(lambda: [1].pop(1.0))
t(lambda: [1].pop(0, 1))
l = [1, 2, 3, 2, 1]
print(l.remove(2), l); l.remove(1); print(l); l.remove(1); print(l)
t(lambda: [1].remove(2))
t(lambda: [].remove(None))
t(lambda: [1].remove())
l = [1, 1.0, True]; l.remove(True); print(l)
nan = float("nan"); l = [nan]; l.remove(nan); print(l)
t(lambda: [float("nan")].remove(float("nan")))
l = [1, 2, 3, 2, 1]
print(l.index(2), l.index(2, 2), l.index(1, 1), l.index(2, -3), l.index(1, -1), l.index(3, 0, 3), l.index(1, -100), l.index(1, 0, 100), [1.0].index(1), [[1]].index([1]), l.index(2, 1, 2))
t(lambda: l.index(9))
t(lambda: l.index(3, 3))
t(lambda: l.index(3, 0, 2))
t(lambda: l.index("a"))
t(lambda: l.index())
t(lambda: l.index(1, "a"))
t(lambda: l.index(1, 1.0))
t(lambda: l.index([1, 2]))
print(l.count(1), l.count(2), l.count(9), [].count(1), [1, 1.0, True].count(1), [[1], [1]].count([1]), [None, None].count(None), [nan, nan].count(nan), ["a", "b", "a"].count("a"))
t(lambda: l.count())
l = [1, 2, 3]; print(l.reverse(), l); l = []; l.reverse(); print(l); l = [1]; l.reverse(); print(l); l = [1, 2, 3, 4]; l.reverse(); print(l)
l = [1, [2]]; c = l.copy(); c.append(3); c[1].append(9); print(l, c, type(c))
l = [1, 2]; print(l.clear(), l, len(l)); l.append(1); print(l)
t(lambda: [].copy(1))
t(lambda: [].clear(1))
t(lambda: [].reverse(1))
# sort
l = [3, 1, 2]; print(l.sort(), l); l.sort(reverse=True); print(l); l.sort(key=lambda x: -x); print(l); l.sort(key=None); print(l); l.sort(key=lambda x: x % 2); print(l); l.sort(reverse=False); print(l)
l = ["b", "A", "c", "B"]; l.sort(); print(l); l.sort(key=str.lower); print(l); l.sort(key=str.lower, reverse=True); print(l); l.sort(key=len); print(l)
l = [(1, "b"), (0, "z"), (1, "a"), (0, "y")]; l.sort(); print(l); l.sort(key=lambda p: p[0]); print(l); l.sort(key=lambda p: p[0], reverse=True); print(l); l.sort(key=lambda p: p[1]); print(l)
l = [1, 2.5, True, 0, -1.5, 10 ** 30, -(10 ** 30), False]; l.sort(); print(l)
l = []; l.sort(); print(l); l = [1]; l.sort(); print(l); l = [2, 1]; l.sort(); print(l); l = [1, 1, 1]; l.sort(); print(l)
l = [[2, 1], [1, 2], [1], []]; l.sort(); print(l)
l = ["é", "z", "a", "Z", "😀", "", "aa", "￿"]; l.sort(); print(l)
l = [b"b", b"a", b"", b"ab"]; l.sort(); print(l)
l = list(range(100)); l.sort(key=lambda x: (x % 7, -x)); print(l[:20])
l = [(i * 7919) % 1000 for i in range(1000)]; l.sort(); print(l == sorted(set(l)) or l[:10], l[:5], l[-5:])
l = [(i * 7919) % 100 for i in range(500)]; s = sorted(enumerate(l), key=lambda p: p[1]); print(all(s[i][1] < s[i + 1][1] or (s[i][1] == s[i + 1][1] and s[i][0] < s[i + 1][0]) for i in range(len(s) - 1)))
s = sorted(enumerate(l), key=lambda p: p[1], reverse=True); print(all(s[i][1] > s[i + 1][1] or (s[i][1] == s[i + 1][1] and s[i][0] < s[i + 1][0]) for i in range(len(s) - 1)))
l = list(range(50)) + list(range(50, 0, -1)) + [25] * 10; l.sort(); print(l[:8], l[-5:], len(l))
t(lambda: [1, "a"].sort())
t(lambda: ["a", 1].sort())
t(lambda: [1, None].sort())
t(lambda: [None, None].sort())
t(lambda: [[1], ["a"]].sort())
t(lambda: [1j, 2j].sort())
t(lambda: [{}, {}].sort())
t(lambda: [3, 1].sort(lambda x: x))
t(lambda: [3, 1].sort(key=1))
t(lambda: [3, 1].sort(cmp=1))
t(lambda: [3, 1].sort(reverse="a"))
t(lambda: [3, 1].sort(reverse=None))
t(lambda: [3, 1].sort(key=lambda: 1))
t(lambda: [3, 1].sort(key=lambda x: 1 / 0))
l = [3, 1, 2]
try:
    l.sort(key=lambda x: 1 / (x - 1))
except ZeroDivisionError:
    print("after failed key", l)
l = [3, "a", 1, 2]
try:
    l.sort()
except TypeError:
    print("after failed sort", sorted(map(str, l)))
l = [3, 1, 2]
def mutating_key(x):
    l.append(x)
    return x
t(lambda: l.sort(key=mutating_key))
l = [3, 1, 2]
def peek(x):
    print(len(l), end=" ")
    return x
l.sort(key=peek); print(l)
class K:
    def __init__(self, v): self.v = v
    def __lt__(self, o):
        log.append((self.v, o.v)); return self.v < o.v
    def __repr__(self): return "K%d" % self.v
log = []
print(sorted([K(3), K(1), K(2)]), log)
log = []
print(sorted([K(1), K(2), K(3), K(4)]), log)
log = []
print(sorted([K(4), K(3), K(2), K(1)]), log)
log = []
print(sorted([K(2), K(1)], reverse=True), log)
class NoLt:
    def __gt__(self, o): return True
print(len(sorted([NoLt(), NoLt()])))
class OnlyEq: pass
t(lambda: sorted([OnlyEq(), OnlyEq()]))
print(sorted([3, 1, 2]), sorted((3, 1, 2)), sorted("cab"), sorted({3: 0, 1: 0}), sorted({2, 1}), sorted(range(3, 0, -1)), sorted([]), sorted([3, 1, 2], reverse=True), sorted(["b", "A"], key=str.upper), sorted(x for x in [2, 1]), sorted([1, 2, 3], key=lambda x: 0), sorted([1, 2, 3], key=lambda x: 0, reverse=True))
t(lambda: sorted())
t(lambda: sorted(1))
t(lambda: sorted([1], None))
t(lambda: sorted([1], key=None, reverse=None))
t(lambda: sorted(iterable=[1]))
print(list.append.__name__, [].append.__name__, [].append.__self__, type([].append).__name__, type(list.append).__name__, list.append.__qualname__, list.sort.__objclass__, sorted(n for n in dir(list) if not n.startswith("_")))
x = []; list.append(x, 1); list.extend(x, [2]); print(x, list.pop(x), list.__len__(x), list.index(x, 1))
t(lambda: list.append(1, 2))
t(lambda: list.append())
t(lambda: list.append((), 1))
t(lambda: [].nope)
def set_attr(): [].x = 1
t(set_attr)
stack = []; [stack.append(i) for i in range(5)]; print([stack.pop() for _ in range(5)], stack)
q = list(range(5)); print([q.pop(0) for _ in range(5)], q)
m = [[0] * 3 for _ in range(2)]; m[0][1] = 5; print(m, [list(r) for r in zip(*m)], [v for r in m for v in r])
