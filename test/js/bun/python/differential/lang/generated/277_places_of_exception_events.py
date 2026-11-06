# The lines of the places that RAISE, RERAISE, EXCEPTION_HANDLED, PY_UNWIND and PY_THROW name. What a handler begins with is of no line, but for the handler of
# a `with` or an `async for`; so are the handler around a handler, which puts back what was being handled and raises the exception again, and the one that all of
# a generator is in.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')
try:
    class CM:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    class SW:
        def __enter__(self): return self
        def __exit__(self, *a): return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SW:')
try: SRC = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC = { 'except': ''' def f(): try: raise KeyError except KeyError: x...")
try:
    def line_of(code, offset):
        for s, e, l in code.co_lines():
            if s <= offset < e: return l
        return '?'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def cb(n):
        def f(code, offset, *rest):
            if code.co_filename == 'g': log.append('%s:%s' % (n, line_of(code, offset)))
        return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cb(n):')
try: M.use_tool_id(1, 't')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 't')")
try: names = {E.RAISE: 'RAISE', E.RERAISE: 'RERAISE', E.EXCEPTION_HANDLED: 'HANDLED', E.PY_UNWIND: 'UNWIND', E.PY_THROW: 'THROW'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: names = {E.RAISE: 'RAISE', E.RERAISE: 'RERAISE', E.EXCEPTION_HANDLED:...")
try: mask = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mask = 0')
try:
    for e, n in names.items(): M.register_callback(1, e, cb(n)); mask |= e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for e, n in names.items(): M.register_callback(1, e, cb(n)); mask |= e')
try:
    for name, src in SRC.items():
        try: ns = {'CM': CM, 'SW': SW}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'CM': CM, 'SW': SW}")
        try: exec(compile(src, 'g', 'exec'), ns)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(src, 'g', 'exec'), ns)")
        try: log.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
        try: M.set_events(1, mask)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, mask)')
        try: ns['f']()
        except BaseException as e: log.append(type(e).__name__)
        try: M.set_events(1, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
        try: print("'%-20s' % name [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', '%-20s' % name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%-20s' % name")
        try: print("' '.join(log) [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', ' '.join(log))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, src in SRC.items():')
