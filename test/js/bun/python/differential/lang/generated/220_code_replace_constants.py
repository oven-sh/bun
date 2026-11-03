# code.replace(co_consts=...)
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')

try:
    def f(x):
        return x * 1000, "text", 2.5, b"bytes", 3j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(x):')

try: code = f.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = f.__code__')
try: print(code.co_consts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code.co_consts')
try: same = code.replace(co_consts=code.co_consts, co_code=code.co_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same = code.replace(co_consts=code.co_consts, co_code=code.co_code)')
try: print('same == code =>', same == code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same == code')
try: print('same.co_consts == code.co_consts =>', same.co_consts == code.co_consts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same.co_consts == code.co_consts')

try: swap = {1000: 2000, "text": "other", 2.5: 0.25, b"bytes": b"", 3j: 4j}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: swap = {1000: 2000, "text": "other", 2.5: 0.25, b"bytes": b"", 3j: 4j}')
try: changed = code.replace(co_consts=tuple(swap.get(c, c) for c in code.co_consts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: changed = code.replace(co_consts=tuple(swap.get(c, c) for c in code.c...')
try: print(changed.co_consts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: changed.co_consts')
try: print('f(2) =>', f(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(2)')
try: print('types.FunctionType(changed, globals())(2) =>', types.FunctionType(changed, globals())(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.FunctionType(changed, globals())(2)')
try: print('changed == code =>', changed == code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: changed == code')
try: print('code.co_consts =>', code.co_consts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code.co_consts')
try: g = types.FunctionType(code, globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = types.FunctionType(code, globals())')
try: g.__code__ = changed
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__code__ = changed')
try: print('g(3) =>', g(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g(3)')
try: print('f(3) =>', f(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(3)')

# The code of a nested function.
try:
    def outer():
        return (lambda: "first")()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try:
    def donor():
        return (lambda: "second")()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def donor():')
try: inner = next(c for c in donor.__code__.co_consts if isinstance(c, types.CodeType))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inner = next(c for c in donor.__code__.co_consts if isinstance(c, typ...')
try: new = outer.__code__.replace(co_consts=tuple(inner if isinstance(c, types.CodeType) else c for c in outer.__code__.co_consts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new = outer.__code__.replace(co_consts=tuple(inner if isinstance(c, t...')
try: print([c is inner for c in new.co_consts if isinstance(c, types.CodeType)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c is inner for c in new.co_consts if isinstance(c, types.CodeType)]')
try: print('outer() =>', outer())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer()')
try: print('types.FunctionType(new, globals())() =>', types.FunctionType(new, globals())())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.FunctionType(new, globals())()')
try: print('donor() =>', donor())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: donor()')
try: print(repr(new.co_consts) == repr(tuple(inner if isinstance(c, types.CodeType) else c for c in outer.__code__.co_consts)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(new.co_consts) == repr(tuple(inner if isinstance(c, types.CodeTy...')

# With cells.
try:
    def closes(a):
        def inner():
            return a + 1
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closes(a):')
try:
    def closes_too(a):
        def inner():
            return a * 100
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closes_too(a):')
try: other = next(c for c in closes_too.__code__.co_consts if isinstance(c, types.CodeType))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other = next(c for c in closes_too.__code__.co_consts if isinstance(c...')
try: new = closes.__code__.replace(co_consts=tuple(other if isinstance(c, types.CodeType) else c for c in closes.__code__.co_consts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new = closes.__code__.replace(co_consts=tuple(other if isinstance(c, ...')
try: print('closes(2)() =>', closes(2)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: closes(2)()')
try: print('types.FunctionType(new, globals())(2)() =>', types.FunctionType(new, globals())(2)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.FunctionType(new, globals())(2)()')

# In a generator.
try:
    def gen():
        yield "one thing"
        yield 12345
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try: new = gen.__code__.replace(co_consts=tuple({"one thing": "another", 12345: 54321}.get(c, c) for c in gen.__code__.co_consts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new = gen.__code__.replace(co_consts=tuple({"one thing": "another", 1...')
try: print('list(gen()) =>', list(gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen())')
try: print('list(types.FunctionType(new, globals())()) =>', list(types.FunctionType(new, globals())()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(types.FunctionType(new, globals())())')

try:
    for bad in (1, [1], "x"):
        try:
            code.replace(co_consts=bad)
        except TypeError as e:
            print('e [' + 'bad=' + (repr(bad) if type(bad) in (str, int, float, bytes, bool, type(None)) or (type(bad) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in bad)) else bad.__name__ if type(bad) is type else type(bad).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bad in (1, [1], "x"):')
