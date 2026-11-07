# f(x, y, *positional, **keywords): how many arguments come before the star, how many after it, where the call stands, and what else goes on meanwhile.
import functools
import sys


def fvk(*args, **kw): return (args, kw)
def f3(a, b=20, c=30): return (a, b, c)
def fko(a, *rest, k=1, **kw): return (a, rest, k, kw)


def attempt(function, *args, **kw):
    try:
        return function(*args, **kw)
    except Exception as e:
        return type(e).__name__ + ': ' + str(e)


print('--- how many before the star, how many after it')
forms = {}
for before in (0, 1, 2, 3, 4, 7, 29, 30, 31, 40):
    leading = ''.join('%d, ' % (100 + i) for i in range(before))
    names = ''.join('v%d, ' % i for i in range(before))
    scope = {}
    exec('def star(f, p, k): return f(%s*p)\n'
         'def both(f, p, k): return f(%s*p, **k)\n'
         'def only_keywords(f, p, k): return f(%s**k)\n'
         'def variables(f, p, k):\n'
         '    %s = range(%d)\n'
         '    return f(%s*p, **k)\n' % (leading, leading, leading, names.rstrip(', ') or '_', before, names) if before != 1 else
         'def star(f, p, k): return f(100, *p)\n'
         'def both(f, p, k): return f(100, *p, **k)\n'
         'def only_keywords(f, p, k): return f(100, **k)\n'
         'def variables(f, p, k):\n'
         '    v0, = range(1)\n'
         '    return f(v0, *p, **k)\n', scope)
    forms[before] = scope


def digest(result):
    if isinstance(result, str):
        return result
    args, kw = result
    return (len(args), sum(args), args[:2], args[-2:], kw)


def floats(items):
    return [i + 0.5 for i in items]


for before, scope in forms.items():
    for count in (0, 1, 2, 5):
        for make in (tuple, list, floats, iter):
            for k in ({}, {'x': 1}):
                print(before, count, make.__name__, k, *(digest(attempt(scope[name], fvk, make(range(count)), k)) for name in ('star', 'both', 'only_keywords', 'variables')))

print('--- long ones')
for count in (77, 78, 79, 80, 95, 96, 97, 98, 127, 128, 129, 130, 1023, 1024, 1025, 5000, 70000):
    for make in (tuple, list, floats, iter):
        print(count, make.__name__, digest(fvk(*make(range(count)))), digest(fvk(7, *make(range(count)), **{})), digest(fvk(7, 8, *make(range(count)), **{'x': 1})),
            attempt(f3, *make(range(count)))[:60], len(attempt(max, *make(range(count)), key=lambda v: -v).__repr__()))

print('--- floats of every sort, in a list that may have them as doubles in a row: each comes through as itself')
import math, struct
sorts = [1.5, -1.5, 0.0, -0.0, 2.0, -3.0, 1e308, 5e-324, 2.2250738585072014e-308, math.inf, -math.inf, math.nan, -math.nan, struct.unpack('<d', bytes.fromhex('010000000000f87f'))[0],
         struct.unpack('<d', bytes.fromhex('ffffffffffffffff'))[0], float(2 ** 53), 4294967296.5]
bits = lambda items: [(type(x).__name__, struct.pack('<d', x).hex()) for x in items]
for special in sorts:
    for place in (0, 1, 2):
        l = [0.5, 1.5, 2.5]
        built = [x for x in l]
        built[place] = special
        display = [special if i == place else i + 0.5 for i in range(3)]
        appended = []
        for x in display:
            appended.append(x)
        for name, made in (('stored', built), ('comprehension', display), ('appended', appended)):
            want = bits(made[i] for i in range(3))
            print(repr(special), place, name, bits(fvk(*made)[0]) == want, bits(fvk(7.5, *made)[0][1:]) == want, bits(fvk(*made, **{})[0]) == want, bits(f3(*made)) == want, bits(tuple(made)) == want, bits([*made]) == want)

