# An exception that goes on past a `finally`, a `with` or an `except` that does not match: what is being handled is put back on the way,
# whoever listens is told of each step, and a tool that raises takes the place of the exception.
import sys


class CM:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        print('  exit sees', repr(sys.exception()))
        return False


def through_finally():
    try:
        raise ValueError('inner')
    finally:
        print('  finally sees', repr(sys.exception()))


def through_with():
    with CM():
        raise ValueError('inner')


def through_except():
    try:
        raise ValueError('inner')
    except KeyError:
        pass


def through_named_handler():
    try:
        raise ValueError('first')
    except ValueError as e:
        raise ValueError('inner')


def through_all():
    try:
        with CM():
            try:
                try:
                    raise ValueError('inner')
                except KeyError:
                    pass
            finally:
                print('  finally sees', repr(sys.exception()))
    finally:
        print('  outer finally sees', repr(sys.exception()))


async def agen():
    yield 1
    raise ValueError('inner')


async def through_async_for_body():
    async for x in agen():
        pass


def through_async_for():
    c = through_async_for_body()
    try:
        c.send(None)
    finally:
        c.close()


cases = [through_finally, through_with, through_except, through_named_handler, through_all, through_async_for]

print('--- what is being handled afterwards')
for f in cases:
    print(f.__name__)
    try:
        f()
    except ValueError as e:
        print('  caught', repr(e), repr(e.__context__), repr(sys.exception()))
    print('  after', repr(sys.exception()))
    try:
        raise KeyError('outer')
    except KeyError:
        try:
            f()
        except ValueError as e:
            print('  caught', repr(e), repr(e.__context__), repr(e.__context__ and e.__context__.__context__), repr(sys.exception()))
        print('  in the outer handler', repr(sys.exception()))

print('--- a generator suspended in the clause')


def gen():
    try:
        raise ValueError('inner')
    finally:
        print('  in gen', repr(sys.exception()))
        yield 1
        print('  in gen again', repr(sys.exception()))


g = gen()
next(g)
print(' ', repr(sys.exception()))
try:
    raise KeyError('outer')
except KeyError:
    try:
        next(g)
    except ValueError as e:
        print('  caught', repr(e), repr(e.__context__), repr(sys.exception()))
    print(' ', repr(sys.exception()))

print('--- the traceback has each frame once')
for f in cases:
    try:
        f()
    except ValueError as e:
        tb = e.__traceback__
        entries = []
        while tb:
            entries.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno))
            tb = tb.tb_next
        print(f.__name__, entries)

print('--- tools')
M = sys.monitoring
names = {f.__name__ for f in cases} | {'through_async_for_body'}
seen = []


def listen(raise_at=None):
    count = [0]

    def make(name):
        def callback(code, offset, exception):
            if code.co_name not in names:
                return
            seen.append((name, type(exception).__name__, repr(sys.exception())))
            if name == 'EXCEPTION_HANDLED':
                return
            count[0] += 1
            if count[0] == raise_at:
                raise RuntimeError('from the tool, at ' + name)
        return callback
    M.use_tool_id(2, 'test')
    mask = 0
    for name in ('RAISE', 'RERAISE', 'EXCEPTION_HANDLED', 'PY_UNWIND'):
        M.register_callback(2, getattr(M.events, name), make(name))
        mask |= getattr(M.events, name)
    M.set_events(2, mask)


def stop():
    M.set_events(2, 0)
    M.free_tool_id(2)


_print = print
for f in (through_finally, through_except, through_with, through_named_handler):
    for raise_at in (None, 1, 2, 3, 4):
        seen.clear()
        out = []
        print = lambda *a: out.append(a)
        listen(raise_at)
        try:
            try:
                raise KeyError('outer')
            except KeyError:
                try:
                    f()
                finally:
                    stop()
                    handled = repr(sys.exception())
        except BaseException as e:
            print = _print
            tb = e.__traceback__
            frames = []
            while tb:
                frames.append(tb.tb_frame.f_code.co_name)
                tb = tb.tb_next
            print(f.__name__, raise_at, repr(e), repr(e.__context__), handled, frames)
            for item in seen:
                print('   ', *item)
        print = _print
