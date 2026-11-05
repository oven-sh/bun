# for x in y: what y may be, what the loop sees when y changes under it, and what is left of the iterator afterwards.
import copy
import gc
import operator
import pickle


class ListChild(list):
    pass


class ListOwnIter(list):
    def __iter__(self):
        return iter(['own', '__iter__'])


class TupleChild(tuple):
    pass


class TupleOwnIter(tuple):
    def __iter__(self):
        return iter(('own', '__iter__'))


class TupleNoIter(tuple):
    __iter__ = None


class OnlyGetItem:
    def __getitem__(self, i):
        if i > 2:
            raise IndexError
        return i * 10


class OwnIterator:
    def __init__(self):
        self.n = 0

    def __iter__(self):
        return self

    def __next__(self):
        self.n += 1
        if self.n > 3:
            raise StopIteration
        return self.n


class IterGivesNoIterator:
    def __iter__(self):
        return 5


def generator():
    yield 'g1'
    yield 'g2'


def iterables():
    return {
        '[]': [], '[1]': [1], '[1, 2, 3]': [1, 2, 3], 'floats': [1.5, 2.5], 'ints then a str': [1, 2, 'x'], 'floats then None': [1.5, None], 'nested': [[1], (2,), {3: 4}],
        'long list': list(range(100)), '()': (), '(1,)': (1,), '(1, 2, 3)': (1, 2, 3), 'long tuple': tuple(range(100)), 'list child': ListChild([1, 2]),
        'list with __iter__': ListOwnIter([1, 2]), 'tuple child': TupleChild((1, 2)), 'tuple with __iter__': TupleOwnIter((1, 2)), 'tuple without __iter__': TupleNoIter((1, 2)),
        'iter(list)': iter([1, 2]), 'iter(tuple)': iter((1, 2)), 'iter(str)': iter('ab'), 'iter(range)': iter(range(2)), 'iter(dict)': iter({'a': 1}), 'iter(set)': iter({1}),
        'iter(bytes)': iter(b'ab'), 'iter(bytearray)': iter(bytearray(b'ab')), 'iter(callable)': iter([3, 2, 1, 0].pop, 2), 'iter(getitem)': iter(OnlyGetItem()),
        'reversed(list)': reversed([1, 2, 3]), 'reversed([])': reversed([]), 'reversed(floats)': reversed([1.5, 2.5]), 'reversed(tuple)': reversed((1, 2, 3)), 'reversed(range)': reversed(range(3)),
        'reversed(dict)': reversed({'a': 1, 'b': 2}), 'reversed(list child)': reversed(ListChild([1, 2])), 'str': 'ab', "''": '', 'bytes': b'ab', 'range': range(3), 'big range': range(2 ** 70, 2 ** 70 + 2),
        'dict': {'a': 1}, 'items': {'a': 1}.items(), 'set': {1}, 'frozenset': frozenset({1}), 'generator': generator(), 'own iterator': OwnIterator(), 'only __getitem__': OnlyGetItem(),
        'enumerate': enumerate('ab'), 'zip': zip('ab', [1, 2]), 'map': map(str, [1, 2]), 'filter': filter(None, [0, 1]), '5': 5, 'None': None, '1.5': 1.5, 'a class': list, 'a function': generator,
        '__iter__ gives no iterator': IterGivesNoIterator(),
    }


def plain(y):
    seen = []
    for x in y:
        seen.append(x)
    return seen


def with_else(y):
    seen = []
    for x in y:
        seen.append(x)
    else:
        seen.append('else')
    return seen


def with_break(y):
    seen = []
    for x in y:
        seen.append(x)
        break
    else:
        seen.append('else')
    return seen


def with_continue(y):
    seen = []
    for x in y:
        if len(seen) % 2:
            seen.append('odd')
            continue
        seen.append(x)
    return seen


def twice(y):
    seen = []
    for x in y:
        seen.append(x)
    for x in y:
        seen.append(x)
    return seen


def nested(y):
    seen = []
    for x in y:
        for z in y:
            seen.append((x, z))
    return seen[:12]


def comprehension(y):
    return [x for x in y]


def set_comprehension(y):
    return sorted(repr(x) for x in {repr(x) for x in y})


def generator_expression(y):
    return list(x for x in y)


def unpacked(y):
    seen = []
    for a, in [(x,) for x in y]:
        seen.append(a)
    return seen


def returns_from_within(y):
    for x in y:
        return x
    return 'nothing'


def in_try(y):
    seen = []
    try:
        for x in y:
            seen.append(x)
            if len(seen) == 2:
                raise ValueError('two')
    except ValueError as e:
        seen.append(str(e))
    finally:
        seen.append('finally')
    return seen


forms = [plain, with_else, with_break, with_continue, twice, nested, comprehension, set_comprehension, generator_expression, unpacked, returns_from_within, in_try]

for form in forms:
    print('---', form.__name__)
    # The same instruction sees each kind in turn, twice over.
    for turn in range(2):
        for name, y in iterables().items():
            try:
                result = repr(form(y))
            except Exception as e:
                result = type(e).__name__ + ': ' + str(e)
            if not turn or name in ('[1, 2, 3]', '(1, 2, 3)', 'reversed(list)', '5'):
                print(name, '|', result[:200])

print('--- iter(y) is y')
for name, y in iterables().items():
    try:
        i = iter(y)
    except TypeError as e:
        print(name, '|', e)
        continue
    print(name, '|', i is y, iter(i) is i, type(i).__name__)


print('--- the iterator that a loop has made, if the collector knows of one, is like any other')


def iterators_over(y):
    return [o for o in gc.get_referrers(y) if type(o) is type(iter(y))]