print('--- the result goes where an operand was')


def into_operands():
    a, k, f = (1, 2), {'c': 3}, f3
    a = f(*a)
    print(a)
    a = f(*a)
    print(a)
    k = f(0, **k)
    print(k)
    k = {'c': 3}
    a = k = f(*a[:2], **k)
    print(a, k)
    f = f(*a)
    print(f)
    x = 5
    x = f3(x, *(x, x))
    print(x)
    x = f3(x, x, *(), **{})
    print(x)


into_operands()

print('--- a call in a call')
print(fvk(*fvk(*fvk(1, *(2, 3))[0], **{'a': 1})[0], **fvk(**{'b': 2})[1]))
print(fvk(fvk(*(1,)), *fvk(*(2,)), **fvk(**{'c': fvk(*(3,), **{'d': 4})})[1]))
print(fvk(1, fvk(2, *(3,)), *(4, fvk(5, *(6,), **{}))))
print([fvk(i, *(i,) * i) for i in range(4)], {i: fvk(*(i,), **{'k': i}) for i in range(2)})

print('--- who is called')


class Plain:
    def __init__(self, *args, **kw): self.got = (args, kw)
    def method(self, *args, **kw): return ('method', args, kw)
    @classmethod
    def of_class(cls, *args, **kw): return ('of_class', cls.__name__, args, kw)
    @staticmethod
    def static(*args, **kw): return ('static', args, kw)
    def __call__(self, *args, **kw): return ('__call__', args, kw)


class Child(Plain):
    def __init__(self, *args, **kw): super().__init__('child', *args, **kw)
    def method(self, *args, **kw): return super().method('child', *args, **kw)
    @classmethod
    def of_class(cls, *args, **kw): return super().of_class('child', *args, **kw)


class Slotted:
    __slots__ = ('a', 'b')
    def __init__(self, a, b=2): self.a, self.b = a, b


def generator(*args, **kw):
    yield args
    yield kw


async def coroutine(*args, **kw):
    return (args, kw)


def run(c):
    try:
        c.send(None)
    except StopIteration as e:
        return e.value


p, k, e = (1, 2), {'x': 3}, {}
o, c = Plain(), Child()
for turn in range(3):
    print(Plain(*p).got, Plain(*p, **k).got, Plain(0, *p, **e).got, Child(*p, **k).got, Child(0, **k).got)
    print(o.method(*p), o.method(*p, **k), o.method(0, *p, **e), c.method(*p, **k), Plain.method(o, *p), Plain.method(*(o,), **k))
    print(o.of_class(*p), Plain.of_class(*p, **k), c.of_class(0, *p), Child.of_class(**k), o.static(*p, **k), Plain.static(0, *p))
    print(o(*p), o(*p, **k), o(0, *p, **e), c(**k))
    bound = o.method
    print(bound(*p), bound(*p, **k), bound(0, *p, **e), functools.partial(fvk, 9, y=8)(*p, **k), functools.partial(bound, 9)(0, *p))
    print(list(generator(*p, **k)), list(generator(0, *p)), run(coroutine(*p, **k)), run(coroutine(0, **e)))
    print((lambda *a, **kw: (a, kw))(*p, **k), (lambda a, b: a + b)(*p), Slotted(*p).b, Slotted(*(1,)).b, Slotted(**{'a': 1}).b)
    print(len(*('abc',)), divmod(*(7, 2)), divmod(7, *(2,)), sorted(*([3, 1, 2],), **{'reverse': True}), int(*('11',), **{'base': 2}), dict(*([(1, 2)],), **k), str(*(), **e),
        '{} {x}'.format(*(1,), **k), [].__class__(*((1, 2),)), type(*('T', (), {})).__name__, isinstance(*(1, int)), getattr(*(o, 'nothing', 'default')))
    print(attempt(lambda: None(*p)), attempt(lambda: 5(*p, **k)), attempt(lambda: 'text'(0, *p)), attempt(lambda: o.nothing(*p)), attempt(lambda: Slotted(*p, **{'a': 1})),
        attempt(lambda: len(*p)), attempt(lambda: len(*('a',), **k)), attempt(lambda: Slotted(*(1, 2, 3))))

