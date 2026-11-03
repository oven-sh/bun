# What throw() and close() do to __context__: it is what the generator itself is handling that counts, not its callers.
from contextlib import contextmanager, ExitStack
import sys
def chain(e):
    out = []
    seen = 0
    while e is not None and seen < 8:
        out.append(repr(e)); e = e.__context__; seen += 1
    return out
def E(n, ctx=None):
    e = Exception(n); e.__context__ = ctx; return e
def plain():
    yield 1
    yield 2
def handling():
    try:
        raise Exception('Y')
    except Exception:
        yield 1
        yield 2
def catcher():
    try:
        yield 1
    except Exception as e:
        print("   inside:", chain(e), "handled:", chain(sys.exception()))
        raise
def outer(inner):
    yield from inner
def outer_handling(inner):
    try:
        raise Exception('OY')
    except Exception:
        yield from inner
class It:
    def __iter__(self): return self
    def __next__(self): return 1
    def throw(self, e): raise e
class NoThrow:
    def __iter__(self): return self
    def __next__(self): return 1
def attempt(label, make, start=True, exhaust=False):
    for callerHandles in (False, True):
        for withContext in (False, True):
            g = make()
            if start: next(g)
            if exhaust:
                for _ in g: pass
            z = E('Z', E('old') if withContext else None)
            try:
                if callerHandles:
                    try:
                        raise Exception('X')
                    except Exception:
                        g.throw(z)
                else:
                    g.throw(z)
            except Exception as e:
                print(label, callerHandles, withContext, chain(e))
attempt('suspended', plain)
attempt('unstarted', plain, start=False)
attempt('finished', plain, exhaust=True)
attempt('handling', handling)
attempt('catcher', catcher)
attempt('yield from gen', lambda: outer(plain()))
attempt('yield from handling', lambda: outer(handling()))
attempt('handling yield from', lambda: outer_handling(plain()))
attempt('handling yield from It', lambda: outer_handling(It()))
attempt('yield from It', lambda: outer(It()))
attempt('yield from NoThrow', lambda: outer(NoThrow()))
attempt('handling yield from NoThrow', lambda: outer_handling(NoThrow()))
attempt('yield from list', lambda: outer([1, 2]))
attempt('handling yield from list', lambda: outer_handling([1, 2]))
# coroutines
async def co():
    await Aw()
class Aw:
    def __await__(self):
        yield 1
def attempt_co(label):
    for callerHandles in (False, True):
        c = co(); c.send(None)
        z = E('Z', E('old'))
        try:
            if callerHandles:
                try: raise Exception('X')
                except Exception: c.throw(z)
            else: c.throw(z)
        except Exception as e: print(label, callerHandles, chain(e))
attempt_co('coroutine')
# close(): GeneratorExit's context
def closing():
    try:
        yield
    except GeneratorExit as e:
        print("   GeneratorExit context:", chain(e)[1:])
        raise
g = closing(); next(g)
try: raise Exception('X')
except Exception: g.close()

# bpo-20317
@contextmanager
def right(exc):
    try:
        yield
    finally:
        print("  finally for", exc, "handling", chain(sys.exception()))
        raise exc
e1, e2, e3, e4 = Exception(1), Exception(2), Exception(3), Exception(4)
try:
    with ExitStack() as stack:
        stack.enter_context(right(e4))
        stack.enter_context(right(e3))
        stack.enter_context(right(e2))
        raise e1
except Exception as exc:
    print(chain(exc))
