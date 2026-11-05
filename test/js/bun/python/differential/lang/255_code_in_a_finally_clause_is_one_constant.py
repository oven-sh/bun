# A `finally` clause is compiled for each way into it. What is written in it once (a function, a class, a lambda, a generator expression, a type alias) is
# one code object all the same: one constant of the enclosing code.
import types, warnings
warnings.simplefilter('ignore')

SOURCES = {
'def': 'def f(x):\n    try:\n        x()\n    finally:\n        def g(a, b=1): return a\n    return g\n',
'async def': 'def f(x):\n    try:\n        x()\n    finally:\n        async def g(a): await a\n    return g\n',
'with annotations': 'def f(x):\n    try:\n        x()\n    finally:\n        def g(a: int) -> int: return a\n    return g\n',
'with type parameters': 'def f(x):\n    try:\n        x()\n    finally:\n        def g[T](a: T) -> T: return a\n    return g\n',
'class': 'def f(x):\n    try:\n        x()\n    finally:\n        class C:\n            def m(self): return 1\n    return C\n',
'lambda': 'def f(x):\n    try:\n        x()\n    finally:\n        g = lambda a: a\n    return g\n',
'generator expression': 'def f(x):\n    try:\n        x()\n    finally:\n        g = (a for a in x)\n    return g\n',
'sum of one': 'def f(x):\n    try:\n        x()\n    finally:\n        g = sum(a for a in x)\n    return g\n',
'any of one': 'def f(x):\n    try:\n        x()\n    finally:\n        g = any(a for a in x)\n    return g\n',
'type alias': 'def f(x):\n    try:\n        x()\n    finally:\n        type A = int\n    return A\n',
'return in the body': 'def f(x):\n    try:\n        return x()\n    finally:\n        g = lambda a: a\n',
'in a loop': 'def f(x):\n    for i in x:\n        try:\n            if i: break\n            if x: continue\n            if f: return 1\n        finally:\n            g = lambda a: a\n',
'one in another': 'def f(x):\n    try:\n        x()\n    finally:\n        try:\n            x()\n        finally:\n            g = lambda a: a\n',
'in a handler too': 'def f(x):\n    try:\n        x()\n    except E:\n        h = lambda: 1\n    finally:\n        g = lambda: 2\n',
'two that look alike': 'def f(x):\n    try:\n        x()\n    finally:\n        g = lambda: 1; h = lambda: 1\n',
'with': 'def f(x):\n    with x:\n        g = lambda: 1\n    return g\n',
'in a module': 'try:\n    pass\nfinally:\n    def g(): pass\n',
'in a class': 'class C:\n    try:\n        pass\n    finally:\n        def g(self): pass\n',
'not reached': 'def f(x):\n    try:\n        return 1\n    finally:\n        return 2\n        g = lambda: 1\n',
}
def show(code, depth):
    for constant in code.co_consts:
        if isinstance(constant, types.CodeType):
            print('    ' * depth + constant.co_name, constant.co_firstlineno)
            show(constant, depth + 1)
def main():
    for name, source in SOURCES.items():
        print(name)
        show(compile(source, '<source>', 'exec'), 1)
    # Both ways make a function from it.
    namespace = {}
    exec(SOURCES['def'], namespace)
    f = namespace['f']
    one = f(int)
    try:
        f(None)
    except TypeError as e:
        other = e.__traceback__.tb_next.tb_frame.f_locals['g']
    print(one is other, one.__code__ is other.__code__, one(5), other(6))
main()
