# Containers are dropped and gc.collect() is called: the finalizers of what each of them held are called in the order in which the container lets go of its items. Each kind with 2 to 24, 33 and 40
# items; some were made before the last collection, some since (what a container has left behind while it grew is still there then).
import collections
import functools
import gc
import types


class A:
    def __init__(self, log, n):
        self.log = log
        self.n = n

    def __del__(self):
        self.log.append(self.n)


class Hashed(A):
    def __hash__(self):
        return self.n * 7

    def __eq__(self, other):
        return self is other


class Owner:
    pass


class OwnerOfDict(dict):
    pass


def attributes(n, A):
    o = Owner()
    for i in range(n):
        setattr(o, 'x%d' % i, A(i))
    return o


def attributes_in_a_dict(n, A):
    o = attributes(n, A)
    o.__dict__
    return o


def attributes_some_deleted(n, A):
    o = Owner()
    for i in range(n):
        setattr(o, 'x%d' % i, A(i))
        setattr(o, 'y%d' % i, None)
    for i in range(n):
        delattr(o, 'y%d' % i)
    return o


def attributes_and_items(n, A):
    o = OwnerOfDict()
    for i in range(n):
        o[i] = A(2 * i)
        setattr(o, 'x%d' % i, A(2 * i + 1))
    return o


def dict_in_another_order(n, A):
    items = [A(i) for i in range(n)]
    return {i: items[i] for i in reversed(range(n))}


def dict_some_deleted(n, A):
    d = {}
    for i in range(n):
        d[i] = A(i)
        d[-1 - i] = None
    for i in range(n):
        del d[-1 - i]
    return d


def dict_made_at_once(n, A):
    return dict.fromkeys(range(n)) | {i: A(i) for i in range(n)}


def deque_from_the_left(n, A):
    d = collections.deque()
    for i in range(n):
        d.appendleft(A(i))
    return d


def deque_as_a_queue(n, A):
    # What comes out at the left is None: an item that leaves before the deque is dropped has an order of its own.
    d = collections.deque(None for i in range(n))
    for i in range(n):
        d.append(A(i))
        d.popleft()
    return d


