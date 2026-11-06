# A signal that arrives while a `with` statement calls an __enter__ written in C is not looked at between that call and the statements: what its handler
# raises is raised in the statement, and __exit__ is called. After any other call it is looked at there and then. Nor is it looked at between the end of what
# `async with` awaits and the statements.
import _thread, signal, threading, time, warnings
interrupt = _thread.interrupt_main

# Found in the type, __enter__ is either something to call as it is, or a function of the type to call with the object.
class CalledAsItIs:
    __enter__ = staticmethod(interrupt)
    def __init__(self, log, name='exit'): self.log = log; self.name = name
class CalledWithTheObject(staticmethod):
    __enter__ = staticmethod.__call__
    def __new__(cls, log, name='exit'): return staticmethod.__new__(cls, interrupt)
    def __init__(self, log, name='exit'): staticmethod.__init__(self, interrupt); self.log = log; self.name = name

def managers(base):
    global Manager, Swallows, InPython, Quiet
    class Manager(base):
        def __exit__(self, kind, value, traceback):
            self.log.append('%s %s' % (self.name, kind and kind.__name__))
    class Swallows(Manager):
        def __exit__(self, kind, value, traceback):
            Manager.__exit__(self, kind, value, traceback)
            return True
    class InPython(Manager):
        def __enter__(self): interrupt()
    class Quiet(Manager):
        def __enter__(self): return self

# What is awaited ends with the interrupt.
class Interrupts:
    def __await__(self): return iter(interrupt, None)

class Nothing:
    def __await__(self): return iter(())

class AsyncManager:
    def __init__(self, log, name='aexit'): self.log = log; self.name = name
    def __aenter__(self): return Interrupts()
    def __aexit__(self, kind, value, traceback):
        self.log.append('%s %s' % (self.name, kind and kind.__name__))
        return Nothing()

def plain(log):
    interrupt(); log.extend(['a'])
def assigned(log):
    x = interrupt(); log.extend(['a'])
def before_try(log):
    interrupt()
    try:
        log.extend(['a'])
    finally:
        log.append('finally')
def in_try(log):
    try:
        interrupt(); log.extend(['a'])
    finally:
        log.append('finally')
def call_in_body(log):
    with Manager(log):
        log.extend(['body'])
    log.append('after')
def named(log):
    with Manager(log) as x:
        log.extend(['body', x])
    log.append('after')
def empty_body(log):
    with Manager(log):
        pass
    log.append('after')
def no_call_in_body(log):
    with Manager(log):
        x = 1
        y = [x, x]
    log.append('after')
def loop_in_body(log):
    with Manager(log):
        for i in (1, 2, 3): pass
        log.extend(['looped'])
    log.append('after')
def while_in_body(log):
    i = 0
    with Manager(log):
        while i < 3: i += 1
        log.extend(['looped'])
    log.append('after')
def two(log):
    with Manager(log, 'first'), Manager(log, 'second'):
        log.extend(['body'])
    log.append('after')
def nested(log):
    with Manager(log, 'outer'):
        with Manager(log, 'inner'):
            log.extend(['body'])
    log.append('after')
def swallowed(log):
    with Swallows(log):
        log.extend(['body'])
        log.extend(['more'])
    log.append('after')
def in_loop(log):
    for i in (1, 2):
        with Swallows(log, 'exit %d' % i):
            log.extend(['body', i])
    log.append('after')
def returns(log):
    with Manager(log):
        return log.extend(['body'])
def enter_in_python(log):
    with InPython(log):
        log.extend(['body'])
def in_generator(log):
    def g():
        with Manager(log):
            yield 1
            log.extend(['resumed'])
    for x in g(): log.extend(['item'])
def in_coroutine(log):
    async def c():
        with Manager(log):
            log.extend(['body'])
    try: c().send(None)
    except StopIteration: log.append('done')
def in_handler(log):
    try:
        1 / 0
    except ZeroDivisionError:
        with Manager(log):
            log.extend(['body'])
