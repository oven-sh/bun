def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)
def x(src):
    env = {}
    try:
        exec(src, env)
        print({k: v for k, v in env.items() if k != "__builtins__"})
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
    except Exception as e:
        print(type(e).__name__ + ':', e)

a, b = 1, 2; print(a, b)
a, b = b, a; print(a, b)
a, b, c = [1, 2, 3]; print(a, b, c)
a, b = "xy"; print(a, b)
a, b = {"k": 1, "j": 2}; print(a, b)
a, b = range(2); print(a, b)
a, b = (i for i in range(2)); print(a, b)
a, b = {1: 2, 3: 4}.items(); print(a, b)
(a, b), c = (1, 2), 3; print(a, b, c)
a, (b, (c, d)) = 1, (2, (3, 4)); print(a, b, c, d)
[a, b] = 1, 2; print(a, b)
[a, [b, c]] = [1, [2, 3]]; print(a, b, c)
(a, b) = [1, 2]; print(a, b)
a, = [1]; print(a)
[a] = (2,); print(a)
(a,) = "z"; print(a)
a, b = b"xy"; print(a, b)
*a, = [1, 2]; print(a)
*a, = (); print(a)
a, *b = [1, 2, 3]; print(a, b)
*a, b = [1, 2, 3]; print(a, b)
a, *b, c = [1, 2, 3, 4]; print(a, b, c)
a, *b, c = [1, 2]; print(a, b, c)
a, *b = [1]; print(a, b)
a, *b = "hello"; print(a, b)
a, *b = (1, 2, 3); print(a, b, type(b))
a, *b = range(4); print(a, b)
a, *b = iter([1, 2]); print(a, b)
a, b, *c, d, e = range(10); print(a, b, c, d, e)
a, (b, *c), *d = 1, (2, 3, 4), 5, 6; print(a, b, c, d)
[a, *b] = 1, 2; print(a, b)
(a, *b), c = [1, 2, 3], 4; print(a, b, c)
*a, (b, c) = 1, 2, (3, 4); print(a, b, c)
a = b, c = 1, 2; print(a, b, c)
a, b = c = [1, 2]; print(a, b, c)
a = b = c = 5; print(a, b, c)
a, b = b, a = 1, 2; print(a, b)
l = [0, 0]; l[0], l[1] = 1, 2; print(l)
l = [0, 1]; i = 0; i, l[i] = 1, 9; print(i, l)
l = [0, 1]; i = 0; l[i], i = 9, 1; print(i, l)
class O: pass
o = O(); o.x, o.y = 1, 2; print(o.x, o.y)
d = {}; d["a"], d["b"] = 1, 2; print(d)
d = {}; d["a"], *d["b"] = 1, 2, 3; print(d)
l = [1, 2, 3]; l[0], l[2] = l[2], l[0]; print(l)
l = [1, 2, 3, 4]; l[:2], l[2:] = l[2:], l[:2]; print(l)
a, b, c = 1, 2, 3; a, b, c = c, a, b; print(a, b, c)
for src in ("a, b = 1", "a, b = None", "a, b = 1,", "a, b = 1, 2, 3", "a, b = []", "a, b = [1]", "a, b = 'abc'", "a, b = 'a'", "a, b = {}", "a, b = {1: 2, 3: 4, 5: 6}", "a, b = (1, 2, 3)", "a, b = range(3)", "a, b = iter([1, 2, 3])", "a, b = (i for i in range(3))", "a, b = {1, 2, 3}", "a, = []", "a, = [1, 2]", "a, *b = []", "a, *b, c = [1]", "a, b, *c = [1]", "*a, b, c = [1]", "a, *b = 1", "a, (b, c) = 1, 2", "a, (b, c) = 1, (2,)", "a, (b, c) = 1, (2, 3, 4)", "(a, b), c = 1, 2", "a, b = 1.5", "a, b = len", "a, b = object()", "a, b = int", "[a, b] = 5", "a, b, c, d = 'ab'", "a, b = b'abc'", "for a, b in [1]: pass", "for a, b in [(1, 2, 3)]: pass", "for a, b in [(1,)]: pass", "[0 for a, b in [1]]", "a, b = lambda: 1"):
    x(src)
