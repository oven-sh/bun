# Tracebacks through generators that have not started; exceptions that cannot be made.
try: import traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import traceback')
try:
    def deco(f): return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deco(f): return f')
try:
    @deco
    def f(a,
          b=1):
        try:
            yield
        except:
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(a,')
try:
    def entries(e):
        return [(t.tb_frame.f_code.co_name, t.tb_lineno, t.tb_frame.f_lineno) for t in iter_tb(e.__traceback__)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def entries(e):')
try:
    def iter_tb(tb):
        while tb:
            yield tb
            tb = tb.tb_next
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iter_tb(tb):')
try: g = f(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = f(1)')
try:
    try:
        g.throw(ValueError("x"))
    except Exception as e:
        print(entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    async def c():
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c():')
try: co = c()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: co = c()')
try:
    try:
        co.throw(ValueError("x"))
    except Exception as e:
        print(entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    async def ag():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag():')
try: a = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag()')
try:
    try:
        a.athrow(ValueError("x")).send(None)
    except Exception as e:
        print(entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# thrown into a delegate that has not started
try:
    def outer():
        yield from f(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: o = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = outer()')
try:
    try:
        o.throw(KeyError("k"))
    except Exception as e:
        print(entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    def outer2(inner):
        yield 0
        yield from inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer2(inner):')
# bad exceptions
try:
    class E(Exception):
        def __new__(cls, *args, **kwargs): return cls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception):')
try:
    class F(Exception):
        def __init__(self): raise KeyError("init")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(Exception):')
try:
    def boring():
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def boring():')
try:
    for cls in (E, F):
        try: gen = boring()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gen = boring()')
        try:
            gen.throw(cls)
        except Exception as e:
            print('type(e).__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', type(e).__name__)
            print('e [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', e)
            print('entries(e) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', entries(e))
        try: print('next(gen, "done") [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', next(gen, "done"))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gen, "done")')
        def catching():
            try:
                yield
            except Exception as e:
                print("caught", type(e).__name__, e)
        try: gen = catching()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gen = catching()')
        try: next(gen)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gen)')
        try:
            gen.throw(cls)
        except StopIteration:
            print("stopped")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (E, F):')
try:
    for args in ((1,), (ValueError(), 1), (ValueError, 1, 2)):
        try: gen = boring()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gen = boring()')
        try: next(gen)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gen)')
        try: import warnings
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                gen.throw(*args)
            except Exception as e:
                print('type(e).__name__ [' + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', type(e).__name__)
                print('e [' + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', e)
        try: print('next(gen, "done") [' + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', next(gen, "done"))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gen, "done")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for args in ((1,), (ValueError(), 1), (ValueError, 1, 2)):')
