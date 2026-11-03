try:
    def inner():
        try: raise LookupError("inner")
        except LookupError: yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')
try:
    def outer():
        try: raise IndexError("outer")
        except IndexError: yield from inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: g = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = outer()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(ValueError("thrown"))
    except ValueError as e: print(repr(e.__context__), repr(e.__context__.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(ValueError("thrown"))')
try:
    class It:
        def __iter__(self): return self
        def __next__(self): return 1
        def throw(self, e): raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It:')
try:
    def over():
        try: raise IndexError("over")
        except IndexError: yield from It()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over():')
try: g = over()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = over()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(ValueError("thrown"))
    except ValueError as e: print(repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(ValueError("thrown"))')
try:
    def plain():
        yield from inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain():')
try: g = plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = plain()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(ValueError("thrown"))
    except ValueError as e: print(repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(ValueError("thrown"))')
# the same through coroutines, and with a delegate that ends instead
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')
try:
    @types.coroutine
    def pause(): yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pause(): yield')
try:
    async def cinner():
        try: raise LookupError("cinner")
        except LookupError: await pause()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cinner():')
try:
    async def couter():
        try: raise IndexError("couter")
        except IndexError: await cinner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def couter():')
try: c = couter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = couter()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try:
    try: c.throw(ValueError("thrown"))
    except ValueError as e: print(repr(e.__context__), repr(e.__context__.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.throw(ValueError("thrown"))')
try:
    def swallow():
        try: yield
        except ValueError: return "swallowed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def swallow():')
try:
    def around():
        try: raise IndexError("around")
        except IndexError: print((yield from swallow()))
        yield "after"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def around():')
try: g = around()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = around()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.throw(ValueError("thrown")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("thrown"))')
# the exception that is being handled is thrown in again: no cycle
try:
    def again():
        try: raise KeyError("again")
        except KeyError as e:
            try: yield e
            except KeyError as f: print(f is e, f.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def again():')
try: g = again()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = again()')
try: e = next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = next(g)')
try:
    try: g.throw(e)
    except StopIteration: print("done")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(e)')
try:
    def again_outer():
        try: raise KeyError("outer again")
        except KeyError as e:
            try: yield from It2(e)
            except KeyError as f: print(f is e, f.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def again_outer():')
try:
    class It2:
        def __init__(self, e): self.e = e
        def __iter__(self): return self
        def __next__(self): return self.e
        def throw(self, e): raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It2:')
try: g = again_outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = again_outer()')
try: e = next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = next(g)')
try:
    try: g.throw(e)
    except StopIteration: print("done")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(e)')
