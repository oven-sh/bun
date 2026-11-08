# 'out' and 'in, out' parameters beyond the thirty-second: the call returned nothing at all. (CPython has 32 bits for them, and takes the thirty-third for the first.)
from ctypes import *
libc = CDLL(None)
def attempt(what, count, flags):
    types = [c_long] * count
    for i in flags:
        types[i] = POINTER(c_int)
    function = CFUNCTYPE(c_long, *types)(('labs', libc), tuple((flags.get(i, 1),) for i in range(count)))
    given = [byref(c_int(100 + i)) if flags.get(i) == 3 else i for i in range(count) if flags.get(i, 1) != 2]
    try:
        result = function(*given)
        show = lambda r: r if isinstance(r, int) else type(r).__name__
        print(what, '|', tuple(show(r) for r in result) if isinstance(result, tuple) else show(result))
    except BaseException as e:
        print(what, '|', type(e).__name__, e)
attempt('the last of 32', 32, {31: 2})
attempt('the last of 33', 33, {32: 2})
attempt('the first and the last of 33', 33, {0: 2, 32: 2})
attempt('two beyond', 40, {35: 2, 39: 2})
attempt('in, out beyond', 34, {33: 3})
attempt('of both kinds', 36, {1: 2, 33: 3, 35: 2})
