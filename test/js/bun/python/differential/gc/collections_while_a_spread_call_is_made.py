# f(*a, **k): the names of the keywords are made, and a key that is no str is refused, when the arguments are about to be copied. A collection
# then finds a caller that has more registers than the call needs.
import sys

TURNS = int(sys.argv[1]) if len(sys.argv) > 1 else 40000


def takes_kw(**kw):
    return len(kw)


def takes_some(a, b=0, **kw):
    return 1


def many(*args):
    return len(args)


def wide(d, never, x):
    if never:
        return many(x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x, x)
    return takes_kw(**d)


def forwards(*args, **kw):
    if not args:
        many(many(args, kw, many(args, kw, args, kw)), kw, many(args, kw, args, many(kw, args, kw, args, kw, args)))
    return takes_some(*args, **kw)


def refused(never, a, k):
    if never:
        many(many(a, k, many(a, k, a, k)), k, many(a, k, a, many(k, a, k, a, k, a, many(a, a, a, a, a, a, a, a, a, a, a, a, a, a))))
    try:
        return takes_kw(**{1: 2}, **{})
    except TypeError:
        return 0


names = {'k%d' % i: i for i in range(40)}
print(sum(wide(names, 0, i) for i in range(TURNS)))
print(sum(forwards(i, b=i, c=i) for i in range(TURNS)))
print(sum(refused(0, i, i) for i in range(TURNS)))
