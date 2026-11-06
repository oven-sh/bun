import time

short_tuple, short_list = tuple(range(90)), list(range(90))
long_tuple, long_list = tuple(range(1000)), list(range(1000))


def f(*args): return args
def g(a, b, c, *rest): return rest


def work():
    wrong = 0
    end = time.monotonic() + 0.4
    while time.monotonic() < end:
        for t, l in ((short_tuple, short_list), (short_tuple, short_list), (short_tuple, short_list), (long_tuple, long_list)):
            for i in range(10):
                if f(*t) != t or f(0, *l)[1:] != t or g(*t) != t[3:] or f(*l, **{}) != t:
                    wrong += 1
    return wrong
