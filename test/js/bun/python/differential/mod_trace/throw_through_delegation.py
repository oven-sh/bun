# throw() and close() of a generator that delegates: what was thrown goes to the innermost one first, and the outer ones are resumed only
# if it comes back. All the events that tools are told of.
import sys
M = sys.monitoring; E = M.events
names = ['PY_START','PY_RESUME','PY_RETURN','PY_YIELD','LINE','RAISE','RERAISE','EXCEPTION_HANDLED','PY_UNWIND','PY_THROW','STOP_ITERATION']
ev = []
def mk(n):
    def cb(code, *a):
        if code.co_filename == __file__ and code.co_name != 'run':
            x = a[-1] if n in ('RAISE','RERAISE','EXCEPTION_HANDLED','PY_UNWIND','PY_THROW','STOP_ITERATION') else (a[0] - code.co_firstlineno if n == 'LINE' else '')
            ev.append('%s:%s%s' % (code.co_name, n, ':' + (type(x).__name__ if isinstance(x, BaseException) else str(x)) if x != '' else ''))
    return cb
def inner_plain():
    yield 1
    yield 2
def inner_catches():
    try:
        yield 1
    except ValueError:
        yield 'caught'
def inner_returns():
    try:
        yield 1
    except ValueError:
        return 'ret'
def inner_raises_on_next():
    yield 1
    raise KeyError
def outer(i):
    x = yield from i()
    yield ('after', x)
def outer_try(i):
    try:
        x = yield from i()
    except (ValueError, KeyError):
        yield 'outer caught'
def outer2(i):
    x = yield from outer(i)
    yield x
def run(title, g, ops):
    M.use_tool_id(1, 't')
    s = 0
    for n in names:
        M.register_callback(1, getattr(E, n), mk(n)); s |= getattr(E, n)
    M.set_events(1, s)
    res = []
    for op in ops:
        try:
            if op == 'next': res.append(next(g))
            elif op == 'throw': res.append(g.throw(ValueError))
            elif op == 'close': res.append(g.close())
        except BaseException as e:
            res.append(type(e).__name__)
    M.set_events(1, 0); M.free_tool_id(1)
    print(title, res)
    for e in ev: print('   ', e)
    del ev[:]
run('plain throw', outer(inner_plain), ['next', 'throw'])
run('caught inside', outer(inner_catches), ['next', 'throw', 'next'])
run('returns', outer(inner_returns), ['next', 'throw'])
run('outer catches', outer_try(inner_plain), ['next', 'throw'])
run('raises on next', outer(inner_raises_on_next), ['next', 'next'])
run('raises on next, caught', outer_try(inner_raises_on_next), ['next', 'next'])
run('close', outer(inner_plain), ['next', 'close'])
run('close caught', outer(inner_catches), ['next', 'close'])
run('two levels', outer2(inner_plain), ['next', 'throw'])
run('two levels caught', outer2(inner_catches), ['next', 'throw'])
run('no delegate', inner_plain(), ['next', 'throw'])
run('no delegate caught', inner_catches(), ['next', 'throw'])


# ---- await, and what a trace function and a profiler make of it ----
import asyncio
import cProfile
import contextlib
import pstats

trace = []


def tracer(frame, event, arg):
    if frame.f_code.co_filename == __file__ and frame.f_code.co_name != 'run':
        trace.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer


class Awaitable:
    def __await__(self):
        yield 'waiting'
        return 'done'


async def leaf():
    try:
        return await Awaitable()
    except ValueError:
        return await Awaitable()


async def middle():
    return await leaf()


async def top():
    with contextlib.suppress(KeyError): return await middle()
    return 'suppressed'


for thrown in (ValueError, KeyError):
    coroutine = top()
    sys.settrace(tracer)
    steps = [coroutine.send(None)]
    try:
        steps.append(coroutine.throw(thrown))
        steps.append(coroutine.send(None))
    except StopIteration as e:
        steps.append(('returned', e.value))
    sys.settrace(None)
    print(thrown.__name__, steps)
    for event in trace:
        print('   ', *event)
    del trace[:]


def one_line():
    with contextlib.suppress(ValueError): yield 1
    yield 2


generator = one_line()
sys.settrace(tracer)
steps = [next(generator), generator.throw(ValueError)]
sys.settrace(None)
print('handler on the line of the yield', steps, trace)
del trace[:]


async def cancelled():
    task = asyncio.ensure_future(middle_sleeps())
    await asyncio.sleep(0)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return 'cancelled'


async def middle_sleeps():
    await sleeps()


async def sleeps():
    await asyncio.sleep(10)


profiler = cProfile.Profile()
profiler.enable()
result = asyncio.run(cancelled())
profiler.disable()
print(result)
for (filename, line, name), (primitive, total, _, _, _) in sorted(pstats.Stats(profiler).stats.items()):
    if filename == __file__:
        print('   ', name, primitive, total)
