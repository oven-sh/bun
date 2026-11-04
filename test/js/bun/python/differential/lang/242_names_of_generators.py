# __name__ and __qualname__ of generators, coroutines and asynchronous generators: those the function had when the object was made.
import types, functools


def show(label, g):
    code = getattr(g, 'gi_code', None) or getattr(g, 'cr_code', None) or getattr(g, 'ag_code', None)
    print(label, g.__name__, g.__qualname__, code.co_name, code.co_qualname, repr(g).split(' at ')[0])
    if hasattr(g, 'close'):
        g.close()


def g():
    yield 1


class C:
    def method(self):
        yield 1

    async def co(self):
        pass

    async def ag(self):
        yield 1


show('plain', g())
show('method', C().method())
show('coroutine', C().co())
show('asynchronous', C().ag())
show('expression', (x for x in ()))
show('lambda', (lambda: (yield))())


def outer():
    def inner():
        yield 1
    return inner, (x for x in ()), [(y for y in ()) for _ in range(1)][0]


inner, expression, nested = outer()
show('inner', inner())
show('expression in a function', expression)
show('expression in a comprehension', nested)

print('--- the names of the function are set before the call')
early = g()
g.__name__ = 'renamed'
late = g()
show('made before', early)
show('made after', late)
g.__qualname__ = 'Q.renamed'
show('both', g())
early = g()
g.__name__ = 'again'
g.__qualname__ = 'again'
show('made before the second change', early)
show('made after it', g())


def h():
    yield 1


first = h()
print(first.__name__)
h.__name__ = 'h2'
print(first.__name__, first.__qualname__, h().__name__, h().__qualname__)


def k():
    yield 1


first = k()
k.__qualname__ = 'K'
print(first.__qualname__, first.__name__, k().__qualname__, k().__name__)

print('--- the names of the generator are set')
x = h()
x.__name__ = 'mine'
print(x.__name__, x.__qualname__, h.__name__, x.gi_code.co_name)
x.__qualname__ = 'Mine.mine'
print(x.__name__, x.__qualname__, repr(x).split(' at ')[0])
for name in ('__name__', '__qualname__'):
    for value in (1, None, b'x'):
        try:
            setattr(x, name, value)
        except TypeError as e:
            print(name, repr(value), e)
    try:
        delattr(x, name)
    except TypeError as e:
        print(name, 'del', e)


class S(str):
    pass


x.__name__ = S('sub')
print(type(x.__name__).__name__, x.__name__)

print('--- other code, other functions')


def a():
    yield 1


def b():
    yield 2


before = a()
a.__code__ = b.__code__
show('made before __code__ was set', before)
show('made after', a())
show('FunctionType', types.FunctionType(b.__code__, globals())())
show('FunctionType with a name', types.FunctionType(b.__code__, globals(), 'given')())
show('replace', types.FunctionType(b.__code__.replace(co_name='n', co_qualname='q.n'), globals())())


@functools.wraps(b)
def wrapper():
    yield 3


show('wraps', wrapper())


@types.coroutine
def old_style():
    yield 1


show('types.coroutine', old_style())
print([next(f()) for f in (a, b, wrapper)])
