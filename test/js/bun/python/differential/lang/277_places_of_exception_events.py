# The lines of the places that RAISE, RERAISE, EXCEPTION_HANDLED, PY_UNWIND and PY_THROW name. What a handler begins with is of no line, but for the handler of
# a `with` or an `async for`; so are the handler around a handler, which puts back what was being handled and raises the exception again, and the one that all of
# a generator is in.
import sys
M = sys.monitoring; E = M.events
class CM:
    def __enter__(self): return self
    def __exit__(self, *a): return False
class SW:
    def __enter__(self): return self
    def __exit__(self, *a): return True
SRC = {
'except': '''
def f():
    try:
        raise KeyError
    except KeyError:
        x = 1
    return 1
''',
'except as': '''
def f():
    try:
        raise KeyError
    except KeyError as e:
        x = 1
    return 1
''',
'no match': '''
def f():
    try:
        raise KeyError
    except ValueError:
        x = 1
    return 1
''',
'second': '''
def f():
    try:
        raise KeyError
    except ValueError:
        x = 1
    except KeyError:
        x = 2
    return 1
''',
'bare': '''
def f():
    try:
        raise KeyError
    except:
        x = 1
    return 1
''',
'finally': '''
def f():
    try:
        raise KeyError
    finally:
        x = 1
    return 1
''',
'with': '''
def f():
    with CM():
        raise KeyError
    return 1
''',
'with swallowed': '''
def f():
    with SW():
        raise KeyError
    return 1
''',
'raise in handler': '''
def f():
    try:
        raise KeyError
    except KeyError:
        raise ValueError
    return 1
''',
'reraise in handler': '''
def f():
    try:
        raise KeyError
    except KeyError:
        raise
    return 1
''',
'raise in handler as': '''
def f():
    try:
        raise KeyError
    except KeyError as e:
        raise ValueError
    return 1
''',
'nested': '''
def f():
    try:
        try:
            raise KeyError
        except ValueError:
            x = 1
    except KeyError:
        x = 2
    return 1
''',
'nested finally': '''
def f():
    try:
        try:
            raise KeyError
        finally:
            x = 1
    except KeyError:
        x = 2
    return 1
''',
'callee': '''
def g():
    raise KeyError
def f():
    try:
        g()
    except KeyError:
        x = 1
    return 1
''',
'for': '''
def f():
    for i in (1, 2):
        try:
            raise KeyError
        except KeyError:
            continue
    return 1
''',
'except star': '''
def f():
    try:
        raise ExceptionGroup('g', [KeyError()])
    except* KeyError:
        x = 1
    return 1
''',
'generator': '''
def g():
    try:
        yield 1
    except KeyError:
        yield 2
def f():
    it = g(); next(it); it.throw(KeyError); it.close()
    return 1
''',
'comprehension': '''
def f():
    try:
        [1 // i for i in (1, 0)]
    except ZeroDivisionError:
        x = 1
    return 1
''',
'with as': '''
def f():
    with CM() as c:
        raise KeyError
    return 1
''',
'two withs': '''
def f():
    with CM(), SW():
        raise KeyError
    return 1
''',
'two withs, the other way': '''
def f():
    with SW(), CM():
        raise KeyError
    return 1
''',
'with over lines': '''
def f():
    with (CM() as a,
          CM() as b):
        raise KeyError
    return 1
''',
'with in try': '''
def f():
    try:
        with CM():
            raise KeyError
    except KeyError:
        x = 1
    return 1
''',
'try in with': '''
def f():
    with CM():
        try:
            raise KeyError
        except ValueError:
            x = 1
    return 1
''',
'finally in a loop': '''
def f():
    for i in (1, 2):
        try:
            raise KeyError
        finally:
            break
    return 1
''',
'return in finally': '''
def f():
    try:
        raise KeyError
    finally:
        return 1
''',
'else': '''
def f():
    try:
        x = 1
    except KeyError:
        x = 2
    else:
        raise ValueError
    return 1
''',
'handler in handler': '''
def f():
    try:
        raise KeyError
    except KeyError:
        try:
            raise ValueError
        except ValueError:
            x = 1
    return 1
''',
'async with': '''
class ACM:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
async def c():
    async with ACM():
        raise KeyError
def f():
    try:
        c().send(None)
    except StopIteration:
        pass
''',
'out of a generator': '''
def g():
    yield 1
    raise KeyError
def f():
    for x in g():
        pass
''',
'out of a coroutine': '''
async def c():
    raise KeyError
def f():
    c().send(None)
''',
'out of an asynchronous generator': '''
async def a():
    yield 1
    raise KeyError
async def c():
    async for x in a():
        pass
def f():
    c().send(None)
''',
'out of a generator expression': '''
def f():
    return list(1 // x for x in (1, 0))
''',
'StopIteration in a generator': '''
def g():
    yield 1
    raise StopIteration
def f():
    for x in g():
        pass
''',
'thrown into one that has not started': '''
def g():
    yield 1
def f():
    g().throw(KeyError)
''',
'through a generator that delegates': '''
def inner():
    yield 1
    raise KeyError
def g():
    yield from inner()
def f():
    for x in g():
        pass
''',
}
def line_of(code, offset):
    for s, e, l in code.co_lines():
        if s <= offset < e: return l
    return '?'
log = []
def cb(n):
    def f(code, offset, *rest):
        if code.co_filename == 'g': log.append('%s:%s' % (n, line_of(code, offset)))
    return f
M.use_tool_id(1, 't')
names = {E.RAISE: 'RAISE', E.RERAISE: 'RERAISE', E.EXCEPTION_HANDLED: 'HANDLED', E.PY_UNWIND: 'UNWIND', E.PY_THROW: 'THROW'}
mask = 0
for e, n in names.items(): M.register_callback(1, e, cb(n)); mask |= e
for name, src in SRC.items():
    ns = {'CM': CM, 'SW': SW}
    exec(compile(src, 'g', 'exec'), ns)
    log.clear(); M.set_events(1, mask)
    try: ns['f']()
    except BaseException as e: log.append(type(e).__name__)
    M.set_events(1, 0)
    print('%-20s' % name, ' '.join(log))
