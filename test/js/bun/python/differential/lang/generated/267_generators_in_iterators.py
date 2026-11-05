# A generator that only an iterator has, which only a loop or a call has, is closed where that is dropped.
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: import itertools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools')
try: from itertools import accumulate, batched, chain, compress, cycle, dropwhile, filterfalse, islice, pairwise, starmap, takewhile, zip_longest
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from itertools import accumulate, batched, chain, compress, cycle, dr...')

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
    def pairs(name, n=5):
        try:
            for i in range(n):
                yield i, i
        finally:
            LOG.append(name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pairs(name, n=5):')


try:
    def show(what, *more):
        print(what, *more, LOG)
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(what, *more):')


try:
    def true(*a):
        return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def true(*a):')


try: MAKERS = {
    'enumerate': lambda: "enumerate(g('a'))",
    'enumerate start': lambda: "enumerate(g('a'), 5)",
    'zip one': lambda: "zip(g('a'))",
    'zip two': lambda: "zip(g('a'), g('b'))",
    'zip three': lambda: "zip(g('a'), g('b'), g('c'))",
    'zip four': lambda: "zip(g('a'), g('b'), g('c'), g('d'))",
    'zip with a list': lambda: "zip(g('a'), [1, 2, 3, 4])",
    'zip list first': lambda: "zip([1, 2, 3, 4], g('a'))",
    'map': lambda: "map(true, g('a'))",
    'map two': lambda: "map(true, g('a'), g('b'))",
    'filter': lambda: "filter(true, g('a'))",
    'filter None': lambda: "filter(None, g('a'))",
    'iter': lambda: "iter(g('a'))",
    'islice': lambda: "islice(g('a'), 3)",
    'islice from': lambda: "islice(g('a'), 1, 4)",
    'takewhile': lambda: "takewhile(true, g('a'))",
    'dropwhile': lambda: "dropwhile(bool, g('a'))",
    'filterfalse': lambda: "filterfalse(bool, g('a'))",
    'starmap': lambda: "starmap(true, pairs('a'))",
    'accumulate': lambda: "accumulate(g('a'))",
    'chain': lambda: "chain(g('a'), g('b'))",
    'chain with a list': lambda: "chain([9], g('a'))",
    'compress': lambda: "compress(g('a'), g('b', 9))",
    'pairwise': lambda: "pairwise(g('a'))",
    'batched': lambda: "batched(g('a'), 2)",
    'cycle': lambda: "cycle(g('a'))",
    'zip_longest': lambda: "zip_longest(g('a'), g('b'))",
    'itertools.islice': lambda: "itertools.islice(g('a'), 3)",
    'enumerate of zip': lambda: "enumerate(zip(g('a'), g('b')))",
    'zip of enumerate': lambda: "zip(enumerate(g('a')), g('b'))",
    'map of filter of islice': lambda: "map(true, filter(true, islice(g('a'), 4)))",
    'iter of enumerate': lambda: "iter(enumerate(g('a')))",
    'enumerate of iter': lambda: "enumerate(iter(g('a')))",
    'enumerate of a generator expression': lambda: "enumerate(x for x in g('a'))",
    'generator expression over enumerate': lambda: "(x for x in enumerate(g('a')))",
    'generator expression over zip': lambda: "(x for x in zip(g('a'), g('b')))",
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MAKERS = { \'enumerate\': lambda: "enumerate(g(\'a\'))", \'enumerate start...')

try:
    class Any:
        def __eq__(self, other):
            return True
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Any:')


try: ANY = Any()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ANY = Any()')

try: USES = {
    'for, break': "def use():\n    for x in %s:\n        break\n    show('after the loop')\n",
    'for, second, break': "def use():\n    n = 0\n    for x in %s:\n        n += 1\n        if n == 2:\n            break\n    show('after the loop')\n",
    'for, return': "def use():\n    for x in %s:\n        return show('in the loop')\n",
    'for, raise': "def use():\n    try:\n        for x in %s:\n            raise ValueError\n    except ValueError:\n        show('in the handler')\n",
    'for, continue of the outer loop': "def use():\n    for i in range(2):\n        for x in %s:\n            continue_outer = True\n            break\n        show('in the outer loop')\n",
    'the loop ends before it': "def use():\n    for x in zip(range(2), %s):\n        pass\n    show('after the loop')\n",
    'the loop ends after it has taken one more': "def use():\n    for x in zip(%s, range(2)):\n        pass\n    show('after the loop')\n",
    'next': "def use():\n    next(%s)\n    show('after next')\n",
    'any over a generator expression': "def use():\n    any(True for x in %s)\n    show('after any')\n",
    'any': "def use():\n    any(map(true, %s))\n    show('after any')\n",
    'all': "def use():\n    all(map(false, %s))\n    show('after all')\n",
    'in': "def use():\n    ANY in %s\n    show('after in')\n",
    'not in, in a condition': "def use():\n    if ANY not in %s:\n        pass\n    else:\n        show('in else')\n",
    'list of islice': "def use():\n    list(islice(%s, 2))\n    show('after list')\n",
    'tuple of islice': "def use():\n    tuple(islice(%s, 2))\n    show('after tuple')\n",
    'set of islice': "def use():\n    set(islice(%s, 2))\n    show('after set')\n",
    'frozenset of islice': "def use():\n    frozenset(islice(%s, 2))\n    show('after frozenset')\n",
    'sorted of islice': "def use():\n    sorted(islice(%s, 2))\n    show('after sorted')\n",
    'dict of zip': "def use():\n    dict(zip(range(2), %s))\n    show('after dict')\n",
    'sum': "def use():\n    sum(map(one, islice(%s, 2)))\n    show('after sum')\n",
    'min with a key that raises': "def use():\n    try:\n        min(%s, key=fails)\n    except ZeroDivisionError:\n        show('in the handler')\n",
    'reduce that raises': "def use():\n    try:\n        functools.reduce(fails, %s)\n    except ZeroDivisionError:\n        show('in the handler')\n",
    'comprehension that raises': "def use():\n    try:\n        [1 // 0 for x in %s]\n    except ZeroDivisionError:\n        show('in the handler')\n",
    'too many to unpack': "def use():\n    try:\n        a, = %s\n    except ValueError:\n        show('in the handler')\n",
    'too many to unpack, into a list': "def use():\n    try:\n        [a] = %s\n    except ValueError:\n        show('in the handler')\n",
    'kept in a variable': "def use():\n    it = %s\n    for x in it:\n        break\n    show('after the loop')\n    next(it, None)\n    show('it goes on')\n",
    'kept by :=': "def use():\n    for x in (it := %s):\n        break\n    show('after the loop')\n    next(it, None)\n    show('it goes on')\n",
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: USES = { \'for, break\': "def use():\\n for x in %s:\\n break\\n show(\'aft...')


try:
    def false(*a):
        return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def false(*a):')


try:
    def one(*a):
        return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one(*a):')


try:
    def fails(*a):
        return 1 // 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fails(*a):')


try:
    for use, template in USES.items():
        for name, maker in MAKERS.items():
            try: ns = dict(globals())
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = dict(globals())')
            try: exec(template % maker(), ns)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(template % maker(), ns)')
            try: print(use, '/', name, end=': ')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: print(use, '/', name, end=': ')")
            try: ns['use']()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns['use']()")
            if use.startswith('kept'):
                # When the variable goes is another matter.
                try: gc.collect()
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
                try: LOG.clear()
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG.clear()')
            if LOG:
                try: show('   later')
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(' later')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for use, template in USES.items():')
