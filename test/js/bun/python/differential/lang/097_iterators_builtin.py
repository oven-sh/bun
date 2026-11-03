def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

# iter() and next()
it = iter([1, 2, 3]); print(type(it).__name__, iter(it) is it, next(it), next(it), next(it), next(it, "d"), next(it, None)); t(lambda: next(it))
for obj in ([], (), "", b"", bytearray(), {}, set(), frozenset(), range(0), {}.keys(), {}.values(), {}.items(), iter([]), reversed([]), reversed(()), reversed(range(0)), reversed({}), reversed(""), enumerate([]), zip(), map(str, []), filter(None, []), (x for x in ()), iter(int, 0), range(10 ** 30), reversed({}.items()), reversed({}.keys()), reversed({}.values()), frozendict()):
    i = iter(obj); print(type(i).__name__, iter(i) is i, next(i, "empty"), end=" | ")
print()
# iter(callable, sentinel)
n = [0]
def counter(): n[0] += 1; return n[0]
ci = iter(counter, 4); print(type(ci).__name__, list(ci), list(ci), next(ci, "done"), n)
print(list(iter(lambda: 1, 1)), list(iter([3, 2, 1].pop, 2)) if False else "", next(iter(int, 1)), next(iter(list, None)))
src = [1, 2, None, 3]; print(list(iter(lambda: src.pop(0), None)), src)
def raises_stop(): raise StopIteration("from callable")
def raises_other(): raise KeyError("k")
print(list(iter(raises_stop, 1))); t(lambda: list(iter(raises_other, 1))); t(lambda: iter(5, 1)); t(lambda: iter([1], 1)); t(lambda: iter(None, None)); t(lambda: iter("abc", "b"))
class EqAll:
    def __eq__(s, o): return True
print(list(iter(lambda: 5, EqAll())))
nan = float("nan"); print(next(iter(lambda: nan, nan), "identity counts as equal"))
# List iterators see mutations.
l = [1, 2, 3]; out = []
for x in l:
    out.append(x)
    if x == 2: l.append(4)
print(out, l)
l = [1, 2, 3, 4]; out = []
for x in l:
    out.append(x); l.remove(x)
print(out, l)
l = [1, 2, 3]; i = iter(l); next(i); l.clear(); print(next(i, "gone")); l.extend([7, 8, 9]); print(next(i, "stays exhausted"))
l = [1, 2, 3]; i = iter(l); next(i); l.insert(0, 0); print(list(i))
l = [1]; i = iter(l); print(next(i)); l.append(2); print(next(i)); print(next(i, "end")); l.append(3); print(next(i, "end"))
def dm():
    d = {1: 1}
    for k in d: d[k + 1] = 1
def dm2():
    d = {1: 1, 2: 2}
    for k in d: del d[k]
def dm3():
    d = {1: 1, 2: 2}
    for k in d: d[k] = "same size is fine"
    return d
def dm4():
    d = {1: 1, 2: 2}
    for k in d.values(): d[3] = 1
def dm5():
    d = {1: 1, 2: 2}
    for k in d.items(): d.clear()
def dm6():
    d = {1: 1, 2: 2}
    for k in d: d.pop(k); d[k + 10] = 1
def sm():
    s = {1}
    for k in s: s.add(k + 1)
def sm2():
    s = {1, 2}
    for k in s: s.discard(k)
