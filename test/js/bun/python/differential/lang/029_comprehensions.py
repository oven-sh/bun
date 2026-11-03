def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print([x for x in range(5)], [x * 2 for x in range(5)], [x for x in range(10) if x % 2], [x for x in range(20) if x % 2 if x % 3], [x if x % 2 else -x for x in range(5)], [(x, y) for x in range(2) for y in range(2)], [(x, y) for x in range(3) for y in range(x)], [x + y for x in "ab" for y in "cd"], [[y for y in range(x)] for x in range(3)], [x for x in []], [x for x in "abc"], [1 for _ in range(3)], [x for x, in [(1,), (2,)]], [a + b for a, b in [(1, 2), (3, 4)]], [a for a, *b in [(1, 2, 3)]], [b for a, *b in [(1, 2, 3)]], [(a, c) for a, (b, c) in [(1, (2, 3))]])
print({x for x in range(5)}, {x % 3 for x in range(10)}, {x for x in [1, 1, 2]}, {x: x * x for x in range(4)}, {x: y for x, y in [("a", 1), ("b", 2)]}, {x: y for x in "ab" for y in range(2)}, {v: k for k, v in {"a": 1}.items()}, {x: [y for y in range(x)] for x in range(3)}, {x for x in ()}, {x: 1 for x in ()}, {(x, y) for x in range(2) for y in range(2)} == {(0, 0), (0, 1), (1, 0), (1, 1)}, {x: x for x in range(5) if x % 2}, type({x for x in ()}), type({x: 1 for x in ()}))
g = (x * 2 for x in range(3)); print(type(g).__name__, next(g), list(g), list(g), sum(x for x in range(5)), max(x for x in [1, 3, 2]), list(x for x in "ab"), tuple(x for x in range(2)), "".join(c for c in "abc" if c != "b"), any(x > 3 for x in range(5)), all(x > 3 for x in range(5)), sorted(x for x in [3, 1]), dict((x, 1) for x in "a"), sum((x for x in range(3)), 10), list((x, y) for x in range(2) for y in "a"))
# The variable does not leak, nor does it disturb one of the same name outside.
x = "outer"; r = [x for x in range(3)]; print(x, r)
y = "outer"; r = {y for y in range(3)}; print(y); r = {y: 1 for y in range(3)}; print(y); r = list(y for y in range(3)); print(y)
t(lambda: [zz for zz in range(3)] and zz)
def f():
    v = "local"; l = [v for v in range(2)]; return v, l
print(f())
# The first iterable is evaluated outside, at once; the rest inside.
x = [1, 2, 3]; print([x for x in x], [x for x in x if x > 1], [[x for x in range(x)] for x in x], [y for y in x for x in [y]])
n = 5; ge = (n for _ in range(2)); n = 6; print(list(ge))
src = [1, 2]; ge = (v for v in src); src = [9]; print(list(ge))
src = [1, 2]; ge = (v for v in src); src.append(3); print(list(ge))
t(lambda: (v for v in 5))
t(lambda: [v for v in 5])
t(lambda: type((v for v in [1] for w in 5)).__name__)
t(lambda: list(v for v in [1] for w in 5))
t(lambda: [v for v in None])
t(lambda: {v: 1 for v in 1})
t(lambda: [v for v in [1] if undefined_name])
t(lambda: [1 / v for v in [1, 0]])
t(lambda: {[]: v for v in [1]})
t(lambda: {[] for v in [1]})
t(lambda: [a for a, b in [1]])
t(lambda: [a for a, b in [(1, 2, 3)]])
# Closures in comprehensions.
fs = [lambda: i for i in range(3)]; print([f() for f in fs]); fs = [lambda i=i: i for i in range(3)]; print([f() for f in fs]); fs = [(lambda j: lambda: j)(i) for i in range(3)]; print([f() for f in fs]); fs = list(lambda: i for i in range(3)); print([f() for f in fs]); fs = {i: (lambda: i) for i in range(2)}; print([f() for f in fs.values()])
def outer(a):
    return [a + i for i in range(3)], [[a + i + j for j in range(2)] for i in range(2)], {a: i for i in range(2)}, list(a * i for i in range(3)), [(lambda: a + i)() for i in range(2)]
