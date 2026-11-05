# A generator that is to go on where the stack has no room for its frame is over: it does not stay where it was, to go on from there later.
# How much room there is when a RecursionError has been caught differs from build to build, so this only says what must never be seen.
import sys

sys.setrecursionlimit(10 ** 7)
ABOUT_TO_RESUME, RESUMED = 1, 2
state = [0]


def generator():
    a = b = c = d = e = f = g = h = i = j = k = l = m = n = o = p = q = r = s = t = 0
    for value in range(1000):
        yield value
        state[0] = RESUMED
    return (a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t)


def by_for(it):
    state[0] = ABOUT_TO_RESUME
    for x in it:
        return x


def delegating(it):
    yield 'started'
    state[0] = ABOUT_TO_RESUME
    yield from it


def deep(how, it, left_half_way):
    try:
        return deep(how, it, left_half_way)
    except RecursionError:
        pass
    state[0] = 0
    try:
        return how(it)
    except RecursionError:
        if state[0] == ABOUT_TO_RESUME and it.gi_frame is not None:
            left_half_way.append(it.gi_frame.f_lineno)
        raise


for turn in range(3):
    it = generator()
    next(it)
    left_half_way = []
    deep(by_for, it, left_half_way)
    print('for', left_half_way)

    it = generator()
    next(it)
    left_half_way = []

    def by_yield_from(it):
        outer = delegating(it)
        next(outer)
        for x in outer:
            return x

    deep(by_yield_from, it, left_half_way)
    print('yield from', left_half_way)
