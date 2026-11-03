# A generator that has let go of its arguments does not keep them alive, however it is run, the first time as well as later.
import gc, weakref
class A: pass
def body(name):
    def generator(a, b):
        a = weakref.ref(a); b = weakref.ref(b)
        gc.collect()
        print(name, a() is None, b() is None)
        yield
    return generator
def case(run):
    # A generator function of its own for each, so that each is run for the first time.
    generator = body(run.__name__)
    run(generator); run(generator)
def for_loop(f):
    g = f(A(), A())
    for _ in g: break
def for_loop_over_the_call(f):
    for _ in f(A(), A()): break
def made_elsewhere(f):
    def make(): return f(A(), A())
    g = make()
    for _ in g: break
def with_next(f):
    g = f(A(), A())
    next(g)
def with_list(f):
    list(f(A(), A()))
def yield_from(f):
    def outer(): yield from f(A(), A())
    for _ in outer(): break
def send(f):
    f(A(), A()).send(None)
def keyword(f):
    for _ in f(A(), b=A()): break
def unpacked(f):
    a, = f(A(), A())
def in_a_comprehension(f):
    [x for x in f(A(), A())]
for run in (for_loop, for_loop_over_the_call, made_elsewhere, with_next, with_list, yield_from, send, keyword, unpacked, in_a_comprehension):
    case(run)
async def coroutine(a, b):
    a = weakref.ref(a); b = weakref.ref(b)
    gc.collect()
    print("coroutine", a() is None, b() is None)
async def awaits(): await coroutine(A(), A())
for _ in range(2):
    try: awaits().send(None)
    except StopIteration: pass
