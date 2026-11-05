# What `in` and `not in` search is closed when the search is over, if nothing else has it.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')


try:
    def g(name, n=5):
        try:
            for i in range(n):
                yield i
        finally:
            LOG.append("closed " + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(name, n=5):')


try:
    def show(what):
        print(what, LOG)
        LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(what):')


try: r = 2 in g("found")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 2 in g("found")')
try: show("found %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("found %r" % r)')
try: r = 9 in g("not found")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 9 in g("not found")')
try: show("not found %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("not found %r" % r)')
try: r = 2 not in g("not in, found")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 2 not in g("not in, found")')
try: show("not in %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("not in %r" % r)')
try:
    if 1 in g("condition"):
        try: show("in the body of if")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("in the body of if")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if 1 in g("condition"):')
try:
    if 1 not in g("condition, not in"):
        pass
    else:
        try: show("in the else of if")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("in the else of if")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if 1 not in g("condition, not in"):')
try:
    while 3 in g("while"):
        try: show("in the body of while")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("in the body of while")')
        break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while 3 in g("while"):')
try: r = 0 < 1 in g("chain")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 0 < 1 in g("chain")')
try: show("chain %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("chain %r" % r)')
try:
    if 0 < 1 in g("chain in a condition"):
        try: show("chain in a condition")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("chain in a condition")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if 0 < 1 in g("chain in a condition"):')
try: r = 2 in (x for x in g("through a generator expression"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 2 in (x for x in g("through a generator expression"))')
try: show("generator expression %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("generator expression %r" % r)')
try: r = [1 in g("in a comprehension %d" % i) for i in range(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = [1 in g("in a comprehension %d" % i) for i in range(2)]')
try: show("comprehension %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("comprehension %r" % r)')
try: r = 1 in g("and") and 1 in g("and 2")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in g("and") and 1 in g("and 2")')
try: show("and %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("and %r" % r)')
try: r = (lambda: 1 in g("lambda"))()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = (lambda: 1 in g("lambda"))()')
try: show("lambda %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("lambda %r" % r)')


try:
    class Bad:
        def __eq__(self, other):
            if other == 2:
                show("in __eq__")
                raise ValueError("no")
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bad:')


try:
    try:
        Bad() in g("raises")
    except ValueError as e:
        show("in the handler %r" % e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')


try:
    def f():
        try:
            return Bad() in g("raises in a function")
        finally:
            show("in finally")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f():')


try:
    try:
        f()
    except ValueError as e:
        show("after the function %r" % e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

# The exception that waits is the context of one that is raised and caught while the generator is closed.


try:
    def h():
        try:
            yield 1
            yield 2
        finally:
            try:
                raise KeyError("inner")
            except KeyError as e:
                LOG.append("context %r" % e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h():')


try:
    try:
        Bad() in h()
    except ValueError as e:
        show("context %r" % e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')


# What the closing raises is printed and ignored.
try:
    def k():
        try:
            yield 1
            yield 2
        finally:
            raise RuntimeError("while closing")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def k():')


try:
    def hook(u):
        LOG.append("unraisable %r %s" % (u.exc_value, getattr(u.object, "__name__", u.object)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook(u):')


try: sys.unraisablehook = hook
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = hook')
try: r = 1 in k()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in k()')
try: show("raises while closing %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("raises while closing %r" % r)')
try:
    try:
        Bad() in k()
    except ValueError as e:
        show("raises while closing, an exception waits %r %r" % (e, e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')


# A generator that ignores GeneratorExit.
try:
    def stubborn():
        try:
            yield 1
        except GeneratorExit:
            yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stubborn():')


try: r = 1 in stubborn()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in stubborn()')
try: show("ignores GeneratorExit %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("ignores GeneratorExit %r" % r)')

# What somebody else has is not closed.
try: it = g("kept")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = g("kept")')
try: r = 1 in it
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in it')
try: show("kept %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("kept %r" % r)')
try: print(next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: r = 3 in (kept := g("walrus"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 3 in (kept := g("walrus"))')
try: show("walrus %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("walrus %r" % r)')
try: print(next(kept))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(kept)')
try: kept.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.close()')
try: it.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.close()')
try: LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG.clear()')


try:
    def same(x):
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def same(x):')


try: r = 1 in same(it2 := g("passed through"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in same(it2 := g("passed through"))')
try: show("passed through %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("passed through %r" % r)')
try: print(next(it2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it2)')
try: it2.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it2.close()')
try: LOG.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG.clear()')


# The frame of the generator is kept.
try: FRAMES = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FRAMES = []')


try:
    def framed():
        FRAMES.append(sys._getframe())
        try:
            yield 1
            yield 2
        finally:
            LOG.append("closed framed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def framed():')


try: r = 1 in framed()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in framed()')
try: show("frame kept %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("frame kept %r" % r)')
try: print('FRAMES[0].f_lineno =>', FRAMES[0].f_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FRAMES[0].f_lineno')
try: print('FRAMES[0].f_locals =>', FRAMES[0].f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FRAMES[0].f_locals')


try:
    class Has:
        def __contains__(self, x):
            return x in g("in __contains__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Has:')


try: r = 1 in Has()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = 1 in Has()')
try: show("__contains__ %r" % r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("__contains__ %r" % r)')


# In a generator, and in a coroutine.
try:
    def outer():
        yield 1 in g("in a generator")
        show("resumed")
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')


try: o = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = outer()')
try: print(next(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(o)')
try: next(o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(o)')


try:
    async def co():
        return 1 in g("in a coroutine")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def co():')


try:
    try:
        co().send(None)
    except StopIteration as e:
        show("coroutine %r" % e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

# match, assert, ternary
try: assert 1 in g("assert")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert 1 in g("assert")')
try: show("assert")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("assert")')
try: r = "y" if 1 in g("ternary") else "n"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = "y" if 1 in g("ternary") else "n"')
try: show("ternary " + r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("ternary " + r)')


# functools.reduce() stops where the function raises.
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try: from functools import reduce
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from functools import reduce')


try:
    def add(a, b):
        if b == 3:
            show("in the function")
            raise ValueError("three")
        return a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def add(a, b):')


try:
    try:
        reduce(add, g("reduce"))
    except ValueError as e:
        show("reduce %r" % e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        functools.reduce(add, g("functools.reduce"), 10)
    except ValueError as e:
        show("functools.reduce %r" % e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(reduce(add, g("to the end", 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reduce(add, g("to the end", 3))')
try: show("to the end")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("to the end")')