for f in (dm, dm2, dm3, dm4, dm5, dm6, sm, sm2): t(f)
d = {1: 1}; i = iter(d); d[2] = 2; t(lambda: next(i)); t(lambda: next(i))
d = {1: 1}; i = iter(d); next(i); d[2] = 2; t(lambda: next(i))
# __length_hint__, __reduce__, __setstate__ on a few.
i = iter([1, 2, 3]); print(i.__length_hint__(), next(i), i.__length_hint__(), list(i), i.__length_hint__())
print(iter((1, 2)).__length_hint__(), iter("abc").__length_hint__(), iter(range(5)).__length_hint__(), iter({1: 2}).__length_hint__(), iter({1, 2}).__length_hint__(), reversed([1, 2]).__length_hint__(), iter(b"ab").__length_hint__(), iter({1: 2}.items()).__length_hint__(), reversed(range(4)).__length_hint__())
i = iter([1, 2, 3, 4]); i.__setstate__(2); print(list(i)); i = iter([1, 2]); i.__setstate__(-5); print(list(i)); i = iter([1, 2]); i.__setstate__(50); print(list(i)); i = iter(range(10)); i.__setstate__(7); print(list(i)); i = iter("abcd"); i.__setstate__(1); print(list(i)); i = iter((1, 2, 3)); i.__setstate__(1); print(list(i))
# enumerate
e = enumerate("abc"); print(type(e).__name__, iter(e) is e, next(e), list(e), list(enumerate("ab", 5)), list(enumerate("ab", start=-1)), list(enumerate([])), list(enumerate("a", 2 ** 70)), list(enumerate(iterable="ab")), list(enumerate("ab", True)), dict(enumerate("ab")), [i * v for i, v in enumerate([5, 6])], list(enumerate(enumerate("a"))))
t(lambda: enumerate()); t(lambda: enumerate(1)); t(lambda: enumerate("a", "b")); t(lambda: enumerate("a", 1.5)); t(lambda: enumerate("a", 1, 2)); t(lambda: enumerate("a", nope=1)); t(lambda: enumerate(start=1)); t(lambda: len(enumerate("a"))); t(lambda: enumerate("a")[0]); print(enumerate[int])
big = enumerate("ab", 2 ** 63 - 1); print(list(big))
# zip
z = zip("ab", [1, 2]); print(type(z).__name__, iter(z) is z, next(z), list(z), list(zip()), list(zip("abc")), list(zip("abc", "de")), list(zip("ab", "cd", "ef")), list(zip([], "ab")), list(zip(*[(1, 2), (3, 4)])), list(zip(*zip("ab", "cd"))), dict(zip("ab", range(2))), list(zip(range(3), range(10 ** 10))), list(zip("ab", strict=True)), list(zip(strict=True)), list(zip("ab", "cd", strict=True)), list(zip("ab", "cd", strict=False)), list(zip("ab", "c", strict=0)))
t(lambda: list(zip("ab", "c", strict=True))); t(lambda: list(zip("a", "bc", strict=True))); t(lambda: list(zip("ab", "cd", "e", strict=True))); t(lambda: list(zip("ab", "c", "de", strict=True))); t(lambda: list(zip("a", "bc", "de", strict=True))); t(lambda: list(zip("ab", "cd", "efg", strict=True))); t(lambda: list(zip("", "a", strict=True))); t(lambda: list(zip("a", "", strict=True))); t(lambda: zip(1)); t(lambda: zip("a", 1)); t(lambda: zip("a", None, "b")); t(lambda: zip("a", nope=1)); t(lambda: len(zip())); t(lambda: zip("a", strict="yes") and "truthy strict accepted")
a = iter([1, 2, 3]); b = iter([1]); print(list(zip(a, b)), next(a)); a = iter([1, 2, 3]); b = iter([1]); print(list(zip(b, a)), next(a))
i = iter(range(6)); print(list(zip(i, i)), list(zip(*[iter(range(7))] * 3)))
# map
m = map(str, [1, 2]); print(type(m).__name__, iter(m) is m, next(m), list(m), list(map(lambda a, b: a + b, [1, 2], [10, 20, 30])), list(map(pow, [2, 3], [2, 2])), list(map(len, ["a", "bb"])), list(map(str.upper, "ab")), list(map(lambda: 1, [])) , list(map(int, "12")), list(map(None, [])) , list(map(lambda *a: a, "ab", "cd", "ef")), list(map(lambda x: x, map(lambda x: x + 1, [1]))), sum(map(abs, [-1, -2])), list(map(lambda a, b: (a, b), "ab", "cd", strict=True)))
t(lambda: map()); t(lambda: map(str)); t(lambda: map(str, 1)); t(lambda: list(map(None, [1]))); t(lambda: list(map(5, [1]))); t(lambda: list(map(lambda: 1, [1]))); t(lambda: list(map(lambda a, b: 1, [1]))); t(lambda: list(map(int, ["x"]))); t(lambda: map(str, [1], nope=1)); t(lambda: list(map(lambda a, b: 1, "ab", "c", strict=True))); t(lambda: list(map(lambda a, b: 1, "a", "bc", strict=True))); t(lambda: len(map(str, [])))
calls = []; m = map(calls.append, [1, 2]); print(calls); next(m); print(calls)
# filter
f = filter(None, [0, 1, "", "a", None, [], [0]]); print(type(f).__name__, iter(f) is f, list(f), list(filter(lambda x: x % 2, range(6))), list(filter(str.isdigit, "a1b2")), list(filter(None, [])), list(filter(bool, [0, 1])), list(filter(lambda x: None, [1])), list(filter(lambda x: "truthy", [0])), "".join(filter(str.isalpha, "a1b")), list(filter(None, "ab")), list(filter(callable, [len, 1])))
t(lambda: filter()); t(lambda: filter(None)); t(lambda: filter(None, 1)); t(lambda: list(filter(5, [1]))); t(lambda: filter(None, [], 1)); t(lambda: list(filter(lambda: 1, [1]))); t(lambda: filter(function=None, iterable=[])); t(lambda: len(filter(None, [])))
class NoBool:
    def __bool__(s): raise ValueError("no bool")
