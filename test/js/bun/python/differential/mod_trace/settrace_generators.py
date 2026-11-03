# Generators, coroutines and asynchronous generators under a trace function.
import re
import sys

log = []


def show(value):
    return re.sub(r' at 0x[0-9a-f]+', '', repr(value))


def tracer(frame, event, arg):
    code = frame.f_code
    if code.co_filename != __file__:
        return None
    line = frame.f_lineno - code.co_firstlineno
    if event == 'return':
        log.append((code.co_name, event, line, show(arg)))
    elif event == 'exception':
        log.append((code.co_name, event, line, arg[0].__name__, show(arg[1])))
    else:
        log.append((code.co_name, event, line))
    return tracer


def run(function, *args):
    del log[:]
    sys.settrace(tracer)
    try:
        try:
            result = function(*args)
        finally:
            sys.settrace(None)
    except BaseException as e:
        result = 'raised %r' % (e,)
    print('==', function.__name__, '->', result)
    for entry in log:
        print('  ', *entry)


def gen():
    yield 1
    x = yield 2
    return x


def iterate():
    return list(gen())


def for_over_generator():
    n = 0
    for i in gen():
        n += i
    return n


def send():
    g = gen()
    a = next(g)
    b = g.send(None)
    try:
        g.send('sent')
    except StopIteration as e:
        return a, b, e.value


def throw():
    g = gen()
    next(g)
    try:
        g.throw(ValueError('thrown'))
    except ValueError as e:
        return repr(e)


def catching():
    try:
        yield 1
    except ValueError:
        yield 2
    finally:
        x = 1


def throw_caught():
    g = catching()
    next(g)
    value = g.throw(ValueError('thrown'))
    g.close()
    return value


def close():
    g = catching()
    next(g)
    g.close()


def close_unstarted():
    g = catching()
    g.close()


def delegating():
    x = yield from gen()
    return x


def yield_from():
    return list(delegating())


def raising():
    yield 1
    raise KeyError('k')


def generator_raises():
    return list(raising())


class Awaitable:
    def __await__(self):
        yield 'suspended'
        return 'awaited'


async def coroutine():
    x = await Awaitable()
    return x


async def outer():
    return await coroutine()


def drive(c):
    steps = []
    try:
        while True:
            steps.append(c.send(None))
    except StopIteration as e:
        return steps, e.value


def run_coroutine():
    return drive(outer())


async def async_generator():
    yield 1
    await Awaitable()
    yield 2


async def async_for():
    n = 0
    async for i in async_generator():
        n += i
    return n


def run_async_for():
    return drive(async_for())


class AsyncManager:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


async def async_with():
    async with AsyncManager() as m:
        x = 1
    return x


def run_async_with():
    return drive(async_with())


async def async_comprehension():
    return [i async for i in async_generator()]


def run_async_comprehension():
    return drive(async_comprehension())


for function in [iterate, for_over_generator, send, throw, throw_caught, close, close_unstarted, yield_from, generator_raises, run_coroutine, run_async_for,
                 run_async_with, run_async_comprehension]:
    run(function)