print('--- class statements')


class Meta(type):
    def __new__(meta, name, bases, namespace, **kw):
        cls = super().__new__(meta, name, bases, namespace)
        cls.kw = kw
        return cls

    def __init__(cls, name, bases, namespace, **kw):
        pass


bases, options = (Plain, ), {'metaclass': Meta, 'option': 1}
class A(*bases): pass
class B(*bases, **options): pass
class C(Plain, *(), **options): pass
class D(*bases, metaclass=Meta, other=2): pass
class E(**options): pass
print(A.__mro__, B.__mro__, B.kw, C.__mro__, C.kw, D.kw, E.__mro__, E.kw)

print('--- a generator is put aside in the middle of the arguments')


def halting():
    result = fvk((yield 'first'), *(yield 'star'), **(yield 'stars'))
    yield result
    result = fvk((yield 'a'), (yield 'b'), *(1, 2), **(yield 'c'))
    yield result
    result = fvk(*(yield 'only star'))
    yield result
    result = fvk(1, *iter((2, 3)), x=(yield 'keyword'), **{'y': (yield 'in the dict')})
    yield result
    result = fvk(*(yield 'p'), *(yield 'q'), (yield 'r'))
    yield result


def drive(g, values):
    values = iter(values)
    got = [next(g)]
    while True:
        try:
            got.append(g.send(next(values, None)))
        except StopIteration:
            return got


print(drive(halting(), [10, (11, 12), {'z': 13}, None, 20, 21, {'w': 22}, None, [30, 31], None, 40, 41, None, (50,), [51], 52]))
two = halting(), halting()
print([next(g) for g in two], [g.send(i) for i, g in enumerate(two)], [g.send((i, i)) for i, g in enumerate(two)], [g.send({'n': i}) for i, g in enumerate(two)])


async def awaiting():
    class Later:
        def __init__(self, value): self.value = value
        def __await__(self):
            yield self.value
            return self.value
    return fvk(await Later(1), *await Later((2, 3)), **await Later({'x': 4}))


c = awaiting()
print(c.send(None), c.send(None), c.send(None), run(c))

print('--- what is raised on the way, and what is still done then')
events = []


def note(what, value=None):
    events.append(what)
    return value


def raising(what):
    events.append(what)
    raise LookupError(what)


def halfway(*values):
    for value in values:
        events.append('item %r' % (value,))
        yield value
    raising('the iterable')


class Mapping:
    def __init__(self, *names, fails_at=None): self.names, self.fails_at = names, fails_at
    def __repr__(self): return 'Mapping%r' % (self.names,)
    def keys(self):
        events.append('keys')
        return iter(self.names)
    def __getitem__(self, name):
        events.append('item of %r' % (name,))
        if name == self.fails_at:
            raise LookupError('the mapping')
        return name


