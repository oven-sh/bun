# Tracebacks through generators that have not started; exceptions that cannot be made.
import traceback
def deco(f): return f
@deco
def f(a,
      b=1):
    try:
        yield
    except:
        raise
def entries(e):
    return [(t.tb_frame.f_code.co_name, t.tb_lineno, t.tb_frame.f_lineno) for t in iter_tb(e.__traceback__)]
def iter_tb(tb):
    while tb:
        yield tb
        tb = tb.tb_next
g = f(1)
try:
    g.throw(ValueError("x"))
except Exception as e:
    print(entries(e))
async def c():
    pass
co = c()
try:
    co.throw(ValueError("x"))
except Exception as e:
    print(entries(e))
async def ag():
    yield 1
a = ag()
try:
    a.athrow(ValueError("x")).send(None)
except Exception as e:
    print(entries(e))
# thrown into a delegate that has not started
def outer():
    yield from f(1)
o = outer()
try:
    o.throw(KeyError("k"))
except Exception as e:
    print(entries(e))
def outer2(inner):
    yield 0
    yield from inner
# bad exceptions
class E(Exception):
    def __new__(cls, *args, **kwargs): return cls
class F(Exception):
    def __init__(self): raise KeyError("init")
def boring():
    yield
for cls in (E, F):
    gen = boring()
    try:
        gen.throw(cls)
    except Exception as e:
        print(type(e).__name__, e, entries(e))
    print(next(gen, "done"))
    def catching():
        try:
            yield
        except Exception as e:
            print("caught", type(e).__name__, e)
    gen = catching(); next(gen)
    try:
        gen.throw(cls)
    except StopIteration:
        print("stopped")
for args in ((1,), (ValueError(), 1), (ValueError, 1, 2)):
    gen = boring(); next(gen)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            gen.throw(*args)
        except Exception as e:
            print(type(e).__name__, e)
    print(next(gen, "done"))
