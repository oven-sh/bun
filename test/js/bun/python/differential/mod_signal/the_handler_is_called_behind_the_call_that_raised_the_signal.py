# CPython looks for signals after every call, and code counts on it: the signal is raised, and when the call returns the handler has run, in the frame of whoever made the call. Whatever it is that was called: a function
# written in C, a function pointer of ctypes, an instance with a __call__, a bound method, a partial, a class.
import ctypes, functools, itertools, os, signal, sys, threading, types
libc = ctypes.CDLL(None); N = signal.SIGUSR1
c_raise = getattr(libc, 'raise'); raise_and_return_nothing = ctypes.CFUNCTYPE(None, ctypes.c_int)(('raise', libc))
log = []
def notes(number, frame): log.append('the handler, in %s' % (frame.f_code.co_name if frame else None))
class Instance: __call__ = c_raise
class Class: __init__ = staticmethod(functools.partial(raise_and_return_nothing, N))
class Meta(type): pass
class ClassOfAMetaclass(metaclass=Meta): __init__ = staticmethod(functools.partial(raise_and_return_nothing, N))
instance, partial, method = Instance(), functools.partial(c_raise, N), types.MethodType(c_raise, N)
def a_function_pointer_of_ctypes(): c_raise(N); log.append('the next statement')
def an_instance_with_a_call(): instance(N); log.append('the next statement')
def a_partial(): partial(); log.append('the next statement')
def a_bound_method(): method(); log.append('the next statement')
def a_class(): Class(); log.append('the next statement')
def a_class_of_a_metaclass(): ClassOfAMetaclass(); log.append('the next statement')
def os_kill(): os.kill(os.getpid(), N); log.append('the next statement')
def signal_raise_signal(): signal.raise_signal(N); log.append('the next statement')
signal.signal(N, notes)
for road in (a_function_pointer_of_ctypes, an_instance_with_a_call, a_partial, a_bound_method, a_class, a_class_of_a_metaclass, os_kill, signal_raise_signal):
    del log[:]; road(); print('%-30s %s' % (road.__name__, log))

# In another thread the signal is not for that thread to handle. The calls that it makes look behind themselves, find nothing that is theirs, and leave it where it is: the main thread calls the handler, once.
def in_another_thread():
    c_raise(N); len(()); partial_of_len(); Plain(); log.append('the thread goes on, in %s' % threading.current_thread().name)
class Plain: pass
partial_of_len = functools.partial(len, ())
signal.signal(N, lambda number, frame: log.append('the handler, in %s' % threading.current_thread().name))
del log[:]; thread = threading.Thread(target=in_another_thread, name='another thread'); thread.start(); thread.join()
for turn in 1, 2: pass
print('%-30s %s' % ('in another thread', sorted(log)))
signal.signal(N, notes)

# So a handler that raises its own signal again is called in itself, and again, up to the recursion limit: the call that is refused raises nothing more, and that is the end of it.
# (What is called is called straight from the handler, and nothing that is written in C is called behind it: a function of Python's looks at its entry, and behind len() everybody has always looked.)
for name, source in (('a function pointer of ctypes', 'c_raise(N)'), ('a partial', 'partial()'), ('os.kill()', 'os.kill(os.getpid(), N)'), ('signal.raise_signal()', 'signal.raise_signal(N)')):
    for most in 4, 0:
        space = dict(globals()); exec(compile('''
def nests(most):
    calls = []
    def handler(number, frame):
        calls.append(frame.f_code.co_name if frame else None); count = len(calls)
        if not most or count < most: TRIP
        raise KeyError(count)
    signal.signal(N, handler)
    def program(): TRIP; log.append("not reached")
    try: program(); caught = None
    except BaseException as e: caught = "%s%s" % (type(e).__name__, e.args if isinstance(e, KeyError) else "")
    # (How many there are for ever goes by the depth at which it begins, and on a build with great frames by the stack.)
    return "%s calls, the first three in %s; the program gets %s" % (len(calls) if most else "hundreds of" if len(calls) > 100 else "ONLY %d" % len(calls), calls[:3], caught)
'''.replace('TRIP', source), 'nests', 'exec'), space)
        print('the handler raises it again by %-30s %-9s %s' % (name + ',', 'for ever:' if not most else 'thrice:', space['nests'](most)))

# Not between the __enter__ of a `with` and its block: what a handler raises there would leave what has been entered without its __exit__.
def raises(number, frame): raise KeyError('raised by the handler')
signal.signal(N, raises)
class Entered:
    __enter__ = staticmethod(functools.partial(raise_and_return_nothing, N))
    def __exit__(self, kind, value, traceback): print('__exit__ is called with', kind.__name__ if kind else None); return True
with Entered():
    log.append('in the block')
print('behind the with')

# Nor between the __aenter__ of an `async with` and its block. What __aenter__ gives is awaited on the way: if that is code of Python's the handler is called in it, and nothing has been entered yet.
# (In the block there is a loop, where everybody looks. Behind list.append() CPython looks in code that is new to it and no longer once it has run it a few times.)
def notes_and_raises(number, frame): log.append('the handler, in %s, %s' % (frame.f_code.co_name, where)); raise KeyError('raised by the handler')
signal.signal(N, notes_and_raises)
raise_for = functools.partial(ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.py_object)(('raise', libc)), N)
class Ready: __await__ = staticmethod(functools.partial(iter, ()))
class ReadyByAFunctionOfPython:
    def __await__(self): return iter(())
for what, raises_it_and_gives in (('a partial', lambda a: functools.partial(max, a, a, key=raise_for)), ('a method written in C', lambda a: itertools.filterfalse(raise_for, itertools.repeat(a)).__next__)):
    for awaitable in Ready(), ReadyByAFunctionOfPython():
        class EnteredAsync:
            __aenter__ = staticmethod(raises_it_and_gives(awaitable))
            async def __aexit__(self, kind, value, traceback): log.append('__aexit__ is called with %s' % (kind.__name__ if kind else None)); return True
        async def road():
            global where
            async with EnteredAsync():
                where = 'in the block'
                for i in 1, 2: pass
            where = 'behind the block'
        del log[:]; where = 'before the block'
        try: road().send(None)
        except BaseException as e: log.append('out of it comes %s, %s' % (type(e).__name__, where))
        print('__aenter__ is %s and gives a %s: %s' % (what, type(awaitable).__name__, log))
