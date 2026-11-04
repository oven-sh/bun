# What a function knows of its code, asked of functions that have never been called, whose code comes from source and from a .pyc.
try: import gc, importlib, os, pickle, sys, tempfile, threading, traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, importlib, os, pickle, sys, tempfile, threading, traceback')

try: SOURCE = r'''
import functools, gc, types

def plain(a, b):
    "doc of plain"
    return a + b

def no_doc(): pass

def renamed(): "doc of renamed"
def other(x, y, z=3): "doc of other"

class C:
    "doc of C"
    def method(self): "doc of method"
    @property
    def prop(self): "doc of prop"
    @staticmethod
    def static(): "doc of static"
    @classmethod
    def klass(cls): "doc of klass"
    class Inner:
        def deep(self):
            def local(): "doc of local"
            return local

def wrapped(): "doc of wrapped"
@functools.wraps(wrapped)
def wrapper(): "doc of wrapper"

def generator():
    "doc of generator"
    yield 1

async def coroutine(): "doc of coroutine"

def raises(): raise ValueError("from raises")
def calls_raises(): raises()

# Every combination of what a `def` may come with.
def combinations():
    free = "free"; second = 2.0
    def f0(): pass
    def f1(a=1): pass
    def f2(*, k=2): pass
    def f3(a=1, *, k=2): pass
    def f4(a: int): pass
    def f5(a: int = 1): pass
    def f6(*, k: int = 2): pass
    def f7(a: int = 1, *, k: str = 2) -> None: pass
    def c0(): return free
    def c1(a=1): return free
    def c2(*, k=2): return free
    def c3(a=1, *, k=2): return free
    def c4(a: int): return free
    def c5(a: int = 1): return free
    def c6(*, k: int = 2): return free
    def c7(a: int = 1, *, k: str = 2) -> None: return second, free, combinations
    return [f0, f1, f2, f3, f4, f5, f6, f7, c0, c1, c2, c3, c4, c5, c6, c7, lambda: 0, lambda a=1: free, lambda *, k=2: (free, a)]

def deep(n, collect):
    def next_one(m): return deep(m, collect)
    return next_one(n - 1) if n else collect()
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SOURCE = r\'\'\' import functools, gc, types def plain(a, b): "doc of pl...')


try:
    def show(m):
        def three(f): return (f.__name__, f.__qualname__, f.__doc__)
        print(three(m.plain), m.plain.__module__)
        print(three(m.no_doc))
        print(repr(m.C.method).split(" at ")[0], repr(m.C.Inner.deep).split(" at ")[0])
        print(three(m.C.method), three(m.C.static), three(m.C.klass), three(m.C.__dict__["static"]), three(m.C.__dict__["klass"]))
        print(m.C.prop.__doc__, three(m.C.prop.fget))
        print(three(m.wrapper), three(m.wrapper.__wrapped__))
        print(three(m.C.Inner().deep()))

        # What is set stays; what is not set is still the code's.
        m.renamed.__name__ = "new_name"
        print(three(m.renamed))
        m.renamed.__qualname__ = "new.qualname"
        m.renamed.__doc__ = None
        print(three(m.renamed))
        del m.renamed.__doc__
        print(three(m.renamed))

        # They are those of the code at the `def`, not of the code it has now.
        m.other.__code__ = m.plain.__code__
        print(three(m.other), m.other.__code__.co_name, m.other.__code__.co_qualname, m.other.__defaults__, m.other(1, 2))
        m.no_doc.__name__ = "set_first"
        m.no_doc.__code__ = m.plain.__code__
        print(three(m.no_doc))

        # Messages name a function that has not run yet.
        for call in (lambda: m.C.method(), lambda: m.plain(1, 2, 3), lambda: m.wrapped(k=1)):
            try: call()
            except TypeError as e: print(e)
        try: m.calls_raises()
        except ValueError as e: print([(f.name, f.lineno) for f in traceback.extract_tb(e.__traceback__)][1:])

        print(pickle.loads(pickle.dumps(m.plain)) is m.plain, pickle.dumps(m.C.Inner.deep, 4).count(b"C.Inner.deep"))

        g = m.generator()
        print(g.__name__, g.__qualname__, three(m.generator))
        m.generator.__name__ = "other_generator"
        print(m.generator().__name__, m.generator().__qualname__, g.__name__)
        c = m.coroutine(); print(c.__name__, c.__qualname__); c.close()

        for f in m.combinations():
            print(f.__name__, f.__qualname__, f.__defaults__, f.__kwdefaults__, f.__annotations__, [type(c.cell_contents).__name__ for c in f.__closure__ or ()], f.__code__.co_freevars)

        print(sorted(x for x in gc.get_referents(m.wrapped) if isinstance(x, str)))
        made = m.types.FunctionType(m.wrapped.__code__, {}, "given")
        print(three(made), made.__module__)

        # The first call of all is on another thread, and the collector runs under frames of functions called for the first time.
        results = []
        thread = threading.Thread(target=lambda: results.append(m.deep(40, gc.collect) is not None))
        thread.start(); thread.join()
        print(results, m.deep(40, lambda: len(traceback.extract_stack())) > 80)
        print(three(m.deep))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(m):')


try:
    with tempfile.TemporaryDirectory() as directory:
        with open(os.path.join(directory, "only_defined.py"), "w") as file:
            file.write(SOURCE)
        sys.path.insert(0, directory)
        sys.pycache_prefix = os.path.join(directory, "cache")
        for origin in ("source", "cache"):
            print("----", 'origin [' + 'origin=' + (repr(origin) if type(origin) in (str, int, float, bytes, bool, type(None)) or (type(origin) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in origin)) else origin.__name__ if type(origin) is type else type(origin).__name__) + '] =>', origin)
            importlib.invalidate_caches()
            module = importlib.import_module("only_defined")
            print('os.path.exists(module.__spec__.cached) [' + 'origin=' + (repr(origin) if type(origin) in (str, int, float, bytes, bool, type(None)) or (type(origin) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in origin)) else origin.__name__ if type(origin) is type else type(origin).__name__) + '] =>', os.path.exists(module.__spec__.cached))
            show(module)
            del sys.modules["only_defined"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with tempfile.TemporaryDirectory() as directory:')