t(lambda: list(filter(None, [NoBool()]))); t(lambda: list(filter(lambda x: NoBool(), [1])))
# reversed
r = reversed([1, 2, 3]); print(type(r).__name__, iter(r) is r, next(r), list(r), list(reversed("abc")), list(reversed((1, 2))), list(reversed(range(5))), list(reversed(range(0, 10, 3))), list(reversed(range(10, 0, -3))), list(reversed({1: 2, 3: 4})), list(reversed(b"ab")), list(reversed(bytearray(b"ab"))), list(reversed([])), list(reversed(list(reversed([1, 2])))), "".join(reversed("héllo😀")), list(reversed({1: 2, 3: 4}.values())), type(reversed("")).__name__, type(reversed(())).__name__, type(reversed(range(1))).__name__, type(reversed({})).__name__)
# range iterators with huge values.
print(list(range(2 ** 64, 2 ** 64 + 3)), list(range(2 ** 64 + 2, 2 ** 64, -1)), list(reversed(range(2 ** 64, 2 ** 64 + 2))), next(iter(range(-(2 ** 70), 0))), type(iter(range(2 ** 64, 2 ** 65))).__name__, list(range(0, 2 ** 65, 2 ** 64)))
# str/bytes iterators.
print(list("a😀é"), [ord(c) for c in "a😀"], list(b"\x00\xff"), list(iter("")), [c for c in "ab" for _ in "xy"], list(bytearray(b"ab")))
# for loop target forms.
for a, b in [(1, 2), (3, 4)]: print(a, b, end="; ")
for a, (b, c) in [(1, (2, 3))]: print(a, b, c, end="; ")
for a, *b in [(1, 2, 3), (4,)]: print(a, b, end="; ")
for [a, b] in [[1, 2]]: print(a, b, end="; ")
class O: pass
o = O(); lst = [0, 0]; dd = {}
for o.x in range(3): pass
for lst[1] in range(3): pass
for dd["k"] in "ab": pass
for (a) in [1]: pass
for a, in [(1,)]: pass
print(o.x, lst, dd, a)
for i in range(3): i = 10
print(i)
for i in []: pass
else: print("else on empty", i)
def unpack_err():
    for a, b in [(1, 2, 3)]: pass
def unpack_err2():
    for a, b in [1]: pass
def unpack_err3():
    for a, b in [(1,)]: pass
t(unpack_err); t(unpack_err2); t(unpack_err3)
# Exhausted iterators stay exhausted.
for mk in (lambda: iter([1]), lambda: iter((1,)), lambda: iter("a"), lambda: iter({1}), lambda: iter({1: 1}), lambda: iter(range(1)), lambda: enumerate("a"), lambda: zip("a"), lambda: map(str, "a"), lambda: filter(None, "a"), lambda: reversed([1]), lambda: (x for x in "a")):
    i = mk(); next(i); print(next(i, "x"), next(i, "y"), end=" ")
print()