for text in (
        "fvk(*halfway(1, 2))", "fvk(note('x'), *halfway(1))", "fvk(*halfway(1), **note('k', {}))", "fvk(*halfway(1), **Mapping('a'))", "fvk(note('x'), *halfway(1), **note('k', Mapping('a')))",
        "fvk(*note('p', (1,)), **Mapping('a', 'b', fails_at='b'))", "fvk(*halfway(1), **Mapping('a', fails_at='a'))", "fvk(note('x'), *halfway(1), **Mapping('a', fails_at='a'))",
        "fvk(*halfway(1), **{1: 2})", "fvk(*note('p', ()), **{1: 2})", "fvk(*iter((1,)), **{1: 2})", "fvk(*iter((1,)), **Mapping(1))", "fvk(**Mapping('a', 'a'))", "fvk(a=1, **Mapping('a'))",
        "fvk(**{'a': 1}, **Mapping('a'))", "fvk(**Mapping('a'), **Mapping('b', 'a'))", "f3(*(1,), **Mapping('a'))", "f3(1, *iter(()), **Mapping('a'))", "f3(*halfway(), **Mapping('a'))",
        "fvk(*halfway(1), x=note('x'))", "fvk(*note('p', (1,)), x=raising('x'), **note('k', {}))", "fvk(*note('p', 5), x=note('x'))", "fvk(note('x'), *note('p', 5), y=note('y'))",
        "fvk(*note('p', 5), *note('q', 6))", "fvk(*note('p', ()), **note('k', 5))", "fvk(*note('p', 5), **note('k', 5))", "fvk(note('x'), *note('p', 5), **note('k', 5))",
        "note('f')(*halfway(1), **Mapping('a'))", "note('f')(note('x'), *note('p', (1,)), **Mapping('a'))", "raising('f')(*note('p', ()))", "fvk(raising('x'), *note('p', ()))",
        "len(*halfway('a'))", "len(*iter(('a',)), **Mapping('a'))", "dict(**Mapping('a', 'b'))", "dict(*halfway(), **Mapping('a'))", "Plain(*halfway(1), **Mapping('a'))"):
    events.clear()
    print(text, '|', attempt(eval, text), '|', events)

print('--- what is after one star is changed while what is after the other is read')


class Changing:
    def __init__(self, target): self.target = target
    def __repr__(self): return 'Changing()'
    def keys(self):
        self.target.append('added by keys()')
        return ['x']
    def __getitem__(self, name):
        self.target.append('added by __getitem__()')
        return 1


def grows(the_dict, the_list):
    yield 1
    the_dict['late'] = 1
    the_list.append('late')
    yield 2


for turn in range(2):
    l = [0]
    print(fvk(*l, **Changing(l)), l)
    l = [0]
    print(fvk(9, *l, **Changing(l)), l)
    l = [0]
    print(fvk(*l, y=2, **Changing(l)), l)
    l = [0]
    print(fvk(*l, *l, **Changing(l)), l)
    d, l = {'x': 1}, [0]
    print(fvk(*grows(d, l), **d), d)
    d, l = {'x': 1}, [0]
    print(fvk(*l, *grows(d, l), **d), d, l)
    d, l = {'x': 1}, [0]
    print(fvk(9, *grows(d, l), **d), d)

print('--- the same where all are variables of a function')


def one_line(f, l, m): return f(9, *l, **m)
def one_line_keyword(f, l, m): return f(9, *l, x=m)
def one_line_constant(f, l, m): return f(9, *l, x=1)
def one_line_both(f, l, m): return f(9, *l, y=2, **m)
def one_line_no_leading(f, l, m): return f(*l, **m)
def several_lines(f, l, m):
    return f(9,
        *l,
        **m)
def of_a_closure(f, l, m):
    def inner(): return f(9, *l, **m)
    return inner()
def maybe_unbound(f, l, m, bind=True):
    if bind:
        n = m
    return f(9, *l, **n)
def deleted(f, l, m, really=False):
    if really:
        del m
    return f(9, *l, **m)
def assigned_on_the_way(f, l, m): return f(9, *(l := list(l) + ['new']), **m), l


