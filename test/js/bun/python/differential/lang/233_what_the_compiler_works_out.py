# Operations on constants, and lists and sets of constants that are only searched or iterated over: what they give, what co_consts shows,
# and that nothing of it can be told from working it out when the code is run.
import sys


def consts(f):
    return tuple(c for c in f.__code__.co_consts if not hasattr(c, 'co_code'))


def show(f, *args):
    try:
        result = f(*args)
    except Exception as e:
        result = type(e).__name__
    print(f.__name__, repr(result), consts(f))


print('--- operations')


def seconds(): return 60 * 60 * 24
def partly(x): return 60 * 60 * x
def not_from_the_right(x): return x * 60 * 60
def power(): return 2 ** 10, 2 ** 100, 2 ** -1, 2 ** 0.5, (-2) ** 3, -2 ** 2
def too_large(): return 2 ** 200, 1 << 200, 3 ** 100
def text(): return '-' * 20, 'a' + 'b', b'x' * 3, 'ab' * 0, 3 * 'ab'
def long_text(): return len('-' * 5000), len('ab' * 2048), len('ab' * 2049)
def fails(): return 1 / 0
def fails_too(): return 1 % 0
def fails_with_types(): return 'a' + 1
def formats(): return '%d' % 3
def floats(): return 0.1 + 0.2, 1e308 * 10, -0.0, 0.0 * -1, 1 / 3, 7 // 2, 7 % 3, -7 // 2, 7.5 // 2
def complexes(): return 1 + 2j, 1 - 2j, (1 + 2j) * 2, 2j ** 2, -1j
def bits(): return 6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 4, 256 >> 4, -True, +True, not 1, not 0, not ''
def booleans(): return True + True, True * 3, False or 3, True and 4
def nested(): return (1 + 2) * (3 + 4), -(1 + 2), ~(1 << 3), 2 * (3 + (4 * 5))
def matmul(): return 1 @ 2
def small_and_large(): return 255 + 1, 128 + 127, 1 - 1, 0 - 1, 300 - 45


for f in (seconds, power, too_large, text, long_text, fails, fails_too, fails_with_types, formats, floats, complexes, bits, booleans, nested, matmul, small_and_large):
    show(f)
show(partly, 2)
show(not_from_the_right, 2)
print([type(v).__name__ for v in power() + floats() + bits() + booleans()])
print(str(floats()[2]), str(floats()[3]))

print('--- tuples')


def plain(): return (1, 2, 3)
def of_tuples(): return ((1, 2), (3, (4, 5)), ())
def with_operations(): return (1 + 1, 'a' * 2, -3, (2 ** 3,))
def not_constant(x): return (1, x, 3)
def with_names(): return (None, True, False, ..., 'x', b'y', 1.5, 2j)
def defaults(a=1, b=(2, 3), c=None, d=-1, e=2 * 3): return a, b, c, d, e
def empty(): return ()


for f in (plain, of_tuples, with_operations, with_names, defaults, empty):
    show(f)
show(not_constant, 2)
print(plain() is plain(), of_tuples() is of_tuples(), with_operations() is with_operations(), not_constant(1) is not_constant(1), defaults.__defaults__)


def make():
    def inner(a=(1, 2), b=3): pass
    return inner


print(make().__defaults__ is make().__defaults__, consts(make))

print('--- searched')


def in_list(x): return x in [1, 2, 3]
def in_set(x): return x in {1, 2, 3}
def in_tuple(x): return x in (1, 2, 3)
def not_in_list(x): return x not in ['a', 'b']
def in_short_set(x): return x in {1}
def in_set_of_equals(x): return x in {1, 1.0, True}
def in_list_of_names(x, y): return x in [y, 2]
def in_set_of_names(x, y): return x in {y, 2}
def in_starred(x, y): return x in [*y, 2]
def in_empty(x): return x in [], x in ()
def in_test(x):
    if x in [1, 2]:
        return 'list'
    if x in {3, 4}:
        return 'set'
    if x not in {5, 6}:
        return 'neither'
    return 'last'
def equal_to_list(x): return x == [1, 2, 3], x != [1, 2, 3], [1, 2, 3] == x
def chained(x): return 0 < x in [1, 2, 3], x in [1, 2, 3] in [True], x in [[1, 2, 3]] == [[1, 2, 3]]
def in_operations(x): return x in [1 + 1, 2 * 3]
def in_nested(x): return x in [(1, 2), (3, 4)], x in {(1, 2), (3, 4)}
def in_unhashable(x): return x in {[1], 2}
def in_many(x): return x in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]


