# The handler of a signal raises while gc.collect() calls finalizers. In CPython the handler is called in the finalizer that is running, and what it raises is ignored there. Where finalizers come
# late it may be called between two of them, and then what it raises goes on to whoever called gc.collect(). Either way there has been a collection: it is counted, and gc.callbacks hear "stop".
import ctypes, gc, signal, sys

class Alarm(Exception): pass
def handler(number, frame): raise Alarm
signal.signal(signal.SIGALRM, handler)
sys.unraisablehook = lambda unraisable: None
finalized = [0]
raise_signal = getattr(ctypes.CDLL(None), 'raise')
class F:
    def __init__(self): self.me = self
    def __del__(self): finalized[0] += 1
class Signals(F):
    def __del__(self): finalized[0] += 1; raise_signal(signal.SIGALRM)     # (os.kill() and signal.raise_signal() have the handler called before they return.)

heard = []
gc.collect(); gc.disable()
gc.callbacks.append(lambda phase, info: heard.append(phase))
before = gc.get_stats()[2]['collections']
for where in 'first', 'in the middle', 'last':
    del heard[:]; finalized[0] = 0
    # (Cyclic garbage is finalized in the order in which it was made.)
    at = { 'first': 0, 'in the middle': 5, 'last': 10 }[where]
    xs = [Signals() if i == at else F() for i in range(11)]
    del xs
    try:
        gc.collect()
        for i in range(1000): pass
    except Alarm: pass
    at_once = list(heard)
    for i in range(3): gc.collect()
    print('the one that signals comes', where, '| heard by then:', at_once, '| in the end:', heard, '| finalized:', finalized[0])
print('collections counted:', gc.get_stats()[2]['collections'] - before)