local_forms = (one_line, one_line_keyword, one_line_constant, one_line_both, one_line_no_leading, several_lines, of_a_closure, maybe_unbound, deleted, assigned_on_the_way)
for form in local_forms:
    for turn in range(2):
        l = [0]
        print(form.__name__, 'list, mapping that changes it', attempt(form, fvk, l, Changing(l)), l)
        l = [0]
        print(form.__name__, 'list, dict', attempt(form, fvk, l, {'z': 1}), attempt(form, fvk, l, {}), attempt(form, fvk, (0,), {}), attempt(form, fvk, (), {'z': 1}), l)
        d, l = {'z': 1}, [0]
        print(form.__name__, 'generator that changes the dict', attempt(form, fvk, grows(d, l), d), d)
        events.clear()
        print(form.__name__, 'in which order', attempt(form, fvk, halfway(1), Mapping('a')), events)
        events.clear()
        print(form.__name__, 'in which order', attempt(form, fvk, iter((1,)), Mapping('a', fails_at='a')), events)
        events.clear()
        print(form.__name__, 'neither', attempt(form, fvk, 5, 6), attempt(form, fvk, (), 6), attempt(form, fvk, 5, {}), attempt(form, fvk, [1], {1: 2}), attempt(form, f3, [1], {'a': 2}))
for turn in range(2):
    events.clear()
    print(attempt(maybe_unbound, fvk, halfway(1), {}, False), events)
    events.clear()
    print(attempt(deleted, fvk, halfway(1), {}, True), events)
    events.clear()
    print(attempt(maybe_unbound, fvk, iter((note('made'),)), {}, False), attempt(deleted, fvk, [1], {}, True), events)

print('--- who is asked how long it is')


class Sized:
    def __init__(self, *items, length=None, hint=None): self.items, self.length, self.hint = items, length, hint
    def __iter__(self):
        events.append('iter')
        return iter(self.items)
    def __len__(self):
        events.append('len')
        if isinstance(self.length, Exception):
            raise self.length
        return len(self.items) if self.length is None else self.length


class Hinting:
    def __init__(self, *items, hint=None): self.items, self.hint = items, hint
    def __iter__(self):
        events.append('iter')
        return self
    def __next__(self):
        if not self.items:
            raise StopIteration
        first, *self.items = self.items
        return first
    def __length_hint__(self):
        events.append('hint')
        if isinstance(self.hint, Exception):
            raise self.hint
        return len(self.items) if self.hint is None else self.hint


def sized_star(f, p, k): return f(*p)
def sized_leading(f, p, k): return f(0, *p)
def sized_both(f, p, k): return f(*p, **k)
def sized_leading_both(f, p, k): return f(0, *p, **k)
def sized_leading_keyword(f, p, k): return f(0, *p, x=k)
def sized_leading_call(f, p, k): return f(0, *p, x=len(k))
def sized_two(f, p, k): return f(*p, *p)
def sized_then_one(f, p, k): return f(*p, 0)


for form in (sized_star, sized_leading, sized_both, sized_leading_both, sized_leading_keyword, sized_leading_call, sized_two, sized_then_one):
    for make in (lambda: Sized(1, 2), lambda: Sized(1, 2, length=0), lambda: Sized(1, 2, length=100), lambda: Sized(1, length=ValueError('len')), lambda: Sized(1, length=TypeError('len')),
            lambda: Sized(1, length=-1), lambda: Sized(1, length='x'), lambda: Hinting(1, 2), lambda: Hinting(1, hint=ValueError('hint')), lambda: Hinting(1, hint=TypeError('hint')),
            lambda: Hinting(1, hint=NotImplemented), lambda: Hinting(1, hint=-1)):
        for k in ({}, {'z': 1}):
            events.clear()
            print(form.__name__, attempt(form, fvk, make(), k), events)

print('--- what is gone through changes the variables of the caller')


class Rebinding:
    def __init__(self, **values): self.values = values
    def __iter__(self):
        sys._getframe(1).f_locals.update(self.values)
        return iter((1,))


def rebinds_keyword():
    v, a = 'old', Rebinding(v='new')
    return fvk(0, *a, k=v)
def rebinds_keyword_no_leading():
    v, a = 'old', Rebinding(v='new')
    return fvk(*a, k=v)
def rebinds_mapping():
    k, a = {'old': 1}, Rebinding(k={'new': 1})
    return fvk(0, *a, **k)
def rebinds_mapping_no_leading():
    k, a = {'old': 1}, Rebinding(k={'new': 1})
    return fvk(*a, **k)
