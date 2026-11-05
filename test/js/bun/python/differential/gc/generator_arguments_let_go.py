# A generator that has let go of its arguments does not keep them alive, however it is run, the first time as well as later.
import gc, weakref
class A: pass
asked_later = []
def body(name, is_resumed_by_the_interpreter):
    def generator(a, b):
        a = weakref.ref(a); b = weakref.ref(b)
        gc.collect()
        if is_resumed_by_the_interpreter:
            print(name, a() is None, b() is None)
        else:
            asked_later.append((a, b))
        yield
    return generator
def calls(depth):
    return calls(depth - 1) if depth else None
def case(run, is_resumed_by_the_interpreter=True):
    # A generator function of its own for each, so that each is run for the first time.
    generator = body(run.__name__, is_resumed_by_the_interpreter)
    for _ in range(2):
        run(generator)
        if is_resumed_by_the_interpreter:
            continue
        # What resumes the generator is written in C++ and enters the interpreter anew. The frames in between do not write all of the stack they take up, and what
        # made the arguments may have left an address just there, for as long as they last. That is a matter of how the stack is laid out, not of the generator:
        # so the question is put when they are gone and something else has been there.
        calls(20)
        gc.collect()
        a, b = asked_later.pop()
        print(run.__name__, a() is None, b() is None)
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
def searched(f):
    1 in f(A(), A())
def in_a_comprehension(f):
    [x for x in f(A(), A())]
for run in (for_loop, for_loop_over_the_call, made_elsewhere, yield_from, keyword, in_a_comprehension):
    case(run)
for run in (with_next, with_list, send, unpacked, searched):
    case(run, False)
async def coroutine(a, b):
    a = weakref.ref(a); b = weakref.ref(b)
    gc.collect()
    print("coroutine", a() is None, b() is None)
async def awaits(): await coroutine(A(), A())
for _ in range(2):
    try: awaits().send(None)
    except StopIteration: pass
