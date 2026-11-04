# Where a signal handler finds a frame that is going round a loop: on the line it goes back from.
import contextlib
import itertools
import signal


class Stop(Exception):
    pass


def handler(signum, frame):
    # A slow machine may not have got there yet.
    if frame.f_code is not running.__code__:
        signal.setitimer(signal.ITIMER_REAL, 0.01)
        return
    raise Stop


def while_pass():
    while True:
        pass


def while_true():
    x = 0
    while True:
        x += 1
        y = x


def while_test():
    x = 0
    while x >= 0:
        x += 1
        y = x


def for_pass():
    for i in itertools.count():
        pass


def for_body():
    for i in itertools.count():
        x = i
        y = x


def test_fails():
    for i in itertools.count():
        if i < 0:
            x = 1


def test_holds():
    for i in itertools.count():
        if i >= 0:
            x = 1
        else:
            x = 2


def test_fails_with_else():
    for i in itertools.count():
        if i < 0:
            x = 1
        else:
            x = 2


def continues():
    for i in itertools.count():
        if i >= 0:
            continue
        x = 2


def with_finally():
    for i in itertools.count():
        try:
            x = 1
        finally:
            y = 2


def with_handler():
    for i in itertools.count():
        try:
            x = 1
        except ValueError:
            y = 2


def nested():
    while True:
        for i in (1, 2):
            x = i


def nested_with_more():
    while True:
        for i in ():
            x = i
        y = 1


def matches():
    for i in itertools.count():
        match i:
            case -1:
                x = 1
            case _:
                x = 2


def over_lines():
    for i in itertools.count():
        x = (i,
             i)


def comprehension():
    return [i for i in itertools.count() if i < 0]


def comprehension_over_lines():
    return [i
            for i in itertools.count()
            if i < 0]


signal.signal(signal.SIGALRM, handler)
for function in (while_pass, while_true, while_test, for_pass, for_body, test_fails, test_holds, test_fails_with_else, continues, with_finally, with_handler,
                 nested_with_more, matches, over_lines, comprehension, comprehension_over_lines):
    running = function
    signal.setitimer(signal.ITIMER_REAL, 0.01)
    try:
        function()
    except Stop as e:
        traceback = e.__traceback__.tb_next
        print(function.__name__, traceback.tb_lineno - function.__code__.co_firstlineno, traceback.tb_frame.f_lineno - function.__code__.co_firstlineno)

# In `nested` it is one loop or the other.
running = nested
signal.setitimer(signal.ITIMER_REAL, 0.01)
try:
    nested()
except Stop as e:
    print('nested', e.__traceback__.tb_next.tb_lineno - nested.__code__.co_firstlineno in (2, 3))