def rebinds_itself():
    a = Rebinding(a=(7,))
    return fvk(0, *a, **{}), a
def rebinds_the_function():
    f, a = fvk, Rebinding(f=f3)
    return f(0, *a)
def rebinds_what_is_before():
    x, a = 'old', Rebinding(x='new')
    return fvk(x, *a), x


for function in (rebinds_keyword, rebinds_keyword_no_leading, rebinds_mapping, rebinds_mapping_no_leading, rebinds_itself, rebinds_the_function, rebinds_what_is_before):
    print(function.__name__, function(), function())

print('--- the callee changes what it was given')


def greedy(*args, **kw):
    source_list.clear()
    source_dict.clear()
    return (args, kw)


source_list, source_dict = [1, 2, 3], {'x': 1}
print(greedy(*source_list, **source_dict), source_list, source_dict)
source_list, source_dict = [1, 2, 3], {'x': 1}
print(greedy(0, *source_list, **source_dict), source_list, source_dict)

print('--- as deep as it goes')
# (CPython 3.15 counts the frame of a call with a star but does not look at the count there, so every second call here has none.)


def deeper(n, *args, **kw):
    global deepest
    deepest = n
    return plainly(n, args, kw)


def plainly(n, args, kw):
    return deeper(n + 1, *args, **kw)


def count_down(n, *args, **kw):
    return n and count_down(n - 1, *args, **kw)


limit = sys.getrecursionlimit()
sys.setrecursionlimit(400)
for args, kw in (((), {}), ((1, 2), {}), ((1,), {'x': 1}), (tuple(range(100)), {})):
    for turn in range(2):
        try:
            deeper(0, *args, **kw)
        except RecursionError as e:
            print(type(e).__name__, deepest)
print(count_down(300, 1, 2, x=3), count_down(*(300,)), count_down(300, *range(100)))
sys.setrecursionlimit(limit)

print('--- frames and tracebacks')


def who(*args, **kw):
    frame = sys._getframe()
    return (frame.f_code.co_name, frame.f_back.f_code.co_name, frame.f_back.f_lineno - frame.f_back.f_code.co_firstlineno, sorted(frame.f_locals))


def calls_who(p, k):
    return (who(*p),
        who(*p, **k),
        who(1,
            *p),
        who(**k))


print(calls_who((1,), {'x': 1}), calls_who([], {}))


def fails(*args, **kw):
    raise ValueError(args, kw)


def calls_fails(p, k):
    return fails(
        0,
        *p,
        **k)


try:
    calls_fails((1,), {'x': 2})
except ValueError as e:
    tb, lines = e.__traceback__, []
    while tb:
        lines.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno))
        tb = tb.tb_next
    print(e, lines)

for p, k in ((5, {}), ((), 5), ((), {1: 2}), ((1, 2, 3, 4), {})):
    try:
        (lambda p, k: f3(
            *p,
            **k))(p, k)
    except TypeError as e:
        tb = e.__traceback__
        while tb.tb_next:
            tb = tb.tb_next
        print(e, tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno)

print('--- in try, with and loops')


def guarded(p, k):
    out = []
    for i in range(3):
        try:
            out.append(f3(i, *p, **k))
        except TypeError as e:
            out.append(str(e))
            continue
        finally:
            out.append(fvk(*p[:1], **{}))
    return out


print(guarded((1,), {'c': 2}), guarded((1, 2, 3), {}), guarded((), {'a': 1}))

print('--- more arguments than any call here takes, and after the ** what no call takes')
endless = [0] * 1100000
for k in (5, 'abc', None, [1], {1: 2}, 2.5, object()):
    for call in (lambda: fvk(*endless, **k), lambda: fvk(0, *endless, **k), lambda: len(*endless, **k)):
        try:
            call()
            print('taken')
        except (TypeError, RecursionError):
            print('refused', end=' ')
    print()
