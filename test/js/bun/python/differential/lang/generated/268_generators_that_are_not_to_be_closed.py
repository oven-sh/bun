# What must not be closed, and what is made between a generator and its use.
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try: import itertools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools')
try: from itertools import accumulate, chain, islice, zip_longest
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from itertools import accumulate, chain, islice, zip_longest')

try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')


try:
    def g(name, n=5):
        try:
            for i in range(n):
                yield i
        finally:
            LOG.append(name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(name, n=5):')


try:
    def show(what, *more):
        print(what, *more, LOG)
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(what, *more):')


try:
    def handed_out_by_accumulate():
        kept = []
        for x in accumulate([1, 2], lambda a, b: a, initial=g('a')):
            kept.append(x)
            break
        show('after the loop')
        print(next(kept[0]), next(kept[0]))
        kept[0].close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handed_out_by_accumulate():')


try:
    def handed_out_by_zip_longest():
        kept = []
        for x in zip_longest([1, 2], [], fillvalue=g('a')):
            kept.append(x[1])
            break
        show('after the loop')
        print(next(kept[0]), next(kept[0]))
        kept[0].close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handed_out_by_zip_longest():')


try:
    def default_of_next():
        it = next(iter(()), g('a'))
        show('after next')
        for x in it:
            break
        show('after the loop')
        print(next(it))
        it.close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def default_of_next():')


try:
    def start_of_sum():
        it = sum([], g('a'))
        print(next(it))
        for x in (lambda v: v)(it):
            break
        show('after the loop')
        print(next(it))
        it.close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def start_of_sum():')


try:
    def initial_of_reduce():
        it = functools.reduce(None, [], g('a'))
        print(next(it), next(it))
        any(it for i in range(1))
        print(next(it))
        it.close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def initial_of_reduce():')


try:
    class Greater:
        def __init__(self):
            self.seen = []

        def __gt__(self, other):
            self.seen.append(other)
            return True

        def __lt__(self, other):
            self.seen.append(other)
            return True

        def __eq__(self, other):
            self.seen.append(other)
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Greater:')


try:
    def two_arguments_of_min():
        big = Greater()
        min(g('a'), big)
        show('after min')
        print(next(big.seen[0]), next(big.seen[0]))
        big.seen[0].close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two_arguments_of_min():')


try:
    def sentinel_of_iter():
        big = Greater()
        for x in iter(lambda: big, g('a')):
            break
        show('after the loop')
        print(next(big.seen[0]), next(big.seen[0]))
        next(big.seen[0])
        show('after next')
        big.seen[0].close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sentinel_of_iter():')


try:
    def key_of_sorted():
        try:
            sorted([1, 2], key=g('a'))
        except TypeError as e:
            print(e)
        show('after sorted')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def key_of_sorted():')


try:
    def two_of_each():
        for x in zip(enumerate(g('a')), enumerate(g('b'))):
            break
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two_of_each():')


try:
    def three_levels_twice():
        for x in zip(map(str, filter(None, g('a'))), map(str, filter(None, g('b'))), g('c')):
            break
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def three_levels_twice():')


try:
    def loops():
        for x in g('inner'):
            break
        next(g('inner 2'))
        return 'abc'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loops():')


try:
    def a_call_between():
        for x in zip(g('a'), loops(), g('b')):
            break
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_call_between():')


try:
    def other_calls_between():
        for x in zip(g('a'), range(3), list('abc'), enumerate('abc'), sorted('abc'), [next(iter('abc'))] * 3):
            break
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def other_calls_between():')


try:
    def fails():
        raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fails():')


try:
    def an_argument_raises():
        for i in range(3):
            try:
                for x in zip(g('a'), fails()):
                    break
            except ValueError:
                pass
            for x in zip(g('b'), 'abc'):
                break
            show('after the loop')
        import gc
        gc.collect()
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def an_argument_raises():')


try:
    def a_yield_between():
        for x in zip(g('a'), (yield)):
            break
        show('after the loop')
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_yield_between():')


try:
    def dropped_at_the_yield():
        it = a_yield_between()
        next(it)
        it.close()
        show('closed')
        import gc
        gc.collect()
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dropped_at_the_yield():')


try:
    def the_iterator_is_kept():
        e = enumerate(g('a'))
        for x in zip(e, g('b')):
            break
        show('after the loop')
        print(next(e))
        del e, x
        import gc
        gc.collect()
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def the_iterator_is_kept():')


try:
    def the_generator_is_kept():
        a = g('a')
        for x in zip(a, g('b')):
            break
        show('after the loop')
        print(next(a))
        a.close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def the_generator_is_kept():')


try:
    class MyZip(zip):
        kept = []

        def __new__(cls, *args):
            cls.kept.extend(args)
            return super().__new__(cls, *args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyZip(zip):')


try:
    def a_class_of_the_program():
        for x in MyZip(g('a'), g('b')):
            break
        show('after the loop')
        print(next(MyZip.kept[0]), next(MyZip.kept[1]))
        for it in MyZip.kept:
            it.close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_class_of_the_program():')


try:
    def shadowed():
        kept = []

        def enumerate(it):
            kept.append(it)
            return it
        for x in enumerate(g('a')):
            break
        show('after the loop')
        print(next(kept[0]))
        kept[0].close()
        show('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shadowed():')


try:
    def islice_lets_go():
        for x in chain(islice(g('a'), 1), islice(g('b'), 1)):
            show('in the loop', x)
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def islice_lets_go():')


try:
    def chain_lets_go():
        for x in chain(zip(g('a'), 'x'), 'y'):
            show('in the loop', x)
        show('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chain_lets_go():')


try:
    def f_locals_of_a_generator_expression():
        ge = (x for x in enumerate(g('a')))
        next(ge)
        e = ge.gi_frame.f_locals['.0']
        ge.close()
        show('closed')
        print(next(e))
        del e, ge
        import gc
        gc.collect()
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f_locals_of_a_generator_expression():')


try:
    def taken_apart():
        [a, b] = (x for x in zip(g('a', 2), g('b')))
        show('after the assignment')
        a, *b = chain(zip(g('a', 2), g('b')), 'x')
        show('after the assignment')
        try:
            a, b, c = zip(g('a'), g('b', 2))
        except ValueError:
            show('in the handler')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def taken_apart():')


try:
    def by_attribute():
        for x in itertools.islice(g('a'), 3):
            break
        show('after the loop')
        next(itertools.chain(g('a'), g('b')))
        show('after next')
        functools.reduce(lambda a, b: 1 // 0 if b else a, itertools.islice(g('a'), 1, 3)) if False else None
        try:
            functools.reduce(lambda a, b: 1 // 0, itertools.islice(g('a'), 3))
        except ZeroDivisionError:
            show('in the handler')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_attribute():')


try:
    for f in (handed_out_by_accumulate, handed_out_by_zip_longest, default_of_next, start_of_sum, initial_of_reduce, two_arguments_of_min, sentinel_of_iter, key_of_sorted,
              two_of_each, three_levels_twice, a_call_between, other_calls_between, an_argument_raises, dropped_at_the_yield, the_iterator_is_kept,
              the_generator_is_kept, a_class_of_the_program, shadowed, islice_lets_go, chain_lets_go, f_locals_of_a_generator_expression, taken_apart, by_attribute):
        try: print('--', 'f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: f()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f()')
        if LOG:
            try: show('   later')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(' later')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (handed_out_by_accumulate, handed_out_by_zip_longest, defaul...')
