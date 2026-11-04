# What is computed goes straight to where it belongs, when nobody can tell: these are the cases in which somebody could.
import sys, asyncio


def show(label, function, *args):
    try:
        print(label, function(*args))
    except BaseException as e:
        print(label, 'raised', type(e).__name__, e)


# ---- Displays and f-strings assigned to a variable that is among their items ----

def displays():
    x = 1
    x = [x, x + 1]
    y = x
    x = (x, len(x))
    z = {1}
    z = {len(z), 5}
    d = {'a': 1}
    d = {'d': d, 'n': len(d)}
    s = 'ab'
    s = f'{s}{s!r}{s:>4}{len(s)}'
    return x, y, z, d, s
show('displays', displays)


def display_fails():
    out = []
    x = 'old'
    for source in ('x = [x, 1 // 0]', 'x = (x, 1 // 0)', 'x = {x, 1 // 0}', 'x = {x: 1 // 0}', 'x = {[]: x}', 'x = {x, []}', 'x = f"{x}{1 // 0}"', 'x = f"{x:{1 // 0}}"'):
        namespace = {}
        exec('def f():\n    x = "old"\n    try:\n        %s\n    except Exception as e:\n        return x, type(e).__name__\n' % source, namespace)
        out.append(namespace['f']())
    return out
show('a display that fails', display_fails)


