def inner():
    try: raise LookupError("inner")
    except LookupError: yield
def outer():
    try: raise IndexError("outer")
    except IndexError: yield from inner()
g = outer(); next(g)
try: g.throw(ValueError("thrown"))
except ValueError as e: print(repr(e.__context__), repr(e.__context__.__context__))
class It:
    def __iter__(self): return self
    def __next__(self): return 1
    def throw(self, e): raise e
def over():
    try: raise IndexError("over")
    except IndexError: yield from It()
g = over(); next(g)
try: g.throw(ValueError("thrown"))
except ValueError as e: print(repr(e.__context__))
def plain():
    yield from inner()
g = plain(); next(g)
try: g.throw(ValueError("thrown"))
except ValueError as e: print(repr(e.__context__))
# the same through coroutines, and with a delegate that ends instead
import types
@types.coroutine
def pause(): yield
async def cinner():
    try: raise LookupError("cinner")
    except LookupError: await pause()
async def couter():
    try: raise IndexError("couter")
    except IndexError: await cinner()
c = couter(); c.send(None)
try: c.throw(ValueError("thrown"))
except ValueError as e: print(repr(e.__context__), repr(e.__context__.__context__))
def swallow():
    try: yield
    except ValueError: return "swallowed"
def around():
    try: raise IndexError("around")
    except IndexError: print((yield from swallow()))
    yield "after"
g = around(); next(g); print(g.throw(ValueError("thrown")))
# the exception that is being handled is thrown in again: no cycle
def again():
    try: raise KeyError("again")
    except KeyError as e:
        try: yield e
        except KeyError as f: print(f is e, f.__context__)
g = again(); e = next(g)
try: g.throw(e)
except StopIteration: print("done")
def again_outer():
    try: raise KeyError("outer again")
    except KeyError as e:
        try: yield from It2(e)
        except KeyError as f: print(f is e, f.__context__)
class It2:
    def __init__(self, e): self.e = e
    def __iter__(self): return self
    def __next__(self): return self.e
    def throw(self, e): raise e
g = again_outer(); e = next(g)
try: g.throw(e)
except StopIteration: print("done")
