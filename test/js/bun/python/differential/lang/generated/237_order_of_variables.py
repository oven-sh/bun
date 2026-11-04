# The order of a function's variables, which co_varnames, locals(), f_locals and vars() show, is the order in which the
# compiler comes to them: a value before the targets it is assigned to, and so on.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')


try:
    def a1():
        x = (y := 1)
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a1():')
try:
    def a2():
        for x in (y := [1]): z = x
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a2():')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a3():')
try:
    def a4():
        x = [i for i in range(2)]
        y = 2
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a4():')
try:
    def a5():
        def x(a=(y := 1)): pass
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a5():')
try:
    def a6():
        x: int
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a6():')
try:
    def a8():
        l = [0]; l[(y := 0)] = (z := 1)
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a8():')
try:
    def a9():
        x = (y := 1) if (z := 2) else (w := 3)
        return list(sys._getframe().f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a9():')
try:
    def b1(p, q=1, *r, s, **t):
        b = a = p
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b1(p, q=1, *r, s, **t):')
try:
    def b2():
        a, b = (c := 1), (d := 2)
        (e, f), g = (1, 2), 3
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b2():')
try:
    def b3():
        with open(__file__) as f, open(__file__) as g:
            h = 1
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b3():')
try:
    def b4():
        import os.path as p, sys as s
        from os import sep as q
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b4():')
try:
    def b5():
        @(d := lambda f: f)
        class C((b := object)): pass
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b5():')
try:
    def b6():
        x += (y := 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b6():')
try:
    def b7():
        del x
        y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b7():')
try:
    def b8():
        x: int = (y := 1)
        z: int
        w: int
        w = 2
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b8():')
try:
    def b9():
        a = [i + j for i in range(1) for j in range(1)]
        b = {k: v for k, v in ()}
        i = 5
        c = [i for i in range(2)]
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b9():')
try:
    def c1(v):
        match v:
            case [a, b]: c = 1
            case {'k': d, **e}: f = 2
            case str() as g: pass
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1(v):')
try:
    def c2():
        while (a := 0): b = 1
        else: c = 2
        if (d := 1): e = 1
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2():')
try:
    def c3():
        x = lambda: (y, z)
        z = 1
        y = 2
        w = 3
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3():')
try:
    def c4():
        yield (a := 1)
        b = yield
        c = yield from (d := ())
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4():')
try:
    async def c5():
        async with (a := None) as b: pass
        async for c in (d := None): e = 1
        f = await (g := None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c5():')
try:
    def c6():
        try:
            pass
        except* ValueError as a:
            b = 1
        c = 1
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c6():')
try:
    def c7():
        if 0:
            dead = 1
        return 1
        after = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c7():')
try:
    def c8():
        global G
        nonlocal_free = 1
        G = (a := 1)
        print(b := 2, end='')
        return list(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c8():')

try:
    for f in (a1, a2, a3, a4, a5, a6, a8, a9, b2, b3, b4, b5, b8, b9, c2, c3, c6, c8):
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('f() [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f()')
        try: print('f.__code__.co_varnames [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__code__.co_varnames)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_varnames')
        try: print('f.__code__.co_nlocals [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__code__.co_nlocals)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_nlocals')
        try: print('f.__code__.co_cellvars [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__code__.co_cellvars)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_cellvars')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (a1, a2, a3, a4, a5, a6, a8, a9, b2, b3, b4, b5, b8, b9, c2,...')
try: print('b1', 'b1(1, s=2) =>', b1(1, s=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1(1, s=2)')
try: print('b1.__code__.co_varnames =>', b1.__code__.co_varnames)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1.__code__.co_varnames')
try: print('c1', 'c1([1, 2]) =>', c1([1, 2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1([1, 2])')
try: print("c1({'k': 1}) =>", c1({'k': 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c1({'k': 1})")
try: print("c1('s') =>", c1('s'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c1('s')")
try: print('c1.__code__.co_varnames =>', c1.__code__.co_varnames)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1.__code__.co_varnames')
try:
    for f in (b6, b7, c4, c5, c7):
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('f.__code__.co_varnames [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__code__.co_varnames)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_varnames')
        try: print('f.__code__.co_nlocals [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__code__.co_nlocals)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_nlocals')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (b6, b7, c4, c5, c7):')

# Many of them, and many names and constants: each is listed once, in order.
try: count = 3000
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count = 3000')
try: source = 'def many(%s):\n' % ', '.join('p%d' % i for i in range(200))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = 'def many(%s):\\n' % ', '.join('p%d' % i for i in range(200))")
try: source += ''.join('    v%d = g%d + %d + %d.5 + "s%d"\n' % (i, i % 1000, i, i, i % 700) for i in range(count))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: source += \'\'.join(\' v%d = g%d + %d + %d.5 + "s%d"\\n\' % (i, i % 1000, ...')
try: source += '    return {%s}\n' % ', '.join('"k%d": v%d' % (i, count - 1 - i) for i in range(count))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: source += \' return {%s}\\n\' % \', \'.join(\'"k%d": v%d\' % (i, count - 1 -...')
try: namespace = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
try: exec(source, namespace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(source, namespace)')
try: code = namespace['many'].__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = namespace['many'].__code__")
try: print("code.co_varnames == tuple('p%d' % i for i in range(200)) + tuple('v%d... =>", code.co_varnames == tuple('p%d' % i for i in range(200)) + tuple('v%d' % i for i in range(count)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code.co_varnames == tuple('p%d' % i for i in range(200)) + tuple('v%d...")
try: print("code.co_names == tuple('g%d' % i for i in range(1000)) =>", code.co_names == tuple('g%d' % i for i in range(1000)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code.co_names == tuple('g%d' % i for i in range(1000))")
try: print('len(code.co_consts) =>', len(code.co_consts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(code.co_consts)')
try: print('len(set(map(repr, code.co_consts))) =>', len(set(map(repr, code.co_consts))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(set(map(repr, code.co_consts)))')
