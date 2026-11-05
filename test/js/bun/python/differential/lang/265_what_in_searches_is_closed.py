# What `in` and `not in` search is closed when the search is over, if nothing else has it.
import sys

LOG = []


def g(name, n=5):
    try:
        for i in range(n):
            yield i
    finally:
        LOG.append("closed " + name)


def show(what):
    print(what, LOG)
    LOG.clear()


r = 2 in g("found")
show("found %r" % r)
r = 9 in g("not found")
show("not found %r" % r)
r = 2 not in g("not in, found")
show("not in %r" % r)
if 1 in g("condition"):
    show("in the body of if")
if 1 not in g("condition, not in"):
    pass
else:
    show("in the else of if")
while 3 in g("while"):
    show("in the body of while")
    break
r = 0 < 1 in g("chain")
show("chain %r" % r)
if 0 < 1 in g("chain in a condition"):
    show("chain in a condition")
r = 2 in (x for x in g("through a generator expression"))
show("generator expression %r" % r)
r = [1 in g("in a comprehension %d" % i) for i in range(2)]
show("comprehension %r" % r)
r = 1 in g("and") and 1 in g("and 2")
show("and %r" % r)
r = (lambda: 1 in g("lambda"))()
show("lambda %r" % r)


class Bad:
    def __eq__(self, other):
        if other == 2:
            show("in __eq__")
            raise ValueError("no")
        return False


try:
    Bad() in g("raises")
except ValueError as e:
    show("in the handler %r" % e)


def f():
    try:
        return Bad() in g("raises in a function")
    finally:
        show("in finally")


try:
    f()
except ValueError as e:
    show("after the function %r" % e)

# The exception that waits is the context of one that is raised and caught while the generator is closed.


def h():
    try:
        yield 1
        yield 2
    finally:
        try:
            raise KeyError("inner")
        except KeyError as e:
            LOG.append("context %r" % e.__context__)


try:
    Bad() in h()
except ValueError as e:
    show("context %r" % e.__context__)


# What the closing raises is printed and ignored.
def k():
    try:
        yield 1
        yield 2
    finally:
        raise RuntimeError("while closing")


def hook(u):
    LOG.append("unraisable %r %s" % (u.exc_value, getattr(u.object, "__name__", u.object)))


sys.unraisablehook = hook
r = 1 in k()
show("raises while closing %r" % r)
try:
    Bad() in k()
except ValueError as e:
    show("raises while closing, an exception waits %r %r" % (e, e.__context__))


# A generator that ignores GeneratorExit.
def stubborn():
    try:
        yield 1
    except GeneratorExit:
        yield 2


r = 1 in stubborn()
show("ignores GeneratorExit %r" % r)

# What somebody else has is not closed.
it = g("kept")
r = 1 in it
show("kept %r" % r)
print(next(it))
r = 3 in (kept := g("walrus"))
show("walrus %r" % r)
print(next(kept))
kept.close()
it.close()
LOG.clear()


def same(x):
    return x


r = 1 in same(it2 := g("passed through"))
show("passed through %r" % r)
print(next(it2))
it2.close()
LOG.clear()


# The frame of the generator is kept.
FRAMES = []


def framed():
    FRAMES.append(sys._getframe())
    try:
        yield 1
        yield 2
    finally:
        LOG.append("closed framed")


r = 1 in framed()
show("frame kept %r" % r)
print(FRAMES[0].f_lineno, FRAMES[0].f_locals)


class Has:
    def __contains__(self, x):
        return x in g("in __contains__")


r = 1 in Has()
show("__contains__ %r" % r)


# In a generator, and in a coroutine.
def outer():
    yield 1 in g("in a generator")
    show("resumed")
    yield


o = outer()
print(next(o))
next(o)


async def co():
    return 1 in g("in a coroutine")


try:
    co().send(None)
except StopIteration as e:
    show("coroutine %r" % e.value)

# match, assert, ternary
assert 1 in g("assert")
show("assert")
r = "y" if 1 in g("ternary") else "n"
show("ternary " + r)


# functools.reduce() stops where the function raises.
import functools
from functools import reduce


def add(a, b):
    if b == 3:
        show("in the function")
        raise ValueError("three")
    return a + b


try:
    reduce(add, g("reduce"))
except ValueError as e:
    show("reduce %r" % e)
try:
    functools.reduce(add, g("functools.reduce"), 10)
except ValueError as e:
    show("functools.reduce %r" % e)
print(reduce(add, g("to the end", 3)))
show("to the end")
