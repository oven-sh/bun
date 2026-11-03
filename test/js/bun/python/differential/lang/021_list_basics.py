def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

l = [1, 2, 3, 4, 5]
print(l, len(l), l[0], l[-1], l[2], l[1:3], l[:2], l[3:], l[:], l[::2], l[::-1], l[1::2], l[-2:], l[:-2], l[4:1:-1], l[10:], l[:10], l[3:1], l[-10:2], l[::-2], l[100:200], l[-1:-4:-1])
t(lambda: l[5])
t(lambda: l[-6])
t(lambda: l["a"])
t(lambda: l[1.0])
t(lambda: l[None])
t(lambda: l[::0])
t(lambda: l[1, 2])
t(lambda: l[1:"a"])
t(lambda: [][0])
print([], [1], [1, 2], [[]], [[], []], [None], [1, "a", 2.5, None, True, [1], (1,), {1: 2}], [1,], list(), list([1, 2]), list((1, 2)), list("abc"), list(range(3)), list({1: 2, 3: 4}), list({5}), list(iter([1])), list(x for x in range(2)), list(b"ab"), list(""), list(zip([1], [2])))
t(lambda: list(1))
t(lambda: list(None))
t(lambda: list(1, 2))
t(lambda: list(a=1))
print([1] + [2], [1, 2] * 2, 2 * [1, 2], [1] * 0, [1] * -1, [] + [], [[]] * 2, [1] + [] + [2], [0] * 5, [1, 2] * True)
t(lambda: [1] + (2,))
t(lambda: [1] + 1)
t(lambda: [1] + "a")
t(lambda: [1] + None)
t(lambda: [1] * "a")
t(lambda: [1] * 1.5)
t(lambda: [1] * [2])
t(lambda: [1] - [1])
t(lambda: -[1])
t(lambda: 1 + [1])
shared = [[0]] * 3
shared[0].append(1)
print(shared, shared[0] is shared[1])
l[0] = 10; print(l)
l[-1] = 50; print(l)
l[1:3] = [20, 30]; print(l)
l[1:3] = [7]; print(l)
l[1:2] = [1, 2, 3]; print(l)
l[1:1] = [0]; print(l)
l[2:4] = []; print(l)
l[::2] = ["a", "b", "c"]; print(l)
l[:] = [1, 2, 3]; print(l)
l[5:] = [9]; print(l)
l[-1:] = [4, 5]; print(l)
l[1:3] = "xy"; print(l)
l[1:3] = (8, 9); print(l)
l[0:0] = range(2); print(l)
l[::-1] = list(range(len(l))); print(l)
l[10:20] = [99]; print(l)
l[3:1] = ["ins"]; print(l)
l[1:4] = l; print(l)
l[:] = l[::-1]; print(l)
def bad(f):
    x = [1, 2, 3]
    try:
        f(x); print(x)
    except Exception as e:
        print(type(e).__name__ + ':', e)
def a1(x): x[3] = 1
def a2(x): x[-4] = 1
def a3(x): x["a"] = 1
def a4(x): x[::2] = [1]
def a5(x): x[::2] = [1, 2, 3]
def a6(x): x[0:1] = 5
def a7(x): x[0:1] = None
def a8(x): x[1.0] = 1
def a9(x): del x[3]
def a10(x): del x["a"]
def a11(x): x[::0] = []
def a12(x): del x[::0]
def a13(x): x[::-1] = [1]
def a14(x): del x[-4]
for f in (a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14): bad(f)
l = list(range(10))
del l[0]; print(l)
del l[-1]; print(l)
del l[1:3]; print(l)
del l[::2]; print(l)
del l[5:]; print(l)
del l[::-1]; print(l)
l = list(range(10))
del l[1::3]; print(l)
del l[-2:]; print(l)
del l[3:1]; print(l)
del l[::-2]; print(l)
del l[:]; print(l)
print(1 in [1, 2], 3 in [1, 2], [1] in [[1]], None in [None], "a" in ["a"], 1.0 in [1], 1 not in [], [] in [[]], (1,) in [(1,)])
print([1, 2] == [1, 2], [1, 2] == [2, 1], [1] != [1], [1, 2] < [1, 3], [1, 2] < [1, 2, 0], [2] > [1, 9], [] < [0], [1] <= [1], [1] >= [2], [1, [2, 3]] == [1, [2, 3]], [1] == (1,), [1] == [1.0], [True] == [1], ["a"] < ["b"], [1, "a"] == [1, "a"], [] == [], [[]] == [[]])
t(lambda: [1] < [None])
t(lambda: [1] < ["a"])
t(lambda: [1] < 1)
t(lambda: [1] < (1,))
t(lambda: [1, 2] > [1, "a"])
print([1, "a"] < [2, 1], [1, None] == [1, 0], [1, "x"] != [2, None])
t(lambda: hash([]))
t(lambda: {[]: 1})
t(lambda: {[1]})
a = [1, 2]; b = a; c = a[:]; b.append(3)
print(a, b, c, a is b, a is c, a == c)
n = [[1, 2], [3, 4]]; s = n[:]; s[0].append(9); s.append(5)
print(n, s)
r = [1]; r.append(r); print(r, r[1] is r, r[1][1][1][0], len(r))
r2 = [[]]; r2[0].append(r2); print(r2)
d = {}; rl = [d]; d["l"] = rl; print(rl)
a, b = [1, 2], [3]
a += b; print(a)
a += (4,); print(a)
a += "xy"; print(a)
a += range(2); print(a)
a *= 2; print(a)
a *= 0; print(a)
z = y = [1]; y += [2]; print(z, y is z)
z = y = [1]; y = y + [2]; print(z, y is z)
def iadd_bad():
    x = [1]; x += 1
t(iadd_bad)
def iadd_none():
    x = [1]; x += None
t(iadd_none)
def imul_bad():
    x = [1]; x *= "a"
t(imul_bad)
print(len([]), len([[]]), len([1] * 1000), bool([]), bool([[]]), bool([0]), str([]), repr([1, "a", None]), str(["a'b", 'c"d', "\n"]), [1.0, 1e100, -0.0, 1j], [b"a", bytearray(b"b")], [int, len, None, ...] [0:1], [[[[[]]]]])
print(sum([1, 2, 3]), max([1, 3, 2]), min([1, 3, 2]), sorted([3, 1, 2]), list(reversed([1, 2, 3])), any([0, 1]), all([0, 1]), any([]), all([]), list(enumerate(["a", "b"])), list(zip([1, 2], "ab")), list(map(str, [1, 2])), list(filter(None, [0, 1, "", "a"])), sum([[1], [2]], []))
print([1, 2, 3].__len__(), [1, 2, 3].__getitem__(1), [1, 2, 3].__getitem__(slice(1, None)), [1, 2].__contains__(1), [1].__add__([2]), [1].__mul__(2), [1].__rmul__(2), [1].__eq__([1]), [1].__eq__(1), [1].__lt__([2]), [1].__ne__([1]), [1].__repr__(), [1].__add__((2,)) if False else "", list.__hash__, [1].__iadd__([2]), [1].__imul__(2), [3, 4].__reversed__().__next__(), [].__sizeof__() > 0)
print(type([]), list.__mro__, isinstance([], list), type([1][0:1]), type([] + []), type([] * 2), list.__name__, type(iter([])).__name__, type(reversed([])).__name__)
big = list(range(100000))
print(len(big), big[99999], big[-1], sum(big), big[50000:50003], len(big[::3]), big.index(77777), big.count(5), 99999 in big, -1 in big, big == list(range(100000)), len(big * 3), (big + big)[150000])
