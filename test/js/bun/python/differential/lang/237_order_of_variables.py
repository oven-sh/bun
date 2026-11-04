# The order of a function's variables, which co_varnames, locals(), f_locals and vars() show, is the order in which the
# compiler comes to them: a value before the targets it is assigned to, and so on.
import sys


def a1():
    x = (y := 1)
    return list(locals())
def a2():
    for x in (y := [1]): z = x
    return list(locals())
def a3():
    try:
        x = 1
    except Exception as y:
        z = 2
    else:
        w = 3
    finally:
        v = 4
    return list(locals())
def a4():
    x = [i for i in range(2)]
    y = 2
    return list(locals())
def a5():
    def x(a=(y := 1)): pass
    return list(locals())
def a6():
    x: int
    return list(locals())
def a8():
    l = [0]; l[(y := 0)] = (z := 1)
    return list(locals())
def a9():
    x = (y := 1) if (z := 2) else (w := 3)
    return list(sys._getframe().f_locals)
def b1(p, q=1, *r, s, **t):
    b = a = p
    return list(locals())
def b2():
    a, b = (c := 1), (d := 2)
    (e, f), g = (1, 2), 3
    return list(locals())
def b3():
    with open(__file__) as f, open(__file__) as g:
        h = 1
    return list(locals())
def b4():
    import os.path as p, sys as s
    from os import sep as q
    return list(locals())
def b5():
    @(d := lambda f: f)
    class C((b := object)): pass
    return list(locals())
def b6():
    x += (y := 1)
def b7():
    del x
    y = 1
def b8():
    x: int = (y := 1)
    z: int
    w: int
    w = 2
    return list(locals())
def b9():
    a = [i + j for i in range(1) for j in range(1)]
    b = {k: v for k, v in ()}
    i = 5
    c = [i for i in range(2)]
    return list(locals())
def c1(v):
    match v:
        case [a, b]: c = 1
        case {'k': d, **e}: f = 2
        case str() as g: pass
    return list(locals())
def c2():
    while (a := 0): b = 1
    else: c = 2
    if (d := 1): e = 1
    return list(locals())
def c3():
    x = lambda: (y, z)
    z = 1
    y = 2
    w = 3
    return list(locals())
def c4():
    yield (a := 1)
    b = yield
    c = yield from (d := ())
    return list(locals())
async def c5():
    async with (a := None) as b: pass
    async for c in (d := None): e = 1
    f = await (g := None)
def c6():
    try:
        pass
    except* ValueError as a:
        b = 1
    c = 1
    return list(locals())
def c7():
    if 0:
        dead = 1
    return 1
    after = 2
def c8():
    global G
    nonlocal_free = 1
    G = (a := 1)
    print(b := 2, end='')
    return list(locals())

for f in (a1, a2, a3, a4, a5, a6, a8, a9, b2, b3, b4, b5, b8, b9, c2, c3, c6, c8):
    print(f.__name__, f(), f.__code__.co_varnames, f.__code__.co_nlocals, f.__code__.co_cellvars)
print('b1', b1(1, s=2), b1.__code__.co_varnames)
print('c1', c1([1, 2]), c1({'k': 1}), c1('s'), c1.__code__.co_varnames)
for f in (b6, b7, c4, c5, c7):
    print(f.__name__, f.__code__.co_varnames, f.__code__.co_nlocals)

# Many of them, and many names and constants: each is listed once, in order.
count = 3000
source = 'def many(%s):\n' % ', '.join('p%d' % i for i in range(200))
source += ''.join('    v%d = g%d + %d + %d.5 + "s%d"\n' % (i, i % 1000, i, i, i % 700) for i in range(count))
source += '    return {%s}\n' % ', '.join('"k%d": v%d' % (i, count - 1 - i) for i in range(count))
namespace = {}
exec(source, namespace)
code = namespace['many'].__code__
print(code.co_varnames == tuple('p%d' % i for i in range(200)) + tuple('v%d' % i for i in range(count)), code.co_names == tuple('g%d' % i for i in range(1000)), len(code.co_consts), len(set(map(repr, code.co_consts))))
