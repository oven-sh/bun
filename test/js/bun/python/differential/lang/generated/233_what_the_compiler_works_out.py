# Operations on constants, and lists and sets of constants that are only searched or iterated over: what they give, what co_consts shows,
# and that nothing of it can be told from working it out when the code is run.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')


try:
    def consts(f):
        return tuple(c for c in f.__code__.co_consts if not hasattr(c, 'co_code'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def consts(f):')


try:
    def show(f, *args):
        try:
            result = f(*args)
        except Exception as e:
            result = type(e).__name__
        print(f.__name__, repr(result), consts(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(f, *args):')


try: print('--- operations')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- operations'")


try:
    def seconds(): return 60 * 60 * 24
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def seconds(): return 60 * 60 * 24')
try:
    def partly(x): return 60 * 60 * x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partly(x): return 60 * 60 * x')
try:
    def not_from_the_right(x): return x * 60 * 60
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_from_the_right(x): return x * 60 * 60')
try:
    def power(): return 2 ** 10, 2 ** 100, 2 ** -1, 2 ** 0.5, (-2) ** 3, -2 ** 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def power(): return 2 ** 10, 2 ** 100, 2 ** -1, 2 ** 0.5, (-2) ** 3, ...')
try:
    def too_large(): return 2 ** 200, 1 << 200, 3 ** 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def too_large(): return 2 ** 200, 1 << 200, 3 ** 100')
try:
    def text(): return '-' * 20, 'a' + 'b', b'x' * 3, 'ab' * 0, 3 * 'ab'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def text(): return '-' * 20, 'a' + 'b', b'x' * 3, 'ab' * 0, 3 * 'ab'")
try:
    def long_text(): return len('-' * 5000), len('ab' * 2048), len('ab' * 2049)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def long_text(): return len('-' * 5000), len('ab' * 2048), len('ab' *...")
try:
    def fails(): return 1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fails(): return 1 / 0')
try:
    def fails_too(): return 1 % 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fails_too(): return 1 % 0')
try:
    def fails_with_types(): return 'a' + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def fails_with_types(): return 'a' + 1")
try:
    def formats(): return '%d' % 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def formats(): return '%d' % 3")
try:
    def floats(): return 0.1 + 0.2, 1e308 * 10, -0.0, 0.0 * -1, 1 / 3, 7 // 2, 7 % 3, -7 // 2, 7.5 // 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def floats(): return 0.1 + 0.2, 1e308 * 10, -0.0, 0.0 * -1, 1 / 3, 7 ...')
try:
    def complexes(): return 1 + 2j, 1 - 2j, (1 + 2j) * 2, 2j ** 2, -1j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def complexes(): return 1 + 2j, 1 - 2j, (1 + 2j) * 2, 2j ** 2, -1j')
try:
    def bits(): return 6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 4, 256 >> 4, -True, +True, not 1, not 0, not ''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bits(): return 6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 4, 256 >> 4, -True, ...')
try:
    def booleans(): return True + True, True * 3, False or 3, True and 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def booleans(): return True + True, True * 3, False or 3, True and 4')
try:
    def nested(): return (1 + 2) * (3 + 4), -(1 + 2), ~(1 << 3), 2 * (3 + (4 * 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(): return (1 + 2) * (3 + 4), -(1 + 2), ~(1 << 3), 2 * (3 +...')
try:
    def matmul(): return 1 @ 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def matmul(): return 1 @ 2')
try:
    def small_and_large(): return 255 + 1, 128 + 127, 1 - 1, 0 - 1, 300 - 45
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def small_and_large(): return 255 + 1, 128 + 127, 1 - 1, 0 - 1, 300 - 45')


try:
    for f in (seconds, power, too_large, text, long_text, fails, fails_too, fails_with_types, formats, floats, complexes, bits, booleans, nested, matmul, small_and_large):
        try: show(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (seconds, power, too_large, text, long_text, fails, fails_to...')
try: show(partly, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(partly, 2)')
try: show(not_from_the_right, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(not_from_the_right, 2)')
try: print([type(v).__name__ for v in power() + floats() + bits() + booleans()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(v).__name__ for v in power() + floats() + bits() + booleans()]')
try: print('str(floats()[2]) =>', str(floats()[2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(floats()[2])')
try: print('str(floats()[3]) =>', str(floats()[3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(floats()[3])')

try: print('--- tuples')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- tuples'")


try:
    def plain(): return (1, 2, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(): return (1, 2, 3)')
try:
    def of_tuples(): return ((1, 2), (3, (4, 5)), ())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def of_tuples(): return ((1, 2), (3, (4, 5)), ())')
try:
    def with_operations(): return (1 + 1, 'a' * 2, -3, (2 ** 3,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def with_operations(): return (1 + 1, 'a' * 2, -3, (2 ** 3,))")
try:
    def not_constant(x): return (1, x, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_constant(x): return (1, x, 3)')
try:
    def with_names(): return (None, True, False, ..., 'x', b'y', 1.5, 2j)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def with_names(): return (None, True, False, ..., 'x', b'y', 1.5, 2j)")
try:
    def defaults(a=1, b=(2, 3), c=None, d=-1, e=2 * 3): return a, b, c, d, e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def defaults(a=1, b=(2, 3), c=None, d=-1, e=2 * 3): return a, b, c, d, e')
try:
    def empty(): return ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def empty(): return ()')


try:
    for f in (plain, of_tuples, with_operations, with_names, defaults, empty):
        try: show(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (plain, of_tuples, with_operations, with_names, defaults, em...')
try: show(not_constant, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(not_constant, 2)')
try: print('plain() is plain() =>', plain() is plain())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain() is plain()')
try: print('of_tuples() is of_tuples() =>', of_tuples() is of_tuples())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: of_tuples() is of_tuples()')
try: print('with_operations() is with_operations() =>', with_operations() is with_operations())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_operations() is with_operations()')
try: print('not_constant(1) is not_constant(1) =>', not_constant(1) is not_constant(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: not_constant(1) is not_constant(1)')
try: print('defaults.__defaults__ =>', defaults.__defaults__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: defaults.__defaults__')


try:
    def make():
        def inner(a=(1, 2), b=3): pass
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make():')


try: print('make().__defaults__ is make().__defaults__ =>', make().__defaults__ is make().__defaults__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make().__defaults__ is make().__defaults__')
try: print('consts(make) =>', consts(make))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: consts(make)')

try: print('--- searched')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- searched'")


try:
    def in_list(x): return x in [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_list(x): return x in [1, 2, 3]')
try:
    def in_set(x): return x in {1, 2, 3}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_set(x): return x in {1, 2, 3}')
try:
    def in_tuple(x): return x in (1, 2, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_tuple(x): return x in (1, 2, 3)')
try:
    def not_in_list(x): return x not in ['a', 'b']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def not_in_list(x): return x not in ['a', 'b']")
try:
    def in_short_set(x): return x in {1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_short_set(x): return x in {1}')
try:
    def in_set_of_equals(x): return x in {1, 1.0, True}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_set_of_equals(x): return x in {1, 1.0, True}')
try:
    def in_list_of_names(x, y): return x in [y, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_list_of_names(x, y): return x in [y, 2]')
try:
    def in_set_of_names(x, y): return x in {y, 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_set_of_names(x, y): return x in {y, 2}')
try:
    def in_starred(x, y): return x in [*y, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_starred(x, y): return x in [*y, 2]')
try:
    def in_empty(x): return x in [], x in ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_empty(x): return x in [], x in ()')
try:
    def in_test(x):
        if x in [1, 2]:
            return 'list'
        if x in {3, 4}:
            return 'set'
        if x not in {5, 6}:
            return 'neither'
        return 'last'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_test(x):')
try:
    def equal_to_list(x): return x == [1, 2, 3], x != [1, 2, 3], [1, 2, 3] == x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def equal_to_list(x): return x == [1, 2, 3], x != [1, 2, 3], [1, 2, 3...')
try:
    def chained(x): return 0 < x in [1, 2, 3], x in [1, 2, 3] in [True], x in [[1, 2, 3]] == [[1, 2, 3]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chained(x): return 0 < x in [1, 2, 3], x in [1, 2, 3] in [True], ...')
try:
    def in_operations(x): return x in [1 + 1, 2 * 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_operations(x): return x in [1 + 1, 2 * 3]')
try:
    def in_nested(x): return x in [(1, 2), (3, 4)], x in {(1, 2), (3, 4)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_nested(x): return x in [(1, 2), (3, 4)], x in {(1, 2), (3, 4)}')
try:
    def in_unhashable(x): return x in {[1], 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_unhashable(x): return x in {[1], 2}')
try:
    def in_many(x): return x in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_many(x): return x in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12...')


try:
    for f in (in_list, in_set, in_tuple, not_in_list, in_short_set, in_set_of_equals, in_empty, in_test, in_operations, in_many):
        for x in (1, 2.0, 'a', 5, 7):
            try: show(f, x)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f, x)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (in_list, in_set, in_tuple, not_in_list, in_short_set, in_se...')
try:
    for f in (in_list_of_names, in_set_of_names):
        try: show(f, 1, 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f, 1, 1)')
        try: show(f, 3, 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f, 3, 1)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (in_list_of_names, in_set_of_names):')
try: show(in_starred, 1, (1,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_starred, 1, (1,))')
try: print('equal_to_list([1, 2, 3]) =>', equal_to_list([1, 2, 3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: equal_to_list([1, 2, 3])')
try: print('equal_to_list((1, 2, 3)) =>', equal_to_list((1, 2, 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: equal_to_list((1, 2, 3))')
try: print("'abc'[1] =>", 'abc'[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'abc'[1]")
try: print('(1, 2, 3)[0] =>', (1, 2, 3)[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (1, 2, 3)[0]')
try: print("'abc'[1:] =>", 'abc'[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'abc'[1:]")
try: print("b'abc'[0] =>", b'abc'[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b'abc'[0]")
try: show(chained, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(chained, 1)')
try: show(in_nested, (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_nested, (1, 2))')
try: show(in_unhashable, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_unhashable, 2)')
try: show(in_set, [1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_set, [1])')
try: show(in_set, {1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_set, {1})')
try: show(in_set, frozenset({1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_set, frozenset({1}))')


try:
    class Odd:
        def __eq__(self, other):
            print('   compared with', repr(other))
            return False

        def __hash__(self):
            return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')


try: show(in_list, Odd())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_list, Odd())')
try: show(in_set, Odd())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(in_set, Odd())')

try: print('--- iterated over')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- iterated over'")


try:
    def over_list(): return [x for x in [1, 2, 3]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over_list(): return [x for x in [1, 2, 3]]')
try:
    def over_set(): return sorted(x for x in {3, 1, 2})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over_set(): return sorted(x for x in {3, 1, 2})')
try:
    def loop_over_list():
        out = []
        for x in [1, 2, 3]:
            out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_list():')
try:
    def loop_over_set():
        out = []
        for x in {'a'}:
            out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_set():')
try:
    def loop_over_names(a, b):
        out = []
        for x in [a, b]:
            out.append(x)
            a = b = None
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_names(a, b):')
try:
    def loop_over_starred(a):
        return [x for x in [*a, 1]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_starred(a):')
try:
    def loop_over_list_of_lists():
        out = []
        for x in [[], []]:
            x.append(1)
            out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_list_of_lists():')
try:
    def order_of_evaluation():
        seen = []
        def note(x):
            seen.append(x)
            return x
        for x in [note(1), note(2)]:
            seen.append(('loop', x))
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def order_of_evaluation():')


try:
    for f in (over_set, loop_over_list, loop_over_set, loop_over_list_of_lists, order_of_evaluation):
        try: show(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (over_set, loop_over_list, loop_over_set, loop_over_list_of_...')
try: print(over_list())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: over_list()')
try: show(loop_over_names, 1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(loop_over_names, 1, 2)')
try: show(loop_over_starred, (5, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(loop_over_starred, (5, 6))')
try: print('loop_over_list_of_lists() == loop_over_list_of_lists() =>', loop_over_list_of_lists() == loop_over_list_of_lists())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_over_list_of_lists() == loop_over_list_of_lists()')
try: print('loop_over_list_of_lists()[0] is not loop_over_list_of_lists()[0] =>', loop_over_list_of_lists()[0] is not loop_over_list_of_lists()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_over_list_of_lists()[0] is not loop_over_list_of_lists()[0]')

try: print('--- displays that are kept are new each time')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- displays that are kept are new each time'")


try:
    def a_list(): return [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_list(): return [1, 2, 3]')
try:
    def a_set(): return {1, 2, 3}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_set(): return {1, 2, 3}')
try:
    def a_dict(): return {1: 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_dict(): return {1: 2}')


try:
    for f in (a_list, a_set, a_dict):
        try: first, second = f(), f()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first, second = f(), f()')
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('first == second [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', first == second)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first == second')
        try: print('first is second [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', first is second)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first is second')
        try: print('type(first).__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', type(first).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(first).__name__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (a_list, a_set, a_dict):')

try: print('--- lines')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- lines'")


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lines_of(f, *args):')


try:
    def operation_over_lines():
        x = (60 *
             60 *
             24)
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def operation_over_lines():')


try:
    def partly_over_lines(y):
        x = (60 *
             60 *
             y)
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partly_over_lines(y):')


try:
    def search_over_lines(x):
        return (x in
                [1,
                 2,
                 3])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def search_over_lines(x):')


try:
    def search_names_over_lines(x, y):
        return (x in
                [y,
                 2,
                 3])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def search_names_over_lines(x, y):')


try:
    def loop_over_lines():
        for x in [1,
                  2]:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_lines():')


try:
    def loop_over_set_over_lines():
        for x in {1,
                  }:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_set_over_lines():')


try:
    def tuple_over_lines():
        x = (1,
             2 *
             3,
             (4,
              5))
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tuple_over_lines():')


try:
    def defaults_over_lines():
        def inner(a=1,
                  b=(2,
                     3)):
            pass
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def defaults_over_lines():')


try:
    def unary_over_lines():
        x = (-
             (1 +
              2))
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unary_over_lines():')


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def none_on_its_own_line(v=1):')


try:
    for f in (operation_over_lines, loop_over_lines, loop_over_set_over_lines, tuple_over_lines, defaults_over_lines, unary_over_lines, none_on_its_own_line):
        try: lines_of(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines_of(f)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (operation_over_lines, loop_over_lines, loop_over_set_over_l...')
try: lines_of(partly_over_lines, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines_of(partly_over_lines, 2)')
try: lines_of(search_over_lines, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines_of(search_over_lines, 2)')
try: lines_of(search_names_over_lines, 2, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines_of(search_names_over_lines, 2, 1)')

try: print('--- the names of keyword arguments are a tuple like any other')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the names of keyword arguments are a tuple like any other'")


try:
    def keywords(**k): return sorted(k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def keywords(**k): return sorted(k)')
try:
    def tuple_first(): return ('a',), keywords(a=1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def tuple_first(): return ('a',), keywords(a=1)")
try:
    def names_first(): return keywords(a=1), ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def names_first(): return keywords(a=1), ('a',)")
try:
    def names_twice(): return keywords(a=1, b=2), keywords(a=3, b=4), ('a', 'b'), ('b', 'a')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def names_twice(): return keywords(a=1, b=2), keywords(a=3, b=4), ('a...")
try:
    def in_a_tuple(): return keywords(a=1), (('a',), 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def in_a_tuple(): return keywords(a=1), (('a',), 1)")
try:
    def same_object(): return ('a', 'b') is same_object.__code__.co_consts[-1], keywords(a=1, b=2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def same_object(): return ('a', 'b') is same_object.__code__.co_const...")


try:
    for f in (tuple_first, names_first, names_twice, in_a_tuple, same_object):
        try: show(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (tuple_first, names_first, names_twice, in_a_tuple, same_obj...')