print(outer(10))
# In a class body only the first iterable sees the class scope.
class C:
    n = 3; a = [i for i in range(n)]
    try:
        b = [n for i in range(2)]
    except NameError as e:
        b = "NameError: " + str(e)
    try:
        c = [i for i in range(2) if n]
    except NameError as e:
        c = "NameError: " + str(e)
    d = [i for i in range(n) for j in range(1)]
    e = (lambda n=n: [n for i in range(2)])()
print(C.a, C.b, C.c, C.d, C.e)
# The walrus binds in the enclosing scope.
print([w := i for i in range(3)], w, [(q := i * 2) + 1 for i in range(3)], q, [last for i in range(5) if (last := i) % 2], last, any((hit := v) > 2 for v in [1, 2, 3, 4]), hit, {(s := i) for i in range(2)}, s, {i: (u := i) for i in range(2)}, u)
def wf():
    total = 0; r = [total := total + v for v in [1, 2, 3]]; return r, total
print(wf())
def wn():
    r = [[(inner := i * j) for j in range(2)] for i in range(3)]; return r, inner
print(wn())
for src in ("[i := 0 for i in range(3)]", "[(i := 0) for i in range(3)]", "[[(j := 0) for i in range(2)] for j in range(2)]", "[i for i in (i := range(3))]", "[i for i in range(3) if (i := 1)]", "class K:\n [(a := 1) for _ in range(1)]", "[x for x in y := [1]]", "{a := 1: 2 for _ in [1]}", "[*x for x in [[1]]]" if False else "[x for x in *[1]]", "[x for]", "[for x in y]", "[x for x in]", "[x, y for x in z]", "{x: y, for x in z}", "{x, y for x in z}", "(x, y for x in z)", "f(x for x in y, 1)", "f(1, x for x in y)", "[x for x in y if]", "{**x for x in y}" if False else "[x async for x in y]", "[yield for x in y]" , "[(yield x) for x in y]", "[x for x in (yield)]", "{x:y for x in z for}", "[x for x in 1, 2]", "[x for x in lambda: 1, 2]"):
    try:
        compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
print([x for x in (1, 2)], [x for x in [1, 2] if x if x], [x for x in range(3) if x or True], [x for x in range(3) if (lambda: x)()], [(lambda: [y for y in range(x)])() for x in range(3)], [x for x in range(2) for x in range(3)], [x for y in range(2) for x in range(y + 1)], [[x, y] for x in range(2) if x for y in range(2) if y], [x for x in range(30) if x % 2 == 0 if x % 3 == 0 if x % 5 == 0])
print(sum([i * j for i in range(50) for j in range(50)]), len({(i, j) for i in range(30) for j in range(30)}), len({i: j for i in range(100) for j in range(3)}), sum(1 for _ in range(1000)), [[[k for k in range(2)] for j in range(2)] for i in range(2)], [i for i in range(3)][::-1], [i for i in range(3)][1], len([i for i in range(3)]), [*[i for i in range(2)], *(i for i in range(2))], [i for i in [j for j in range(3)]], {**{i: i for i in range(2)}}, (lambda *a: a)(*[i for i in range(2)]), [i for i in range(3)] + [i for i in range(2)])
# Unpacking in comprehensions, new in 3.15.
print([*x for x in [[1, 2], [3]]], {*x for x in [[1, 2], [2]]}, {**d for d in [{"a": 1}, {"b": 2}, {"a": 3}]}, list(*x for x in ["ab", "c"]), [*x for x in [(), (1,)] if x], [*range(i) for i in range(4)], [*x for y in [[[1], [2]], [[3]]] for x in y])
t(lambda: [*x for x in [1]])
t(lambda: {**x for x in [[1]]})
m = [[1, 2, 3], [4, 5, 6]]; print([[r[i] for r in m] for i in range(3)], [v for r in m for v in r], [sum(r) for r in m], {i: r for i, r in enumerate(m)}, [max(c) for c in zip(*m)], [[v * 2 for v in r] for r in m], [v for r in m if sum(r) > 6 for v in r if v % 2])
print([locals() for _ in [1]][0].keys() >= {"_"}, sorted(k for k in [locals() for inner in [1]][0] if k in ("inner", "m")), [globals() is g2 for g2 in [globals()]])
def lf():
    a = 1; return sorted([locals() for b in [2]][0])
print(lf())