def met_in_a_loop(y):
    for x in y:
        return iterators_over(y)


for y in ([1, 2, 3], (1, 2, 3)):
    for o in met_in_a_loop(y):
        ours = iter(y)
        next(ours)
        facts = (type(o) is type(ours), o.__length_hint__() == ours.__length_hint__(), o.__reduce__() == ours.__reduce__(), repr(o)[:14] == repr(ours)[:14], gc.is_tracked(o) == gc.is_tracked(ours),
            gc.get_referents(o) == gc.get_referents(ours), any(o is other for other in gc.get_objects()), iter(o) is o, list(copy.copy(o)) == [2, 3], list(o) == [2, 3], list(o) == [])
        if not all(facts):
            print(facts)
    print('looked')

print('--- the list changes under the loop')


def changing(start, change):
    l = list(start)
    seen = []
    for x in l:
        seen.append(x)
        change(l, x)
        if len(seen) > 12:
            seen.append('...')
            break
    return seen, l


changes = {
    'append until 6': lambda l, x: l.append(x + 10) if len(l) < 6 else None, 'pop': lambda l, x: l.pop(), 'pop(0)': lambda l, x: l.pop(0), 'clear': lambda l, x: l.clear(),
    'insert(0)': lambda l, x: l.insert(0, 'new') if len(l) < 6 else None, 'remove itself': lambda l, x: l.remove(x), 'becomes floats': lambda l, x: l.__setitem__(slice(None), [1.5, 2.5, 3.5]),
    'becomes strs': lambda l, x: l.__setitem__(slice(None), ['a', 'b', 'c']), 'sort reversed': lambda l, x: l.sort(reverse=True), 'del last two': lambda l, x: l.__delitem__(slice(-2, None)),
    'extend by itself once': lambda l, x: l.extend(l) if len(l) < 5 else None, 'clear, then refill': lambda l, x: (l.clear(), l.extend([7, 8, 9, 10])) if x != 8 else None,
}
for name, change in changes.items():
    for start in ([1, 2, 3], [1], [1, 2, 3, 4, 5, 6, 7, 8]):
        print(name, start, '|', changing(start, change))


def changing_reversed(start, change):
    l = list(start)
    seen = []
    for x in reversed(l):
        seen.append(x)
        change(l, x)
        if len(seen) > 12:
            seen.append('...')
            break
    return seen, l


for name, change in changes.items():
    for start in ([1, 2, 3], [1], [1, 2, 3, 4, 5, 6, 7, 8]):
        print('reversed', name, start, '|', changing_reversed(start, change))

print('--- once at its end, an iterator stays there')


def drain(i):
    seen = []
    for x in i:
        seen.append(x)
    return seen


l = [1, 2]
i = iter(l)
print(drain(i), i.__length_hint__())
l.append(3)
print(drain(i), list(i), next(i, 'default'), i.__length_hint__(), i.__reduce__()[1])
i.__setstate__(0)
print(drain(i))

l = [1, 2]
i = iter(l)
print(next(i), next(i))
l.append(3)
print(drain(i), 'it had not been told that it was at its end')
l.append(4)
print(drain(i))

l = []
i = iter(l)
print(drain(i))
l.append(1)
print(drain(i))

t = (1, 2)
i = iter(t)
print(drain(i), drain(i), i.__length_hint__(), i.__reduce__()[1])
i.__setstate__(0)
print(drain(i))

l = [1, 2, 3]
r = reversed(l)
print(drain(r), drain(r), r.__length_hint__())
l.append(4)
print(drain(r), next(r, 'default'))
r.__setstate__(1)
print(drain(r), r.__reduce__()[1:])

l = [1, 2, 3, 4]
r = reversed(l)
print(next(r))
del l[1:]
print(drain(r), r.__length_hint__())
l.extend([5, 6, 7, 8])
print(drain(r))

print('--- the state of an iterator that a loop has left')
for make in (lambda: iter([1, 2, 3, 4]), lambda: iter((1, 2, 3, 4)), lambda: reversed([1, 2, 3, 4])):
    i = make()
    for x in i:
        if x in (2, 3):
            break
    print(type(i).__name__, x, i.__length_hint__(), operator.length_hint(i), i.__reduce__()[1:], list(copy.copy(i)), list(pickle.loads(pickle.dumps(i))), list(i), list(i))
    i = make()
    i.__setstate__(2)
    print(drain(i))
    i = make()
    i.__setstate__(-5)
    print(drain(i))
    i = make()
    i.__setstate__(50)
    print(drain(i))

print('--- does the iterator let go of what it went through')


class Noisy:
    def __del__(self):
        print('gone')


def holds():
    l = [Noisy()]
    i = iter(l)
    for x in i:
        pass
    del x, l
    gc.collect()
    print('after the loop')
    return i


kept = holds()
print(list(kept))

print('--- many loops, so that cells are made faster than they are collected')
total = 0
pairs = [(i, [i, i + 1]) for i in range(50)]
for turn in range(2000):
    for a, b in pairs:
        for c in b:
            total += c
        for c in (a, turn):
            total += c
print(total)

kept = []
for turn in range(20000):
    i = iter([turn, turn + 1])
    for x in i:
        break
    kept.append(i)
    j = iter((turn, turn + 1))
    for x in j:
        break
    kept.append(j)
gc.collect()
print(sum(next(i) for i in kept), len(kept))

print('--- an iterator cannot be derived from')
for y in ([], (), reversed([])):
    try:
        type('X', (type(iter(y)),), {})
        print('made')
    except TypeError as e:
        print(e)
