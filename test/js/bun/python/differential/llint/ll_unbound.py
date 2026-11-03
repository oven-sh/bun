# Every way a local can be without a value where it is read.
out = []
def rec(f, *a):
    try:
        r = repr(f(*a))
    except BaseException as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s%r -> %s" % (f.__name__, a, r))

def if1(c):
    if c: x = 1
    return x
def if2(c):
    if c: x = 1
    else: y = 2
    return x
def if3(c):
    if c: x = 1
    else: x = 2
    return x
def if4(c, d):
    if c:
        if d: x = 1
    elif d: x = 2
    else: pass
    return x
def tern(c):
    y = (x := 1) if c else 2
    return x, y
def andor(c, d):
    r = c and (x := d) or 0
    return x
def andor2(c):
    if c and (x := 5) > 3: return x
    return x
def andor3(c):
    if c or (x := 5): return x
    return x
def while1(n):
    while n:
        x = n
        n -= 1
    return x
def while2(n):
    while n:
        n -= 1
        if n == 1: continue
        x = n
    else:
        y = 1
    return x, y
def while3(n):
    while True:
        if n: break
        x = 1
        n = 1
    return x
def while4(n):
    i = 0
    while i < n:
        if i: r = x
        x = i
        i += 1
    return r
def while5(n):
    while n:
        n -= 1
        if n: 
            y = x
        else:
            x = 1
    return x
def for1(s):
    for x in s: pass
    return x
def for2(s):
    for x in s:
        y = x
    else:
        z = 1
    return y, z
def for3(s):
    for x in s:
        if x: break
        y = x
    else:
        return y
    return y
def for4(s):
    for i in s:
        if i == 2: t = u
        u = i
    return t
def for5(s):
    for a, b in s: pass
    return a, b
def for6(s):
    for i in s:
        for j in i:
            k = j
    return i, j, k
def try1(c):
    try:
        if c: raise ValueError
        x = 1
    except ValueError:
        pass
    return x
def try2(c):
    try:
        x = 1
        if c: raise ValueError
        y = 2
    except ValueError:
        return x, y
    return x, y
def try3(c):
    try:
        if c: raise ValueError
    except ValueError:
        x = 1
    else:
        y = 2
    return x
def try4(c):
    try:
        if c: raise ValueError
        x = 1
    finally:
        out.append("finally")
        z = x
    return z
def try5(c):
    try:
        x = int(c)
    except ValueError as e:
        pass
    return x
def try6(c):
    try:
        raise ValueError(c)
    except ValueError as e:
        pass
    return e
def try7(c):
    e = 1
    try:
        if c: raise ValueError(c)
    except ValueError as e:
        pass
    return e
def try8(c):
    for i in range(3):
        try:
            if i == c: raise KeyError
            x = i
        except KeyError:
            y = x
    return x, y
def try9(c):
    try:
        try:
            if c: raise KeyError
            x = 1
        finally:
            w = 1
    except KeyError:
        return w, x
    return w, x
def try10(c):
    while True:
        try:
            if c: break
            x = 1
            c = 1
        finally:
            y = 1
    return y, x
def try11(c):
    try:
        x = [1][c]
    except IndexError:
        return x
    return x
def try12(c):
    def thrower():
        raise ValueError
    try:
        x = thrower() if c else 1
    except ValueError:
        pass
    return x
def try13(c):
    try:
        if c: return "early"
        x = 1
    finally:
        try:
            out.append(str(x))
        except NameError as e:
            out.append(str(e))
    return x
def try14():
    for i in range(2):
        try:
            if i: v = w
            continue
        finally:
            w = i
    return v, w
def del1():
    x = 1
    del x
    return x
def del2(c):
    x = 1
    if c: del x
    return x
def del3(n):
    x = 1
    for i in range(n):
        y = x
        del x
    return y
def del4():
    x = 1
    del x
    x = 2
    return x
def del5():
    del x
def del6(a):
    del a
    return a
def del7(n):
    x = 0
    while n:
        n -= 1
        x += 1
        if n == 1: del x
    return x
class CM:
    def __init__(self, swallow): self.swallow = swallow
    def __enter__(self): return 5
    def __exit__(self, *a): return self.swallow
def with1(c):
    with CM(True) as v:
        if c: raise ValueError
        x = 1
    return v, x
def with2(c):
    with CM(True):
        x = 1
        if c: raise ValueError
        y = 1
    return x, y
def with3(c):
    with CM(c) as a, CM(c) as b:
        raise ValueError
    return a, b
def comp1(s):
    r = [x for x in s]
    return x
def comp2(s):
    x = "outer"
    r = [x for x in s]
    return x, r
def comp3(s):
    return [b for a in s for b in b]
def comp4(s):
    r = []
    for _ in range(2):
        try:
            r.append([b for a in s for b in (b if a else [a])])
        except NameError as e:
            r.append(str(e))
    return r
def comp5(s):
    return [y for x in s if (y := x)], y
def comp6(s):
    r = [(y := x) for x in s]
    return y
def comp7(s):
    return [[i + j for j in range(i)] for i in s], {k: v for k, v in enumerate(s)}, {z for z in s}