for src in ("*a = [1]", "*a, *b = [1]", "a, *b, *c = [1]", "*a", "print(*a = 1)" if False else "*a = 1,", "(*a) = [1]", "a = *b", "a = (*b)", "a = *b,", "*a, = 1", "1, a = 1, 2", "a, 1 = 1, 2", "a + b, c = 1, 2", "f(), a = 1, 2", "(a, b) += 1, 2", "a, b += 1, 2", "[a, b] += [1]", "*a += [1]", "a, None = 1, 2", "a, True = 1, 2", "a, ... = 1, 2", "a, 'x' = 1, 2", "a, (b, 1) = 1, (2, 3)", "a, -b = 1, 2", "a, b.c() = 1, 2", "a, b: int = 1, 2", "(a, b): int = 1, 2", "[a, b]: int = 1, 2", "() = 1", "[] = 1", "() = ()", "[] = []", "() = [1]", "[] = (1,)", "a, () = 1, ()", "for *a in [[1]]: pass", "for *a, in [[1]]: pass", "for a, *b in [[1, 2]]: pass", "del *a", "del (*a,)" , "x = [1]\ndel x, *x" , "a, b = yield" , "a = yield", "(a := 1, b) = 1, 2", "a, b := 1, 2", "a, __debug__ = 1, 2", "{a, b} = 1, 2", "{a: b} = 1", "a if b else c = 1", "a and b = 1", "not a = 1", "a < b = 1", "lambda: 1 = 1", "[a for a in b] = 1", "f'{a}' = 1", "a.b, c[d], e = 1, 2, 3"):
    x(src)
print([*[1, 2]], [*[1], *[2]], [0, *[1, 2], 3], [*"ab"], [*range(3)], [*{1: 2}], [*()], [*[], *[]], (*[1, 2],), (*[1], 2), (0, *[1]), {*[1, 2]}, {*[1], *[1, 2]}, {*"a"}, [*(i for i in range(2))], [*[*[1]]], [*[[1]]], *[1], (*"ab", *"cd"), [*{3}], [*b"a"], [*{"a": 1}.items()])
print({**{"a": 1}}, {**{"a": 1}, **{"b": 2}}, {"x": 0, **{"a": 1}}, {**{"a": 1}, "a": 2}, {"a": 2, **{"a": 1}}, {**{}}, {**{1: 2}}, {**{"a": 1}, **{"a": 2}, **{"a": 3}}, {**dict(a=1)}, {**{"a": {**{"b": 1}}}})
t(lambda: [*1])
t(lambda: [*None])
t(lambda: (*1,))
t(lambda: {*1})
t(lambda: {*[[]]})
t(lambda: {**1})
t(lambda: {**[1]})
t(lambda: {**{"a": 1}, **None})
t(lambda: [*[1], *2])
t(lambda: print(*1))
t(lambda: print(**1))
t(lambda: print(*None))
t(lambda: print(**[1]))
t(lambda: print(**{1: 2}))
def r(): return 1, *[2, 3]
def r2(): return *[1], *[2]
def g(): yield 1, *[2]
def g2(): yield *[1, 2],
print(r(), r2(), list(g()), list(g2()))
for v in 1, *[2, 3]: print(v, end=" ")
for v in *[1], *[2]: print(v, end=" ")
print()
z = *[1, 2], 3; print(z); z = 0, *"ab"; print(z); z = *[], ; print(z); z = [*z, 1]; print(z)
# Evaluation order: the right side first, then the targets left to right.
log = []
class L:
    def __init__(s, n): s.n = n
    def __setitem__(s, k, v): log.append(("set", s.n, k, v))
def ev(n, v=None):
    log.append(("ev", n)); return v if v is not None else L(n)
ev("a")[ev("i", 1)], ev("b")[ev("j", 2)] = ev("x", 10), ev("y", 20)
print(log)
class It:
    def __init__(s, n): s.n = n; s.i = 0
    def __iter__(s): return s
    def __next__(s):
        s.i += 1; print("next", s.i, end="; ")
        if s.i > s.n: raise StopIteration
        return s.i
a, b = It(2); print(a, b)
try:
    a, b = It(5)
except ValueError as e: print(e)
try:
    a, b, c = It(1)
except ValueError as e: print(e)
a, *b = It(3); print(a, b)
*a, b = It(3); print(a, b)
class Seq:
    def __getitem__(s, i):
        if i > 1: raise IndexError
        return i * 10
a, b = Seq(); print(a, b); a, *b = Seq(); print(a, b); print([*Seq()], (*Seq(),), {*Seq()})
class BadIter:
    def __iter__(s): return 5
class RaisingIter:
    def __iter__(s): raise RuntimeError("iter failed")
class RaisingNext:
    def __iter__(s): return s
    def __next__(s): raise RuntimeError("next failed")
def u(o):
    a, b = o
t(lambda: u(BadIter())); t(lambda: u(RaisingIter())); t(lambda: u(RaisingNext())); t(lambda: [*BadIter()]); t(lambda: [*RaisingNext()])
a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p = range(16); print(a, p, a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p)
first, *middle, last = range(1000); print(first, len(middle), last)
