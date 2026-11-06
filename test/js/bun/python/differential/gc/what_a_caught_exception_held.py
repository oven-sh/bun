# An exception that has been caught and dropped is gone, with its traceback, the frames in that and their locals, in whichever thread it was raised and whoever looks. (An engine may well
# remember the last exception it has thrown.)
import contextlib, gc, sys, threading, types

log = []
class Local:
    def __init__(self, name): self.name = name
    def __del__(self): log.append(self.name)
class E(Exception): pass
def raises(name, error=E):
    local = Local(name)
    raise error(name)

def by_except():
    try: raises('except')
    except E: pass
def by_bare_except():
    try: raises('bare except')
    except: pass
def by_except_as():
    try: raises('except as')
    except E as e: e.args
def by_with():
    with contextlib.suppress(E): raises('with')
class Attributes:
    def __getattr__(self, name): raises(name, AttributeError)
def by_hasattr(): hasattr(Attributes(), 'hasattr')
def by_getattr(): getattr(Attributes(), 'getattr', None)
class Ends:
    def __iter__(self): return self
    def __next__(self): raises('for', StopIteration)
def by_for():
    for x in Ends(): pass
class Key:
    def __hash__(self): return 1
    def __eq__(self, other): raises('in a generator')
def by_generator():
    def g():
        try: yield {Key(): 1}[Key()]
        except E: yield
    next(g())
ways = [by_except, by_bare_except, by_except_as, by_with, by_hasattr, by_getattr, by_for, by_generator]

def frames_of_raises():
    return sum(1 for x in gc.get_objects() if type(x) is types.FrameType and x.f_code is raises.__code__)

# Another thread raises, catches, and goes on running without raising anything else: what it raised is not held for as long as it runs. (A word left on its stack may hold it for a moment: the collector is asked up to 20 times.)
for way in ways:
    caught = threading.Event(); over = []
    def work():
        way()
        caught.set()
        while not over: pass
    thread = threading.Thread(target=work); thread.start(); caught.wait()
    for attempt in range(20):
        gc.collect()
        if log: break
    print('in another thread, %s: finalized by gc.collect() while the thread runs: %s; frames that gc.get_objects() finds then: %d' % (way.__name__, log, frames_of_raises()))
    over.append(1); thread.join(); gc.collect(); log.clear()

# This thread, and nobody asks for a collection. (What is made is kept, so that a collector with generations comes to look at the old ones too.)
for way in ways:
    way()
    made = []
    while not log and len(made) < 100000:
        made.append([[] for _ in range(20)])
    print('in this thread, %s: finalized without gc.collect(): %s' % (way.__name__, log))
    del made; gc.collect(); log.clear()

# Another thread does nothing else, and is stopped wherever it happens to be.
rounds = [0]; over = []
def work():
    while not over:
        by_except(); rounds[0] += 1
interval = sys.getswitchinterval(); sys.setswitchinterval(1e-5)
thread = threading.Thread(target=work); thread.start()
frames = 0
for look in range(30):
    seen = rounds[0]
    while rounds[0] == seen: pass
    frames += frames_of_raises()
over.append(1); thread.join(); sys.setswitchinterval(interval)
print('beside a thread that raises and catches all the time: frames that gc.get_objects() finds in 30 looks:', frames)