def annotated():
    x: int = 1
    x: list = [x, x + 1]
    y: 'whatever' = x
    try:
        x: int = [x, 1 // 0]
    except ZeroDivisionError:
        pass
    z: int
    (w): int = 5
    return x, y, w
show('annotated', annotated)


class Formats:
    def __init__(self, result): self.result = result
    def __format__(self, spec): return self.result if spec == '' else 'spec:' + spec
    def __str__(self): return 'str'
    def __repr__(self): return 'repr'


class Text(str):
    def __format__(self, spec): return 'Text.__format__'


def formats():
    a, b, c = Formats('formatted'), Text('t'), None
    return f'{a}', f'{a!s}', f'{a!r}', f'{a:x}', f'{b}', f'{b!s}', f'{c}', f'{1}', f'{1.5}', f'{True}', f'{"s"}', f'{(1, 2)}', f'<{a}>', f'{a}{b}'
show('formats', formats)
show('__format__ gives no str', lambda: f'{Formats(5)}')
show('__format__ gives a Text', lambda: type(f'{Formats(Text("x"))}').__name__)


# ---- return, and what runs on the way out ----

def return_finally():
    x = 'old'
    try:
        return x
    finally:
        x = 'new'


def return_in_handler():
    try:
        1 // 0
    except ZeroDivisionError as e:
        return e


class Exit:
    def __init__(self, frame): self.frame = frame
    def __enter__(self): return self
    def __exit__(self, *a): self.frame.f_locals['x'] = 'new'


def return_with():
    x = 'old'
    with Exit(sys._getframe()):
        return x


def closes(frame):
    try:
        yield 1
    finally:
        frame.f_locals['x'] = 'new'


def return_in_for():
    x = 'old'
    for i in closes(sys._getframe()):
        return x


def return_in_loops(items):
    x = 'found'
    while True:
        for i in items:
            if i:
                return x
        return items


def return_in_match(v):
    x = 'x'
    match v:
        case 1:
            return x
        case _:
            return v
for f in (return_finally, return_in_handler, return_with, return_in_for):
    show(f.__name__, lambda: repr(f()))
show('return_in_loops', lambda: (return_in_loops([0, 1]), return_in_loops([0])))
show('return_in_match', lambda: (return_in_match(1), return_in_match(2)))


# ---- a, b = x, y ----

def pairs():
    out = []
    a, b = 0, 1
    out.append((a, b))
    for _ in range(5):
        a, b = b, a + b
    out.append((a, b))
    a, b = b, a
    out.append((a, b))
    a, a = 1, 2
    out.append(a)
    a, a = a + 1, a + 2
    out.append(a)
    a, b, c = 1, 2, 3
    a, b, c = c, a, b
    out.append((a, b, c))
    x, y = 'x', 'y'
    a, b = x, y
    out.append((a, b))
    a, b = b, x
    out.append((a, b))
    a, b = b, (a := 5)
    out.append((a, b))
    a, b = (b := 3), b
    out.append((a, b))
    a, b = (x := 'X'), x
    out.append((a, b, x))
    a, b = x, (x := 'Z')
    out.append((a, b, x))
    () = ()
    [a, b] = b, a
    out.append((a, b))
    return out
show('pairs', pairs)


def pair_fails():
    a, b = 'a', 'b'
    try:
        a, b = 1, 1 // 0
    except ZeroDivisionError:
        pass
    try:
        a, b = 1 // 0, 2
    except ZeroDivisionError:
        pass
    try:
        a, b = b, a + 1
    except TypeError:
        pass
    return a, b
show('a pair that fails', pair_fails)


class Attributes:
    def __setattr__(self, name, value):
        print('   set', name, value)
        object.__setattr__(self, name, value)


def pair_of_other_targets():
    o, l = Attributes(), [0, 0]
    x = 1
    o.a, x = x, x + 1
    x, o.b = x + 1, x
    l[0], l[1] = l[1] + 1, l[0] + 2
    global G
    G, x = x, 7
    return x, l, G
show('other targets', pair_of_other_targets)


# ---- Comprehensions and generator expressions ----

def comprehensions():
    x = [1, 2, 3]
    a = [x for x in x]
    b = [x * y for x in x for y in x]
    c = {x for x in x}
    d = {x: x for x in x}
    y = [[1, 2], [3]]
    e = [z for y in y for z in y]
    return a, b, c, d, e, x, y
show('comprehensions', comprehensions)


def unbound_iterable():
    try:
        return [i for i in later]
    except UnboundLocalError as e:
        later = str(e)
        return later
show('unbound iterable', unbound_iterable)


def sends():
    g = (x * 2 for x in range(4))
    return next(g), g.send('ignored'), g.send(None), list(g)
show('send to a generator expression', sends)


def yields():
    def g(x):
        yield x
        y = yield x
        x = yield y
        x = yield x
        yield
        z = yield
        return x, y, z
    it = g('x')
    out = [next(it)]
    try:
        for value in ('a', 'b', 'c', 'd', 'e', 'f', 'g'):
            out.append(it.send(value))
    except StopIteration as e:
        out.append(e.value)
    return out
show('yields', yields)


def thrown_into():
    def g(x):
        try:
            yield x
        except KeyError:
            x = 'caught'
        y = yield x
        return y
    it = g('x')
    out = [next(it), it.throw(KeyError)]
    try:
        it.send('sent')
    except StopIteration as e:
        out.append(e.value)
    return out
show('thrown into', thrown_into)


async def async_yields():
    async def g(x):
        yield x
        y = yield x
        x = yield y
        yield x
    it = g('x')
    out = [await it.__anext__()]
    for value in ('a', 'b', 'c'):
        out.append(await it.asend(value))
    out.append([i async for i in (j async for j in g('y'))])
    return out
show('async yields', lambda: asyncio.run(async_yields()))


# ---- := ----

def walrus(p):
    out = []
    x, other = 1, 10
    out.append(x + (x := 5))
    out.append([x, (x := 6), x])
    out.append((lambda *a: a)(x, (x := 7), x, other))
    out.append(x * other + (x := 2) * other)
    out.append({x: (x := 3), x: x})
    out.append(f'{x}{(x := 4)}{x}')
    out.append(x < (x := 9) < x + 1)
    out.append((p, (p := 'q'), p))
    out.append(other + (x := 1) + other)
    y = 100
    out.append(y + sum([(y := i) for i in range(4)]) + y)
    out.append([y, [(y := i * 2) for i in range(3)], y])
    out.append(x if (x := 0) else -1)
    return out
show('walrus', walrus, 'p')


def walrus_in_lambda():
    f = lambda a: (a, (a := a + 1), a)
    return f(1)
show('walrus in a lambda', walrus_in_lambda)


# ---- Unpacking ----

def unpack_kinds():
    out = []
    for value in ((1, 2), [3, 4], 'ab', {5: 0, 6: 0}, iter([7, 8]), (i for i in (9, 10)), range(2), b'xy', {11: 1}.items().__iter__().__next__()):
        a, b = value
        out.append((a, b))
    return out
show('kinds', unpack_kinds)


def unpack_fails():
    out = []

    def raises():
        yield 1
        raise KeyError('half way')
    for value in ((1,), (1, 2, 3), [1], [1, 2, 3], 'a', 'abc', iter([1]), iter([1, 2, 3]), raises(), 5, None, {1: 1}):
        a, b = 'a', 'b'
        try:
            a, b = value
        except Exception as e:
            out.append((a, b, type(e).__name__, str(e)))
        a, b, c = 'a', 'b', 'c'
        try:
            a, *b, c = value
            out.append((a, b, c))
        except Exception as e:
            out.append((a, b, c, type(e).__name__, str(e)))
    return out
for row in unpack_fails():
    print('   ', row)


def unpack_watched():
    seen = []

    def watches(frame):
        for i in range(2):
            seen.append(dict(frame.f_locals)['a'])
            yield i
    a, b = 'a', 'b'
    a, b = watches(sys._getframe())
    return a, b, seen
show('an iterator that watches', unpack_watched)


def unpack_forms():
    out = []
    a = (1, 2)
    a, b = a
    out.append((a, b))
    b = [3, 4]
    a, b = b
    out.append((a, b))
    b, a = (5, 6)
    out.append((a, b))
    a, c = (7, 8)
    out.append((a, b, c))
    (a, b), c = (9, 10), 11
    out.append((a, b, c))
    a, (b, c) = 12, [13, 14]
    out.append((a, b, c))
    a, *b = 'xyz'
    out.append((a, b))
    *a, b = 'xyz'
    out.append((a, b))
    a, *b, c = range(6)
    out.append((a, b, c))
    a, b, *c = (1, 2)
    out.append((a, b, c))
    [a, b, c] = 'pqr'
    out.append((a, b, c))
    a, a = (1, 2)
    out.append(a)
    for a, b in [(1, 2), [3, 4], 'xy']:
        out.append((a, b))
    for a, (b, c) in [(1, (2, 3))]:
        out.append((a, b, c))
    out.append([(p, q) for p, q in [(1, 2), (3, 4)]])
    out.append({p: q for p, q in {1: 2}.items()})
    with open(__file__) as f, open(__file__) as g:
        pass
    return out
show('forms', unpack_forms)


def unpack_parameters(a, b, c):
    a, b, c = c, b, a
    x = (a, b, c)
    c, b, a = x
    a, b = x[:2]
    b, c = x[1:]
    return a, b, c
show('parameters', unpack_parameters, 1, 2, 3)


def unpack_cells_and_globals():
    global G, H
    a, b = 1, 2
    G, H = (3, 4)
    c, d = (5, 6)
    e, G = (7, 8)

    def inner():
        return c
    return a, b, c, d, e, G, H, inner()
show('cells and globals', unpack_cells_and_globals)


def unpack_deleted():
    a, b = 1, 2
    del a
    try:
        a, b = (3,)
    except ValueError:
        pass
    try:
        return a
    except UnboundLocalError as e:
        a, b = (4, 5)
        return str(e), a, b
show('deleted', unpack_deleted)


def unpack_generator():
    a, b = yield
    c, d = yield (a, b)
    yield a, b, c, d
g = unpack_generator()
next(g)
print('in a generator', g.send((1, 2)), g.send([3, 4]))


class Body:
    a, b = (1, 2)
    b, a = a, b
    c, *d = 'xyz'
print('in a class', Body.a, Body.b, Body.c, Body.d)
m, n = (1, 2)
n, m = m, n
print('in a module', m, n)


# Targets on several lines are assigned to one by one, as whoever is told of the lines sees.
def several_lines():
    a = b = c = None
    (a,
     b,
     c) = (1, 2, 3)
    (a,
     b) = (b,
           a)
    return a, b, c


def traced(function):
    seen = []

    def trace(frame, event, arg):
        if frame.f_code is function.__code__:
            seen.append((event, frame.f_lineno - frame.f_code.co_firstlineno, tuple(frame.f_locals.get(n) for n in 'abc')))
            return trace
    sys.settrace(trace)
    try:
        result = function()
    finally:
        sys.settrace(None)
    return result, seen
show('several lines', traced, several_lines)
