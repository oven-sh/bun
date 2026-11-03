# code.replace(co_consts=...)
import types

def f(x):
    return x * 1000, "text", 2.5, b"bytes", 3j

code = f.__code__
print(code.co_consts)
same = code.replace(co_consts=code.co_consts, co_code=code.co_code)
print(same == code, same.co_consts == code.co_consts)

swap = {1000: 2000, "text": "other", 2.5: 0.25, b"bytes": b"", 3j: 4j}
changed = code.replace(co_consts=tuple(swap.get(c, c) for c in code.co_consts))
print(changed.co_consts)
print(f(2), types.FunctionType(changed, globals())(2))
print(changed == code, code.co_consts)
g = types.FunctionType(code, globals())
g.__code__ = changed
print(g(3), f(3))

# The code of a nested function.
def outer():
    return (lambda: "first")()
def donor():
    return (lambda: "second")()
inner = next(c for c in donor.__code__.co_consts if isinstance(c, types.CodeType))
new = outer.__code__.replace(co_consts=tuple(inner if isinstance(c, types.CodeType) else c for c in outer.__code__.co_consts))
print([c is inner for c in new.co_consts if isinstance(c, types.CodeType)])
print(outer(), types.FunctionType(new, globals())(), donor())
print(repr(new.co_consts) == repr(tuple(inner if isinstance(c, types.CodeType) else c for c in outer.__code__.co_consts)))

# With cells.
def closes(a):
    def inner():
        return a + 1
    return inner
def closes_too(a):
    def inner():
        return a * 100
    return inner
other = next(c for c in closes_too.__code__.co_consts if isinstance(c, types.CodeType))
new = closes.__code__.replace(co_consts=tuple(other if isinstance(c, types.CodeType) else c for c in closes.__code__.co_consts))
print(closes(2)(), types.FunctionType(new, globals())(2)())

# In a generator.
def gen():
    yield "one thing"
    yield 12345
new = gen.__code__.replace(co_consts=tuple({"one thing": "another", 12345: 54321}.get(c, c) for c in gen.__code__.co_consts))
print(list(gen()), list(types.FunctionType(new, globals())()))

for bad in (1, [1], "x"):
    try:
        code.replace(co_consts=bad)
    except TypeError as e:
        print(e)
