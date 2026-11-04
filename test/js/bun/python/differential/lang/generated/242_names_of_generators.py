# __name__ and __qualname__ of generators, coroutines and asynchronous generators: those the function had when the object was made.
try: import types, functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types, functools')


try:
    def show(label, g):
        code = getattr(g, 'gi_code', None) or getattr(g, 'cr_code', None) or getattr(g, 'ag_code', None)
        print(label, g.__name__, g.__qualname__, code.co_name, code.co_qualname, repr(g).split(' at ')[0])
        if hasattr(g, 'close'):
            g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, g):')


try:
    def g():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g():')


try:
    class C:
        def method(self):
            yield 1

        async def co(self):
            pass

        async def ag(self):
            yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')


try: show('plain', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('plain', g())")
try: show('method', C().method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('method', C().method())")
try: show('coroutine', C().co())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('coroutine', C().co())")
try: show('asynchronous', C().ag())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('asynchronous', C().ag())")
try: show('expression', (x for x in ()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('expression', (x for x in ()))")
try: show('lambda', (lambda: (yield))())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('lambda', (lambda: (yield))())")


try:
    def outer():
        def inner():
            yield 1
        return inner, (x for x in ()), [(y for y in ()) for _ in range(1)][0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')


try: inner, expression, nested = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inner, expression, nested = outer()')
try: show('inner', inner())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('inner', inner())")
try: show('expression in a function', expression)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('expression in a function', expression)")
try: show('expression in a comprehension', nested)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('expression in a comprehension', nested)")

try: print('--- the names of the function are set before the call')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the names of the function are set before the call'")
try: early = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: early = g()')
try: g.__name__ = 'renamed'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.__name__ = 'renamed'")
try: late = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: late = g()')
try: show('made before', early)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made before', early)")
try: show('made after', late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made after', late)")
try: g.__qualname__ = 'Q.renamed'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.__qualname__ = 'Q.renamed'")
try: show('both', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('both', g())")
try: early = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: early = g()')
try: g.__name__ = 'again'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.__name__ = 'again'")
try: g.__qualname__ = 'again'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.__qualname__ = 'again'")
try: show('made before the second change', early)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made before the second change', early)")
try: show('made after it', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made after it', g())")


try:
    def h():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h():')


try: first = h()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = h()')
try: print(first.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first.__name__')
try: h.__name__ = 'h2'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: h.__name__ = 'h2'")
try: print('first.__name__ =>', first.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first.__name__')
try: print('first.__qualname__ =>', first.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first.__qualname__')
try: print('h().__name__ =>', h().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h().__name__')
try: print('h().__qualname__ =>', h().__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h().__qualname__')


try:
    def k():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def k():')


try: first = k()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = k()')
try: k.__qualname__ = 'K'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: k.__qualname__ = 'K'")
try: print('first.__qualname__ =>', first.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first.__qualname__')
try: print('first.__name__ =>', first.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first.__name__')
try: print('k().__qualname__ =>', k().__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k().__qualname__')
try: print('k().__name__ =>', k().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k().__name__')

try: print('--- the names of the generator are set')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the names of the generator are set'")
try: x = h()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = h()')
try: x.__name__ = 'mine'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x.__name__ = 'mine'")
try: print('x.__name__ =>', x.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__name__')
try: print('x.__qualname__ =>', x.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__qualname__')
try: print('h.__name__ =>', h.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.__name__')
try: print('x.gi_code.co_name =>', x.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_code.co_name')
try: x.__qualname__ = 'Mine.mine'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x.__qualname__ = 'Mine.mine'")
try: print('x.__name__ =>', x.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__name__')
try: print('x.__qualname__ =>', x.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__qualname__')
try: print("repr(x).split(' at ')[0] =>", repr(x).split(' at ')[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: repr(x).split(' at ')[0]")
try:
    for name in ('__name__', '__qualname__'):
        for value in (1, None, b'x'):
            try:
                setattr(x, name, value)
            except TypeError as e:
                print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'value=' + (repr(value) if type(value) in (str, int, float, bytes, bool, type(None)) or (type(value) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in value)) else value.__name__ if type(value) is type else type(value).__name__) + '] =>', name)
                print('repr(value) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'value=' + (repr(value) if type(value) in (str, int, float, bytes, bool, type(None)) or (type(value) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in value)) else value.__name__ if type(value) is type else type(value).__name__) + '] =>', repr(value))
                print('e [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'value=' + (repr(value) if type(value) in (str, int, float, bytes, bool, type(None)) or (type(value) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in value)) else value.__name__ if type(value) is type else type(value).__name__) + '] =>', e)
        try:
            delattr(x, name)
        except TypeError as e:
            print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
            print('del', 'e [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('__name__', '__qualname__'):")


try:
    class S(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(str):')


try: x.__name__ = S('sub')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x.__name__ = S('sub')")
try: print('type(x.__name__).__name__ =>', type(x.__name__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(x.__name__).__name__')
try: print('x.__name__ =>', x.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__name__')

try: print('--- other code, other functions')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- other code, other functions'")


try:
    def a():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a():')


try:
    def b():
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b():')


try: before = a()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before = a()')
try: a.__code__ = b.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__code__ = b.__code__')
try: show('made before __code__ was set', before)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made before __code__ was set', before)")
try: show('made after', a())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made after', a())")
try: show('FunctionType', types.FunctionType(b.__code__, globals())())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('FunctionType', types.FunctionType(b.__code__, globals())())")
try: show('FunctionType with a name', types.FunctionType(b.__code__, globals(), 'given')())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('FunctionType with a name', types.FunctionType(b.__code__, globa...")
try: show('replace', types.FunctionType(b.__code__.replace(co_name='n', co_qualname='q.n'), globals())())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('replace', types.FunctionType(b.__code__.replace(co_name='n', co...")


try:
    @functools.wraps(b)
    def wrapper():
        yield 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrapper():')


try: show('wraps', wrapper())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('wraps', wrapper())")


try:
    @types.coroutine
    def old_style():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def old_style():')


try: show('types.coroutine', old_style())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('types.coroutine', old_style())")
try: print([next(f()) for f in (a, b, wrapper)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [next(f()) for f in (a, b, wrapper)]')