def deque_rotated(n, A):
    d = collections.deque(A(i) for i in range(n))
    d.rotate(n // 3)
    return d


def deque_with_a_bound(n, A):
    d = collections.deque((None for i in range(n + 3)), n)
    for i in range(n):
        d.append(A(i))
    return d


def deque_that_has_shrunk(n, A):
    d = collections.deque(None for i in range(600))
    d.extend(A(i) for i in range(n))
    for i in range(600):
        d.popleft()
    return d


def closure(n, A):
    ns = {'A': A}
    exec('def mk():\n' + ''.join('    v%d = A(%d)\n' % (i, i) for i in range(n)) + '    return lambda: (' + ''.join('v%d, ' % i for i in range(n)) + ')\n', ns)
    return ns['mk']()


def generator(n, A):
    ns = {'A': A}
    exec('def g():\n' + ''.join('    v%d = A(%d)\n' % (i, i) for i in range(n)) + '    yield\n', ns)
    x = ns['g']()
    next(x)
    return x


# An exception lets go of the fields of its own type, of its attributes, of its arguments (a tuple: from the end), of its cause and of its context. The numbers are such that this is forwards.
def exception(n, A, make=ValueError, *fields, first=0):
    # (Written out, and no more than eight: a list of the arguments, or a dict of the keywords, would be a second holder of them, dropped at another time.)
    m = min(n, 8)
    first += len(fields)
    arguments = ['A(%d)' % (first + n + m - 1 - i) for i in range(m)] + ['%s=A(%d)' % (name, i) for i, name in enumerate(fields)]
    e = eval('make(%s)' % ', '.join(arguments), {'make': make, 'A': A})
    for i in range(n):
        setattr(e, 'x%d' % i, A(first + i))
    return e


def exception_with_cause_and_context(n, A):
    e = exception(n, A)
    e.__cause__ = KeyError(A(2 * n))
    e.__context__ = IndexError(A(2 * n + 1))  # (2 * n is beyond the arguments' numbers, however many there are.)
    return e


def stop_iteration(n, A):
    e = exception(n, A, StopIteration, first=1)
    e.value = A(0)
    return e


def system_exit(n, A):
    e = exception(n, A, SystemExit, first=1)
    e.code = A(0)
    return e


class Error(LookupError):
    pass


KINDS = [
    ('list', lambda n, A: [A(i) for i in range(n)]),
    ('tuple', lambda n, A: tuple(A(i) for i in range(n))),
    ('values of a dict', lambda n, A: {i: A(i) for i in range(n)}),
    ('keys of a dict', lambda n, A: {A(i): i for i in range(n)}),
    ('keys and values', lambda n, A: {A(2 * i): A(2 * i + 1) for i in range(n)}),
    ('a dict with str keys', lambda n, A: {'k%d' % i: A(i) for i in range(n)}),
    ('a dict filled in another order than its values were made', dict_in_another_order),
    ('a dict from which as many items were deleted', dict_some_deleted),
    ('a dict made of two', dict_made_at_once),
    ('a copy of a dict', lambda n, A: {i: A(i) for i in range(n)}.copy()),
    ('defaultdict', lambda n, A: collections.defaultdict(int, {i: A(i) for i in range(n)})),
    ('OrderedDict', lambda n, A: collections.OrderedDict((i, A(i)) for i in range(n))),
    ('keywords of a partial', lambda n, A: functools.partial(print, **{'k%d' % i: A(i) for i in range(n)})),
    ('SimpleNamespace', lambda n, A: types.SimpleNamespace(**{'k%d' % i: A(i) for i in range(n)})),
    ('set', lambda n, A: {A(i, Hashed) for i in range(n)}),
    ('frozenset', lambda n, A: frozenset(A(i, Hashed) for i in range(n))),
    ('deque', lambda n, A: collections.deque(A(i) for i in range(n))),
    ('a deque filled from the left', deque_from_the_left),
    ('a deque that was a queue', deque_as_a_queue),
    ('a deque that was rotated', deque_rotated),
    ('a deque with a bound', deque_with_a_bound),
    ('a deque that has shrunk', deque_that_has_shrunk),
    ('attributes', attributes),
    ('attributes in a __dict__', attributes_in_a_dict),
    ('attributes, as many deleted', attributes_some_deleted),
    ('attributes and items of an instance of a class derived from dict', attributes_and_items),
    ('arguments of an exception', lambda n, A: eval('ValueError(%s)' % ''.join('A(%d), ' % i for i in range(n)), {'A': A})),
    ('attributes and arguments of an exception', exception),
    ('the same of a class of the program', lambda n, A: exception(n, A, Error)),
    ('the same, a cause and a context', exception_with_cause_and_context),
    ('obj and name of an AttributeError, attributes, arguments', lambda n, A: exception(n, A, AttributeError, 'obj', 'name')),
    ('name of a NameError, attributes, arguments', lambda n, A: exception(n, A, NameError, 'name')),
    ('name, path and name_from of an ImportError, attributes, arguments', lambda n, A: exception(n, A, ImportError, 'name', 'path', 'name_from')),
    ('value of a StopIteration, attributes, arguments', stop_iteration),
    ('code of a SystemExit, attributes, arguments', system_exit),
    ('cells of a closure', closure),
    ('variables of a suspended generator', generator),
]


def spans(sizes):
    out = []
    for n in sizes:
        if out and out[-1][1] == n - 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return ', '.join('%d' % a if a == b else '%d to %d' % (a, b) for a, b in out)


SIZES = list(range(2, 25)) + [33, 40]


def made(make):
    logs = {}
    containers = []
    for n in SIZES:
        log = logs[n] = []
        containers.append(make(n, lambda i, cls=A, log=log: cls(log, i)))
        del log[:]
    return logs, containers


for name, make in KINDS:
    gc.collect()
    early, a = made(make)
    gc.collect()
    late, b = made(make)
    del a, b
    gc.collect()
    for when, logs in ('made before the last collection', early), ('made since', late):
        orders = {}
        for n, got in logs.items():
            kind = 'forwards' if got == sorted(got) else 'backwards' if got == sorted(got, reverse=True) else 'another order'
            orders.setdefault(kind, []).append(n)
        print('%s, %s: %s' % (name, when, '; '.join('%s with %s' % (kind, spans(sizes)) for kind, sizes in sorted(orders.items()))))
        for n in orders.get('another order', []):
            print('   ', *logs[n])


# What is dropped beside a container that is emptied, or that something is taken out of. The table that the container leaves behind is not to go in front of the rest.
def dict_cleared(A):
    x = A('x')
    d = {'k': A('k')}
    del x
    d.clear()
    return d


def set_cleared(A):
    x = A('x')
    s = {A('k')}
    del x
    s.clear()
    return s


def removed_from_a_dict_that_has_grown(A):
    x = A('x')
    d = {i: A(i) for i in range(12)}
    del x
    del d[3]
    del d[7]
    return d


def popped_from_a_dict_that_has_grown(A):
    x = A('x')
    d = {}
    for i in range(12):
        d[i] = A(i)
    y = A('y')
    del x
    d.pop(0)
    del y
    return d


def dict_cleared_and_filled_again(A):
    x = A('x')
    d = {1: A('a')}
    del x
    d.clear()
    d[2] = A('kept')
    return d


def list_dropped_and_dict_cleared(A):
    items = [A('l0'), A('l1')]
    d = {0: A('d0'), 1: A('d1')}
    del items
    d.clear()
    return d


def dict_dropped_and_dict_cleared(A):
    whole = {0: A('w0'), 1: A('w1')}
    d = {0: A('d0'), 1: A('d1')}
    del whole
    d.clear()
    return d


def dict_that_has_grown_dropped(A):
    x = A('x')
    d = {i: A(i) for i in range(12)}
    del x
    del d


for scene in (dict_cleared, set_cleared, removed_from_a_dict_that_has_grown, popped_from_a_dict_that_has_grown, dict_cleared_and_filled_again, list_dropped_and_dict_cleared,
              dict_dropped_and_dict_cleared, dict_that_has_grown_dropped):
    gc.collect()
    log = []
    kept = scene(lambda n: A(log, n))
    gc.collect()
    gc.collect()
    print('%s: %s' % (scene.__name__, ' '.join(map(str, log))))
    del kept


# The same with files, whose finalizer warns: the first is dropped where the name gets the second, the second where the namespace is cleared.
def two_files():
    import os, tempfile, warnings
    with tempfile.TemporaryDirectory() as directory:
        names = {name: os.path.join(directory, name) for name in 'pq'}
        for path in names.values():
            with open(path, 'w') as file:
                file.write('\n')
        for how in ('clear', 'del'):
            gc.collect()
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                namespace = dict(names)
                exec('x = open(p); x = open(q)', namespace)
                if how == 'clear':
                    namespace.clear()
                del namespace
                gc.collect()
                gc.collect()
            # "unclosed file <_io.TextIOWrapper name='.../p' mode='r' encoding='utf-8'>"
            print('two files, the namespace goes by %s: %s' % (how, ' '.join(str(warning.message).split("' mode=")[0][-1] for warning in caught)))


two_files()