for f in (in_list, in_set, in_tuple, not_in_list, in_short_set, in_set_of_equals, in_empty, in_test, in_operations, in_many):
    for x in (1, 2.0, 'a', 5, 7):
        show(f, x)
for f in (in_list_of_names, in_set_of_names):
    show(f, 1, 1)
    show(f, 3, 1)
show(in_starred, 1, (1,))
print(equal_to_list([1, 2, 3]), equal_to_list((1, 2, 3)))
print('abc'[1], (1, 2, 3)[0], 'abc'[1:], b'abc'[0])
show(chained, 1)
show(in_nested, (1, 2))
show(in_unhashable, 2)
show(in_set, [1])
show(in_set, {1})
show(in_set, frozenset({1}))


class Odd:
    def __eq__(self, other):
        print('   compared with', repr(other))
        return False

    def __hash__(self):
        return 1


show(in_list, Odd())
show(in_set, Odd())

print('--- iterated over')


def over_list(): return [x for x in [1, 2, 3]]
def over_set(): return sorted(x for x in {3, 1, 2})
def loop_over_list():
    out = []
    for x in [1, 2, 3]:
        out.append(x)
    return out
def loop_over_set():
    out = []
    for x in {'a'}:
        out.append(x)
    return out
def loop_over_names(a, b):
    out = []
    for x in [a, b]:
        out.append(x)
        a = b = None
    return out
def loop_over_starred(a):
    return [x for x in [*a, 1]]
def loop_over_list_of_lists():
    out = []
    for x in [[], []]:
        x.append(1)
        out.append(x)
    return out
def order_of_evaluation():
    seen = []
    def note(x):
        seen.append(x)
        return x
    for x in [note(1), note(2)]:
        seen.append(('loop', x))
    return seen


for f in (over_set, loop_over_list, loop_over_set, loop_over_list_of_lists, order_of_evaluation):
    show(f)
print(over_list())
show(loop_over_names, 1, 2)
show(loop_over_starred, (5, 6))
print(loop_over_list_of_lists() == loop_over_list_of_lists(), loop_over_list_of_lists()[0] is not loop_over_list_of_lists()[0])

print('--- displays that are kept are new each time')


def a_list(): return [1, 2, 3]
def a_set(): return {1, 2, 3}
def a_dict(): return {1: 2}


for f in (a_list, a_set, a_dict):
    first, second = f(), f()
    print(f.__name__, first == second, first is second, type(first).__name__)

print('--- lines')


def lines_of(f, *args):
    seen = []

    def tracer(frame, event, arg):
        if frame.f_code is f.__code__:
            seen.append((event, frame.f_lineno - f.__code__.co_firstlineno))
            return tracer
    sys.settrace(tracer)
    try:
        f(*args)
    finally:
        sys.settrace(None)
    print(f.__name__, seen)


def operation_over_lines():
    x = (60 *
         60 *
         24)
    return x


def partly_over_lines(y):
    x = (60 *
         60 *
         y)
    return x


def search_over_lines(x):
    return (x in
            [1,
             2,
             3])


def search_names_over_lines(x, y):
    return (x in
            [y,
             2,
             3])


def loop_over_lines():
    for x in [1,
              2]:
        pass


def loop_over_set_over_lines():
    for x in {1,
              }:
        pass


def tuple_over_lines():
    x = (1,
         2 *
         3,
         (4,
          5))
    return x


def defaults_over_lines():
    def inner(a=1,
              b=(2,
                 3)):
        pass
    return inner


def unary_over_lines():
    x = (-
         (1 +
          2))
    return x


def none_on_its_own_line(v=1):
    if (v
            is None):
        return 0
    assert (v
            is not None)
    x = (v
         is None)
    y = (v is
         not None)
    while (v
           is None):
        pass
    return v


for f in (operation_over_lines, loop_over_lines, loop_over_set_over_lines, tuple_over_lines, defaults_over_lines, unary_over_lines, none_on_its_own_line):
    lines_of(f)
lines_of(partly_over_lines, 2)
lines_of(search_over_lines, 2)
lines_of(search_names_over_lines, 2, 1)
