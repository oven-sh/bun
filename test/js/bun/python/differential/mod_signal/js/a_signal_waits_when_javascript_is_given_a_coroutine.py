# What a_signal_waits_when_javascript_is_given_a_coroutine.js calls. Each of these raises the signal while it is called, in code that is written in C, and gives back a coroutine.
import ctypes, functools, itertools, signal, types
N = int(signal.SIGUSR1); log = []
raise_for = functools.partial(ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.py_object)(('raise', ctypes.CDLL(None))), N)
def notes(number, frame): log.append('the handler is called in %s' % (frame.f_code.co_name if frame else 'no frame'))
def raises(number, frame): notes(number, frame); raise KeyError('raised by the handler')
def handle_with(handler): signal.signal(N, handler)
async def function(): return 'the coroutine has run'
made = []
def coroutine(): made.append(function()); return made[-1]
def raises_it_and_gives(c): return functools.partial(max, c, c, key=raise_for)
def a_partial(): return raises_it_and_gives(coroutine())
def an_instance(): return type('Instance', (), {'__call__': staticmethod(raises_it_and_gives(coroutine()))})()
def a_bound_method(): c = coroutine(); return types.MethodType(functools.partial(max, c, key=raise_for), c)
def a_class(): return type('Class', (), {'__new__': staticmethod(raises_it_and_gives(coroutine()))})
def a_class_whose_class_has_a_call(): return type('Meta', (type,), {'__call__': staticmethod(raises_it_and_gives(coroutine()))})('Class', (), {})
def a_method_written_in_c(): return itertools.filterfalse(raise_for, iter([coroutine()])).__next__
def take():
    text = ', '.join(log) or 'the handler is not called'; del log[:]
    for c in made: c.close()
    del made[:]; return text
