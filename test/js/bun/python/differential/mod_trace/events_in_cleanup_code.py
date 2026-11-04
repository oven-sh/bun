# What sys.settrace and sys.monitoring are told of in the code that the compiler adds to clean up: at the end of a `finally` clause that an
# exception led to, in the handler of a comprehension that is compiled in place, at the end of `except*`.
import sys

EV = []


class CM:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def finally_ends_in_if(p=1):
    try:
        pass
    finally:
        try:
            raise ValueError
        finally:
            if p:
                pass


def finally_ends_in_if_not_taken():
    try:
        raise ValueError
    finally:
        if not EV:
            pass


def finally_ends_in_if_else(p=0):
    try:
        raise ValueError
    finally:
        if p:
            x = 1
        else:
            x = 2


def finally_ends_in_test_over_lines(p=0, q=0):
    try:
        raise ValueError
    finally:
        if (p or
                q):
            x = 1


def finally_ends_in_loop():
    try:
        raise ValueError
    finally:
        for i in range(2):
            x = i


def finally_ends_in_loop_with_break():
    try:
        raise ValueError
    finally:
        for i in range(2):
            if i:
                break


def finally_ends_in_while(n=2):
    try:
        raise ValueError
    finally:
        while n:
            n -= 1


def finally_ends_in_try():
    try:
        raise ValueError
    finally:
        try:
            x = 1
        except KeyError:
            x = 2


def finally_ends_in_try_that_catches():
    try:
        raise ValueError
    finally:
        try:
            {}[1]
        except KeyError:
            x = 2


def finally_ends_in_finally():
    try:
        raise ValueError
    finally:
        try:
            x = 1
        finally:
            if x:
                y = 2


def finally_ends_in_with():
    try:
        raise ValueError
    finally:
        with CM():
            x = 1


def finally_ends_in_match(v=2):
    try:
        raise ValueError
    finally:
        match v:
            case 1:
                x = 1
            case 2:
                x = 2


def finally_in_loop_gives_up_exception():
    for i in range(2):
        try:
            raise ValueError
        finally:
            if i:
                break
            else:
                continue


def finally_returns(p=1):
    try:
        raise ValueError
    finally:
        if p:
            return 1


def break_out_of_inner_finally_in_last_loop():
    try:
        raise ValueError
    finally:
        for i in range(2):
            try:
                raise KeyError
            finally:
                break


def comprehension_of_what_is_not_iterable():
    with CM():
        [1 for _ in 1]


def comprehension_that_raises():
    [1 // 0 for _ in (1,)]


def comprehension_over_lines():
    x = [
        1 // i
        for i in (1, 0)
    ]


def comprehension_in_try():
    try:
        {i: 1 // i for i in (1, 0)}
    except ZeroDivisionError:
        pass


def nested_comprehensions():
    [[1 // j for j in (i,)] for i in (1, 0)]


def except_star_does_not_match():
    try:
        raise ExceptionGroup('g', [ValueError()])
    except* KeyError:
        pass


def except_star_matches_a_part():
    try:
        raise ExceptionGroup('g', [ValueError(), KeyError()])
    except* KeyError:
        pass


def except_star_raises():
    try:
        raise ExceptionGroup('g', [ValueError(), KeyError()])
    except* KeyError:
        raise TypeError


def with_two_managers_after_for_else():
    for i in ():
        pass
    else:
        with CM(), CM():
            r = 1


def except_does_not_match():
    try:
        raise ValueError
    except KeyError:
        pass
    except (TypeError, OSError) as e:
        pass


def raises_in_named_handler():
    try:
        raise ValueError
    except ValueError as e:
        raise KeyError


def with_on_one_line():
    with CM(): raise ValueError


cases = [value for name, value in list(globals().items()) if callable(value) and getattr(value, '__code__', None) and value.__code__.co_filename == __file__ and name != 'CM']
names = {f.__name__ for f in cases}


def tracer(frame, event, arg):
    if frame.f_code.co_name in names:
        EV.append((event, frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno is not None else None))
        return tracer


for f in cases:
    EV.clear()
    sys.settrace(tracer)
    try:
        f()
    except BaseException as e:
        left = e.__traceback__.tb_next
    else:
        left = None
    finally:
        sys.settrace(None)
    print('settrace', f.__name__, EV)
    if left:
        print('   ', left.tb_lineno - f.__code__.co_firstlineno, left.tb_frame.f_lineno and left.tb_frame.f_lineno - f.__code__.co_firstlineno)

# Where the frame is found to be afterwards when nobody traced it.
for f in cases:
    try:
        f()
    except BaseException as e:
        left = e.__traceback__.tb_next
        if left:
            print('untraced', f.__name__, left.tb_lineno - f.__code__.co_firstlineno, left.tb_frame.f_lineno and left.tb_frame.f_lineno - f.__code__.co_firstlineno)

M = sys.monitoring
events = ['PY_START', 'PY_RETURN', 'PY_UNWIND', 'RAISE', 'RERAISE', 'EXCEPTION_HANDLED', 'LINE']


def make(n):
    def cb(code, *a):
        if code.co_name in names:
            EV.append((n, a[0] - code.co_firstlineno) if n == 'LINE' else n)
    return cb


for f in cases:
    EV.clear()
    M.use_tool_id(3, 'x')
    mask = 0
    for n in events:
        M.register_callback(3, getattr(M.events, n), make(n))
        mask |= getattr(M.events, n)
    M.set_events(3, mask)
    try:
        f()
    except BaseException as e:
        pass
    finally:
        M.set_events(3, 0)
        M.free_tool_id(3)
    print('monitoring', f.__name__, EV)
