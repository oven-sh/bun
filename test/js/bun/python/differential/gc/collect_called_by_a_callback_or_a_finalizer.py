# gc.collect() called where a collection is being told of, or has just found something. One of gc.callbacks runs within the collection: there the call does nothing. The finalizer of an object that
# reference counts would have freed does not: what it drops and asks to have collected is gone when the program goes on, whether or not anybody listens to the collector.
import gc, itertools, threading, time, weakref

def work():
    x = None
    for i in range(2000): x = [None] * 4000

def told_to(callback):
    heard = []
    def listen(phase, info):
        heard.append(phase); callback()
    gc.callbacks.append(listen); work(); gc.callbacks.remove(listen)
    return heard
def is_paired(heard): return heard[0::2] == ['start'] * (len(heard) // 2) and heard[1::2] == ['stop'] * (len(heard) // 2) and len(heard) % 2 == 0

quiet = told_to(lambda: None); asks = told_to(gc.collect)
print('a callback that calls gc.collect() hears of no more than twice as much as one that does nothing:', len(asks) <= 2 * len(quiet) + 4, '; start and stop in turn:', is_paired(quiet), is_paired(asks))

class Cycle:
    def __init__(self): self.me = self
class Junk: pass
def make(cls): cls()
# Whether what a finalizer of this thread drops and asks to have collected is gone when the thread goes on. Nobody asks for the collection that finds the Pool.
def finalizer_that_collects():
    dropped = []; state = {'ran': False}
    class Pool:
        def __del__(self):
            c = Cycle(); dropped.append(weakref.ref(c)); del c
            gc.collect(); state['ran'] = True
    make(Pool)
    i = 0; junk = None
    while not state['ran'] and i < 20000:
        # The same call once more: wherever the first has left the Pool behind (a frame that is over is still memory), this leaves something else. The list is there to make a collector come.
        make(Junk); junk = [None] * 4000; i += 1
    return state['ran'] and dropped[0]() is None
def nothing(phase, info): pass
print('nobody listens: what a finalizer drops and has collected is gone when the program goes on:', finalizer_that_collects())
gc.callbacks.append(nothing)
print('somebody listens:', finalizer_that_collects())
gc.callbacks.remove(nothing)

# A callback may wait, and another thread may come into a callback meanwhile. The first to come waits for a second and is the first to leave. That a thread is in a callback is the thread's own
# affair: afterwards it is so of neither. (Where a collection keeps others from beginning, no second comes, and the first gives up.)
roles = {}; second_has_come = threading.Event(); first_has_left = threading.Event(); futile = [0]
def waits(phase, info):
    me = threading.get_ident()
    if phase != 'start' or first_has_left.is_set() or futile[0] == 3: return
    if roles.setdefault('first', me) == me:
        if second_has_come.wait(0.2): first_has_left.set()
        else:
            futile[0] += 1; del roles['first']
    elif roles.setdefault('second', me) == me:
        second_has_come.set(); first_has_left.wait(2); time.sleep(0.02)
class D:
    def __del__(self): pass
results = []; both_are_done = threading.Barrier(2); one_at_a_time = threading.Lock()
def work():
    for i in range(12):
        if first_has_left.is_set() or futile[0] == 3: break
        D(); many = list(map(list, itertools.repeat((), 300000))); del many
    both_are_done.wait()
    # (While one thread collects, gc.collect() in another does nothing in CPython.)
    with one_at_a_time: results.append(finalizer_that_collects())
gc.callbacks.append(waits)
threads = [threading.Thread(target=work) for i in range(2)]
for thread in threads: thread.start()
for thread in threads: thread.join()
results.append(finalizer_that_collects())
print('after two threads have been in callbacks at the same time, in each of three threads:', results)
