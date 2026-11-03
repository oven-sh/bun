# What throw() and close() do to __context__: it is what the generator itself is handling that counts, not its callers.
try: from contextlib import contextmanager, ExitStack
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from contextlib import contextmanager, ExitStack')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def chain(e):
        out = []
        seen = 0
        while e is not None and seen < 8:
            out.append(repr(e)); e = e.__context__; seen += 1
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chain(e):')
try:
    def E(n, ctx=None):
        e = Exception(n); e.__context__ = ctx; return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def E(n, ctx=None):')
try:
    def plain():
        yield 1
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain():')
try:
    def handling():
        try:
            raise Exception('Y')
        except Exception:
            yield 1
            yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handling():')
try:
    def catcher():
        try:
            yield 1
        except Exception as e:
            print("   inside:", chain(e), "handled:", chain(sys.exception()))
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catcher():')
try:
    def outer(inner):
        yield from inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer(inner):')
try:
    def outer_handling(inner):
        try:
            raise Exception('OY')
        except Exception:
            yield from inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_handling(inner):')
try:
    class It:
        def __iter__(self): return self
        def __next__(self): return 1
        def throw(self, e): raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It:')
try:
    class NoThrow:
        def __iter__(self): return self
        def __next__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoThrow:')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(label, make, start=True, exhaust=False):')
try: attempt('suspended', plain)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('suspended', plain)")
try: attempt('unstarted', plain, start=False)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('unstarted', plain, start=False)")
try: attempt('finished', plain, exhaust=True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('finished', plain, exhaust=True)")
try: attempt('handling', handling)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('handling', handling)")
try: attempt('catcher', catcher)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('catcher', catcher)")
try: attempt('yield from gen', lambda: outer(plain()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('yield from gen', lambda: outer(plain()))")
try: attempt('yield from handling', lambda: outer(handling()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('yield from handling', lambda: outer(handling()))")
try: attempt('handling yield from', lambda: outer_handling(plain()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('handling yield from', lambda: outer_handling(plain()))")
try: attempt('handling yield from It', lambda: outer_handling(It()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('handling yield from It', lambda: outer_handling(It()))")
try: attempt('yield from It', lambda: outer(It()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('yield from It', lambda: outer(It()))")
try: attempt('yield from NoThrow', lambda: outer(NoThrow()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('yield from NoThrow', lambda: outer(NoThrow()))")
try: attempt('handling yield from NoThrow', lambda: outer_handling(NoThrow()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('handling yield from NoThrow', lambda: outer_handling(NoThrow...")
try: attempt('yield from list', lambda: outer([1, 2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('yield from list', lambda: outer([1, 2]))")
try: attempt('handling yield from list', lambda: outer_handling([1, 2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt('handling yield from list', lambda: outer_handling([1, 2]))")
# coroutines
try:
    async def co():
        await Aw()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def co():')
try:
    class Aw:
        def __await__(self):
            yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Aw:')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt_co(label):')
try: attempt_co('coroutine')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt_co('coroutine')")
# close(): GeneratorExit's context
try:
    def closing():
        try:
            yield
        except GeneratorExit as e:
            print("   GeneratorExit context:", chain(e)[1:])
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closing():')
try: g = closing()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = closing()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: raise Exception('X')
    except Exception: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: try: raise Exception('X')")

# bpo-20317
try:
    @contextmanager
    def right(exc):
        try:
            yield
        finally:
            print("  finally for", exc, "handling", chain(sys.exception()))
            raise exc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def right(exc):')
try: e1, e2, e3, e4 = Exception(1), Exception(2), Exception(3), Exception(4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e1, e2, e3, e4 = Exception(1), Exception(2), Exception(3), Exception(4)')
try:
    try:
        with ExitStack() as stack:
            stack.enter_context(right(e4))
            stack.enter_context(right(e3))
            stack.enter_context(right(e2))
            raise e1
    except Exception as exc:
        print(chain(exc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