def comp8(s):
    try:
        return [1 // x for x in s]
    except ZeroDivisionError:
        return [x for x in s]
def comp9(s):
    return [x for x in s if x for x in [x, x]]
def match1(v):
    match v:
        case [a, b]: pass
        case {"k": c}: pass
        case int(d): pass
        case _: pass
    return a
def match2(v):
    match v:
        case [a, b] if b: return a
        case [a]: return b
    return a
def match3(v):
    match v:
        case (1, x) | (2, x): pass
    return x
def gen1(c):
    def g():
        try:
            yield 1
            x = 1
            yield 2
        except ValueError:
            yield ("caught", x)
    it = g(); next(it)
    if c: next(it)
    return it.throw(ValueError)
def gen2():
    def g():
        for i in range(3):
            if i: yield y
            y = i
    return list(g())
def gen3():
    def g():
        yield x
        x = 1
    return list(g())
def gen4():
    def g():
        x = yield
        while True:
            x = yield x
    it = g(); next(it)
    return it.send(1), it.send(2)
def imp1(c):
    if c: import sys as s
    return s.__name__
def def1(c):
    if c:
        def f(): return 1
        class K: pass
    return f, K
def aug1():
    x += 1
    return x
def aug2(c):
    if c: x = 1
    x += 1
    return x
def self1():
    x = x
    return x
def self2():
    x = [x for x in (1, 2)] + [x]
    return x
def unpack1(c):
    try:
        a, b = c
    except (TypeError, ValueError):
        pass
    return a, b
def unpack2(c):
    try:
        a, (b, d) = c
    except (TypeError, ValueError):
        pass
    return a, b, d
def star1(c):
    try:
        a, *b = c
    except (TypeError, ValueError):
        pass
    return a, b
def nested1(c):
    if c: x = 1
    def inner(): return x
    return inner()
def lam1(c):
    f = lambda: y
    if c: y = 1
    return f()
def assert1(c):
    assert c or (x := 1)
    return x
def chain1(a):
    if 0 < (x := a) < 5 < (y := a + 10): pass
    return x, y
def ret1(c):
    if c:
        return 1
        x = 2
    return x
def loopelse(n):
    for i in range(n):
        if i == 5: break
    else:
        found = False
    return found
def many(c):
    if c:
        v0=v1=v2=v3=v4=v5=v6=v7=v8=v9=v10=v11=v12=v13=v14=v15=v16=v17=v18=v19=v20=v21=v22=v23=v24=v25=v26=v27=v28=v29=v30=v31=v32=v33=0
        w0=w1=w2=w3=w4=w5=w6=w7=w8=w9=w10=w11=w12=w13=w14=w15=w16=w17=w18=w19=w20=w21=w22=w23=w24=w25=w26=w27=w28=w29=w30=w31=w32=w33=1
    return v0+v33+w0+w29+w30+w31+w32+w33
def exc_group(c):
    try:
        if c: raise ExceptionGroup("g", [ValueError(1)])
        x = 1
    except* ValueError as eg:
        pass
    return x
def exc_group2(c):
    try:
        raise ExceptionGroup("g", [ValueError(1)])
    except* ValueError as eg:
        pass
    return eg
import asyncio
def async1(c):
    async def f():
        if c: x = await asyncio.sleep(0, 5)
        return x
    return asyncio.run(f())
def async2(s):
    async def agen():
        for i in s: yield i
    async def f():
        async for v in agen(): w = v
        return v, w, [q async for q in agen()]
    return asyncio.run(f())

for c in (0, 1):
    for f in [if1, if2, if3, tern, andor2, andor3, try1, try2, try3, try4, try6, try7, try9, try10, try11, try12, try13, del2, with1, with2, with3, gen1, imp1, aug2, nested1, lam1, assert1, ret1, many, exc_group, exc_group2, async1]:
        rec(f, c)
    for d in (0, 1):
        rec(if4, c, d); rec(andor, c, d)
rec(def1, 0)
for n in (0, 1, 2, 3): 
    for f in [while1, while2, while3, while4, while5, del3, del7, try8, loopelse]: rec(f, n)
for s in ([], [0], [1], [0, 1], [1, 2, 3], [0, 2, 3]):
    for f in [for1, for2, for3, for4, comp1, comp2, comp5, comp6, comp7, comp8, comp9, async2]: rec(f, s)
for s in ([], [(1, 2)], [(1, 2), (3, 4)], [1]): rec(for5, s)
for s in ([], [[]], [[1]], [[], [2]], [[1], []]): rec(for6, s); rec(comp3, s)
rec(comp4, [0, 1]); rec(comp4, [1]); rec(comp4, [])
rec(try5, "1"); rec(try5, "x"); rec(try14)
for f in [del1, del4, del5, gen2, gen3, gen4, aug1, self1, self2]: rec(f)
rec(del6, 1)
for v in ([1, 2], [1, 0], [1], {"k": 1}, 5, "s", (1, 9), (2, 8), (3, 7)): rec(match1, v); rec(match2, v); rec(match3, v)
for v in ((1, 2), (1,), 5, (1, (2, 3)), (1, (2,)), (1, 2, 3), ()): rec(unpack1, v); rec(unpack2, v); rec(star1, v)
for a in (-1, 3, 7): rec(chain1, a)
import hashlib, sys
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
if len(sys.argv) > 1:
    print("\n".join(out))