def in_finally(log):
    try:
        pass
    finally:
        with Manager(log):
            log.extend(['body'])
def second_of_two(log):
    with Quiet(log, 'first'), Manager(log, 'second'):
        log.extend(['body'])
    log.append('after')
def second_nested(log):
    with Quiet(log, 'first'):
        with Manager(log, 'second'):
            log.extend(['body'])
    log.append('after')
def drive(c):
    try: c.send(None)
    except StopIteration: pass
def async_with(log):
    async def c():
        async with AsyncManager(log):
            log.extend(['body'])
        log.append('after')
    drive(c())
def async_with_named(log):
    async def c():
        async with AsyncManager(log) as x:
            log.extend(['body', x])
        log.append('after')
    drive(c())
def async_with_empty(log):
    async def c():
        async with AsyncManager(log):
            pass
        log.append('after')
    drive(c())
def async_second_of_two(log):
    async def c():
        async with AsyncManager(log, 'first'), AsyncManager(log, 'second'):
            log.extend(['body'])
        log.append('after')
    drive(c())

for base in (CalledAsItIs, CalledWithTheObject):
    managers(base)
    print(base.__name__)
    for f in (plain, assigned, before_try, in_try, call_in_body, named, empty_body, no_call_in_body, loop_in_body, while_in_body, two, nested,
              swallowed, in_loop, returns, enter_in_python, in_generator, in_coroutine, in_handler, in_finally,
              second_of_two, second_nested, async_with, async_with_named, async_with_empty, async_second_of_two):
        log = []
        try: f(log)
        except KeyboardInterrupt: log.append('KeyboardInterrupt')
        print(f.__name__, log)

# Locks, under a timer whose handler raises, once a round. Whenever it strikes: a lock that has been entered, and the statements not begun, has been left.
# (How often it strikes is not printed. If it never did, nothing would be tested, and nothing would fail.)
warnings.simplefilter('ignore', RuntimeWarning) # A coroutine that was never awaited.
class Hit(Exception): pass
class Plain:
    def __enter__(self): return self
    def __exit__(self, kind, value, traceback): return False
armed = False
def strike(number, frame):
    global armed
    if armed:
        armed = False
        raise Hit
def a_lock(lock, other, state):
    with lock:
        state[0] = 1
def a_lock_named(lock, other, state):
    with lock as x:
        state[0] = 1
def two_locks(lock, other, state):
    with lock, other:
        state[0] = 1
def nested_locks(lock, other, state):
    with lock:
        with other:
            state[0] = 1
def lock_and_manager(lock, other, state):
    with lock, Plain():
        state[0] = 1
def manager_and_lock(lock, other, state):
    with Plain(), lock:
        state[0] = 1
def lock_in_generator(lock, other, state):
    def g():
        with lock:
            state[0] = 1
        yield 1
    for x in g(): pass
def lock_in_coroutine(lock, other, state):
    async def c():
        with lock:
            state[0] = 1
    drive(c())
def lock_in_handler(lock, other, state):
    try:
        raise KeyError
    except KeyError:
        with lock:
            state[0] = 1
def is_held(lock):
    return lock._is_owned() if hasattr(lock, '_is_owned') else lock.locked()
signal.signal(signal.SIGALRM, strike)
for make in (threading.Lock, threading.RLock):
    for f in (a_lock, a_lock_named, two_locks, nested_locks, lock_and_manager, manager_and_lock, lock_in_generator, lock_in_coroutine, lock_in_handler):
        lock = make(); other = make(); state = [0]; left_held = 0
        signal.setitimer(signal.ITIMER_REAL, 0.0002, 0.0002)
        end = time.monotonic() + 0.05
        while time.monotonic() < end:
            try:
                state[0] = 0; armed = True; f(lock, other, state); armed = False
            except Hit:
                for l in (lock, other):
                    if is_held(l):
                        left_held += not state[0]
                        l.release()
        armed = False
        signal.setitimer(signal.ITIMER_REAL, 0)
        print(make().__class__.__name__, f.__name__, 'left held' if left_held else 'never left held')
