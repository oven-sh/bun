# f(*a): every length up to some hundreds and around the powers of two, for each way in which the items of a list or a tuple can lie.
import functools
import math


def collect(*args):
    return args


def first_two(a=None, b=None, *rest):
    return a, b, rest


LENGTHS = [*range(0, 210), *range(254, 260), *range(510, 515), *range(1021, 1028), 2048, 4097]


class Thing:
    pass


things = [Thing() for _ in range(4100)]
KINDS = {
    'tuple': lambda n: tuple(range(n)),
    'tuple of objects': lambda n: tuple(things[:n]),
    'small ints': lambda n: list(range(n)),
    'strs': lambda n: [str(i) for i in range(n)],
    'objects': lambda n: things[:n],
    'floats': lambda n: [i + 0.5 for i in range(n)],
    'floats that are whole': lambda n: [float(i) for i in range(n)],
    'ints, then a float': lambda n: [*range(n - 1), 0.25][:n] if n else [],
    'floats, then an int': lambda n: [*(i + 0.5 for i in range(n - 1)), 7][:n] if n else [],
    'floats, then a str': lambda n: [*(i + 0.5 for i in range(n - 1)), 'end'][:n] if n else [],
    'large ints': lambda n: [2 ** 31 + i for i in range(n)],
    'larger ints': lambda n: [2 ** 70 + i for i in range(n)],
    'None': lambda n: [None] * n,
    'bools': lambda n: [i % 2 == 0 for i in range(n)],
    'grown by append': lambda n: grown(n),
    'shrunk by pop': lambda n: shrunk(n),
    'shrunk by del': lambda n: cut(n),
}


def grown(n):
    a = []
    for i in range(n):
        a.append(i)
    return a


def shrunk(n):
    a = [i + 0.5 for i in range(n + 3)]
    a.pop(), a.pop(), a.pop()
    return a


def cut(n):
    a = list(range(n + 40))
    del a[n:]
    return a


def same(got, expected):
    return len(got) == len(expected) and all(x is y or (type(x) is type(y) and x == y) for x, y in zip(got, expected))


for name, make in KINDS.items():
    wrong = []
    for n in LENGTHS:
        a = make(n)
        before = tuple(a)
        if not same(collect(*a), before):
            wrong.append((n, 'alone'))
        if not same(collect('x', *a), ('x', *before)):
            wrong.append((n, 'after one'))
        if not same(collect('x', 'y', *a, **{}), ('x', 'y', *before)):
            wrong.append((n, 'after two'))
        x, y, rest = first_two(*a)
        if not same((x, y, *rest)[:max(n, 2)], (*before, None, None)[:max(n, 2)]):
            wrong.append((n, 'into parameters'))
        if not same(functools.partial(collect, *a)(), before):
            wrong.append((n, 'to a type written in C++'))
        if not same(tuple(a), before):
            wrong.append((n, 'changed'))
    print(name, len(LENGTHS), wrong)

print('--- floats that are not numbers like others')
for n in (1, 2, 3, 50, 95, 96, 97, 98, 200, 1500):
    for special in (math.nan, math.inf, -math.inf, -0.0, 5e-324, 1.7976931348623157e308):
        for at in {0, n // 2, n - 1}:
            a = [i + 0.5 for i in range(n)]
            a[at] = special
            got = collect(*a)
            print(n, at, repr(special), len(got), repr(got[at]), got[at] is special or got[at] == special, math.copysign(1, got[at]), sum(1 for x, y in zip(got, a) if x == y))

print('--- lists that have nothing in them')
one = [1]
one.pop()
half = [1.5]
half.pop()
text = ['a']
text.clear()
EMPTY = {'[]': [], 'list()': list(), 'a comprehension': [x for x in ()], 'popped': one, 'popped, of floats': half, 'cleared': text, 'a slice': [1, 2][5:], 'a sum': [] + [],
    'a product': [1] * 0, 'sorted': sorted(()), 'split': ''.split(), 'a copy': [].copy(), 'of a generator': list(x for x in ())}
for name, a in EMPTY.items():
    for turn in range(3):
        print(name, turn, collect(*a), collect(1, *a), collect(*a, **{}), first_two(*a), first_two(1, *a, *a))
    a.append(name)
    print(name, collect(*a), collect(1, *a))
    a.pop()
    print(name, collect(*a), collect(1, *a))

print('--- one site, all kinds in turn')


def site(a):
    return collect(*a)


for turn in range(3):
    for n in (0, 1, 95, 96, 97, 300):
        print(turn, n, [len(site(make(n))) for make in KINDS.values()], [len(site(a)) for a in EMPTY.values()])
