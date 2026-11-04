# What a trace function that asks for opcodes in the middle of a statement hears next, and so where breakpoint() stops.
import asyncio
import contextlib
import io
import pdb
import sys

events = []


def tracer(frame, event, arg):
    # (Some instructions are of no line.)
    if frame.f_code.co_filename == __file__ and frame.f_code.co_name != 'start' and frame.f_lineno is not None:
        what = (event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno)
        # How many instructions a line takes is nobody's business.
        if not events or events[-1] != what:
            events.append(what)
    return tracer


def start():
    frame = sys._getframe().f_back
    frame.f_trace = tracer
    frame.f_trace_opcodes = True
    sys.settrace(tracer)


def statement():
    a = 1
    start()
    b = 2


def last_statement():
    a = 1
    start()


def assigned():
    a = 1
    x = start()
    return x


def returned():
    a = 1
    return start()


def in_a_list():
    a = [start(),
         2]
    return a


def argument():
    a = id(start())
    return 1


def in_a_loop():
    for i in range(2):
        if not i:
            start()
    return i


def in_an_if(flag=True):
    if flag:
        start()
    else:
        flag = 2
    return flag


def in_a_with():
    with contextlib.nullcontext():
        start()
    return 1


def in_a_try():
    try:
        start()
    except ValueError:
        pass
    return 1


def in_a_handler():
    try:
        raise ValueError
    except ValueError as e:
        start()
    return 1


def in_a_match(x=1):
    match x:
        case 1:
            start()
        case _:
            pass
    return 1


def in_a_while():
    n = 0
    while n < 2:
        n += 1
        start()
    return n


def in_a_finally():
    try:
        a = 1
    finally:
        start()
    return 1


def after_and():
    [1, 2] and start()
    return 1


def two_on_a_line():
    a = 1; start(); b = 2
    return b


def method_call():
    import sys; sys.modules[__name__].start()
    return 1


def generator():
    yield 1
    start()
    yield 2


def run_generator():
    return list(generator())


class Manager:
    async def __aenter__(self):
        pass

    async def __aexit__(self, *args):
        pass


async def coroutine():
    async with Manager():
        start()
    return 1


def run_coroutine():
    try:
        coroutine().send(None)
    except StopIteration as e:
        return e.value


for function in (statement, last_statement, assigned, returned, in_a_list, argument, in_a_loop, in_an_if, in_a_with, in_a_try, in_a_handler, in_a_match, in_a_while, in_a_finally,
                 after_and, two_on_a_line, method_call, run_generator, run_coroutine):
    function()
    sys.settrace(None)
    print(function.__name__)
    for event in events[:5]:
        print('   ', *event)
    del events[:]


# ---- breakpoint() ----

def stops(title, function, commands):
    print('=====', title)
    stdin, stdout = sys.stdin, sys.stdout
    sys.stdin = io.StringIO('\n'.join(commands) + '\n')
    sys.stdout = out = io.StringIO()
    pdb.Pdb._last_pdb_instance = None
    try:
        result = function()
    finally:
        sys.settrace(None)
        sys.stdin, sys.stdout = stdin, stdout
    print(out.getvalue().replace(__file__, 'FILE'))
    print('result:', result)


def plain():
    a = 1
    breakpoint()
    b = 2
    return a + b


def at_the_end():
    x = 1
    breakpoint()


def on_one_line():
    import pdb; pdb.set_trace()
    y = 3
    return y


def value_is_used():
    x = breakpoint()
    return x


def in_loop():
    total = 0
    for i in range(3):
        total += i
        if i == 1:
            breakpoint()
    return total


def in_with():
    with contextlib.nullcontext() as c:
        breakpoint()
    return c


def after_a_test():
    [1, 2] and breakpoint()
    return 5


def twice():
    breakpoint()
    a = 1
    breakpoint()
    return a


stops('plain', plain, ['p a', 'n', 'n', 'p b', 'c'])
stops('at the end', at_the_end, ['p x', 'n', 'c'])
stops('on one line', on_one_line, ['n', 'n', 'p y', 'c'])
stops('value is used', value_is_used, ['n', 'p x', 'c'])
stops('in a loop', in_loop, ['p i, total', 'n', 'n', 'p i, total', 'c'])
stops('in a with', in_with, ['n', 'n', 'c'])
stops('after a test', after_a_test, ['n', 'c'])
stops('twice', twice, ['c', 'p a', 'c'])
stops('step', plain, ['s', 's', 's', 'c'])
stops('where', plain, ['w', 'c'])
stops('jump', plain, ['j %d' % (plain.__code__.co_firstlineno + 4), 'c'])
