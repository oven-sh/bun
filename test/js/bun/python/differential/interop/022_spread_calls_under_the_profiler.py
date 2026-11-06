long_tuple, long_list = tuple(range(1000)), list(range(1000))


def f(*args): return args
def g(a, b, c, *rest): return rest


def work():
    t, l = long_tuple, long_list
    wrong = 0
    for i in range(20000):
        if f(*t) != t or f(0, *l)[1:] != t or g(*t) != t[3:] or f(*l, **{}) != t:
            wrong += 1
    return wrong
