# A signal that arrives while a `with` statement calls an __enter__ written in C is not looked at between that call and the statements: what its handler
# raises is raised in the statement, and __exit__ is called. After any other call it is looked at there and then. Nor is it looked at between the end of what
# `async with` awaits and the statements.
try: import _thread, signal, threading, time, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import _thread, signal, threading, time, warnings')
try: interrupt = _thread.interrupt_main
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: interrupt = _thread.interrupt_main')

# Found in the type, __enter__ is either something to call as it is, or a function of the type to call with the object.
try:
    class CalledAsItIs:
        __enter__ = staticmethod(interrupt)
        def __init__(self, log, name='exit'): self.log = log; self.name = name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CalledAsItIs:')
try:
    class CalledWithTheObject(staticmethod):
        __enter__ = staticmethod.__call__
        def __new__(cls, log, name='exit'): return staticmethod.__new__(cls, interrupt)
        def __init__(self, log, name='exit'): staticmethod.__init__(self, interrupt); self.log = log; self.name = name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CalledWithTheObject(staticmethod):')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def managers(base):')

# What is awaited ends with the interrupt.
try:
    class Interrupts:
        def __await__(self): return iter(interrupt, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Interrupts:')

try:
    class Nothing:
        def __await__(self): return iter(())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Nothing:')

try:
    class AsyncManager:
        def __init__(self, log, name='aexit'): self.log = log; self.name = name
        def __aenter__(self): return Interrupts()
        def __aexit__(self, kind, value, traceback):
            self.log.append('%s %s' % (self.name, kind and kind.__name__))
            return Nothing()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AsyncManager:')

try:
    def plain(log):
        interrupt(); log.extend(['a'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(log):')
try:
    def assigned(log):
        x = interrupt(); log.extend(['a'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assigned(log):')
try:
    def before_try(log):
        interrupt()
        try:
            log.extend(['a'])
        finally:
            log.append('finally')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def before_try(log):')
try:
    def in_try(log):
        try:
            interrupt(); log.extend(['a'])
        finally:
            log.append('finally')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_try(log):')
try:
    def call_in_body(log):
        with Manager(log):
            log.extend(['body'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_in_body(log):')
try:
    def named(log):
        with Manager(log) as x:
            log.extend(['body', x])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def named(log):')
try:
    def empty_body(log):
        with Manager(log):
            pass
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def empty_body(log):')
try:
    def no_call_in_body(log):
        with Manager(log):
            x = 1
            y = [x, x]
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_call_in_body(log):')
try:
    def loop_in_body(log):
        with Manager(log):
            for i in (1, 2, 3): pass
            log.extend(['looped'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_in_body(log):')
try:
    def while_in_body(log):
        i = 0
        with Manager(log):
            while i < 3: i += 1
            log.extend(['looped'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_in_body(log):')
try:
    def two(log):
        with Manager(log, 'first'), Manager(log, 'second'):
            log.extend(['body'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(log):')
try:
    def nested(log):
        with Manager(log, 'outer'):
            with Manager(log, 'inner'):
                log.extend(['body'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(log):')
try:
    def swallowed(log):
        with Swallows(log):
            log.extend(['body'])
            log.extend(['more'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def swallowed(log):')
try:
    def in_loop(log):
        for i in (1, 2):
            with Swallows(log, 'exit %d' % i):
                log.extend(['body', i])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_loop(log):')
try:
    def returns(log):
        with Manager(log):
            return log.extend(['body'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns(log):')
try:
    def enter_in_python(log):
        with InPython(log):
            log.extend(['body'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def enter_in_python(log):')
try:
    def in_generator(log):
        def g():
            with Manager(log):
                yield 1
                log.extend(['resumed'])
        for x in g(): log.extend(['item'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_generator(log):')
try:
    def in_coroutine(log):
        async def c():
            with Manager(log):
                log.extend(['body'])
        try: c().send(None)
        except StopIteration: log.append('done')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_coroutine(log):')
try:
    def in_handler(log):
        try:
            1 / 0
        except ZeroDivisionError:
            with Manager(log):
                log.extend(['body'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_handler(log):')
try:
    def in_finally(log):
        try:
            pass
        finally:
            with Manager(log):
                log.extend(['body'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_finally(log):')
try:
    def second_of_two(log):
        with Quiet(log, 'first'), Manager(log, 'second'):
            log.extend(['body'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def second_of_two(log):')
try:
    def second_nested(log):
        with Quiet(log, 'first'):
            with Manager(log, 'second'):
                log.extend(['body'])
        log.append('after')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def second_nested(log):')
try:
    def drive(c):
        try: c.send(None)
        except StopIteration: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(c):')
try:
    def async_with(log):
        async def c():
            async with AsyncManager(log):
                log.extend(['body'])
            log.append('after')
        drive(c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def async_with(log):')
try:
    def async_with_named(log):
        async def c():
            async with AsyncManager(log) as x:
                log.extend(['body', x])
            log.append('after')
        drive(c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def async_with_named(log):')
try:
    def async_with_empty(log):
        async def c():
            async with AsyncManager(log):
                pass
            log.append('after')
        drive(c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def async_with_empty(log):')
try:
    def async_second_of_two(log):
        async def c():
            async with AsyncManager(log, 'first'), AsyncManager(log, 'second'):
                log.extend(['body'])
            log.append('after')
        drive(c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def async_second_of_two(log):')

try:
    for base in (CalledAsItIs, CalledWithTheObject):
        try: managers(base)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: managers(base)')
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        for f in (plain, assigned, before_try, in_try, call_in_body, named, empty_body, no_call_in_body, loop_in_body, while_in_body, two, nested,
                  swallowed, in_loop, returns, enter_in_python, in_generator, in_coroutine, in_handler, in_finally,
                  second_of_two, second_nested, async_with, async_with_named, async_with_empty, async_second_of_two):
            try: log = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
            try: f(log)
            except KeyboardInterrupt: log.append('KeyboardInterrupt')
            try: print('f.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
            try: print('log [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', log)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base in (CalledAsItIs, CalledWithTheObject):')

# Locks, under a timer whose handler raises, once a round. Whenever it strikes: a lock that has been entered, and the statements not begun, has been left.
# (How often it strikes is not printed. If it never did, nothing would be tested, and nothing would fail.)
try: warnings.simplefilter('ignore', RuntimeWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', RuntimeWarning)")
try:
    class Hit(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Hit(Exception): pass')
try:
    class Plain:
        def __enter__(self): return self
        def __exit__(self, kind, value, traceback): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain:')
try: armed = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: armed = False')
try:
    def strike(number, frame):
        global armed
        if armed:
            armed = False
            raise Hit
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def strike(number, frame):')
try:
    def a_lock(lock, other, state):
        with lock:
            state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_lock(lock, other, state):')
try:
    def a_lock_named(lock, other, state):
        with lock as x:
            state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_lock_named(lock, other, state):')
try:
    def two_locks(lock, other, state):
        with lock, other:
            state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two_locks(lock, other, state):')
try:
    def nested_locks(lock, other, state):
        with lock:
            with other:
                state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested_locks(lock, other, state):')
try:
    def lock_and_manager(lock, other, state):
        with lock, Plain():
            state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lock_and_manager(lock, other, state):')
try:
    def manager_and_lock(lock, other, state):
        with Plain(), lock:
            state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def manager_and_lock(lock, other, state):')
try:
    def lock_in_generator(lock, other, state):
        def g():
            with lock:
                state[0] = 1
            yield 1
        for x in g(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lock_in_generator(lock, other, state):')
try:
    def lock_in_coroutine(lock, other, state):
        async def c():
            with lock:
                state[0] = 1
        drive(c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lock_in_coroutine(lock, other, state):')
try:
    def lock_in_handler(lock, other, state):
        try:
            raise KeyError
        except KeyError:
            with lock:
                state[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lock_in_handler(lock, other, state):')
try:
    def is_held(lock):
        return lock._is_owned() if hasattr(lock, '_is_owned') else lock.locked()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def is_held(lock):')
try: signal.signal(signal.SIGALRM, strike)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: signal.signal(signal.SIGALRM, strike)')
try:
    for make in (threading.Lock, threading.RLock):
        for f in (a_lock, a_lock_named, two_locks, nested_locks, lock_and_manager, manager_and_lock, lock_in_generator, lock_in_coroutine, lock_in_handler):
            try: lock = make()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lock = make()')
            try: other = make()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other = make()')
            try: state = [0]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: state = [0]')
            try: left_held = 0
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: left_held = 0')
            try: signal.setitimer(signal.ITIMER_REAL, 0.0002, 0.0002)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: signal.setitimer(signal.ITIMER_REAL, 0.0002, 0.0002)')
            try: end = time.monotonic() + 0.05
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: end = time.monotonic() + 0.05')
            while time.monotonic() < end:
                try:
                    state[0] = 0
                    armed = True
                    f(lock, other, state)
                    armed = False
                except Hit:
                    for l in (lock, other):
                        if is_held(l):
                            left_held += not state[0]
                            l.release()
            try: armed = False
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: armed = False')
            try: signal.setitimer(signal.ITIMER_REAL, 0)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: signal.setitimer(signal.ITIMER_REAL, 0)')
            try: print('make().__class__.__name__ [' + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', make().__class__.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make().__class__.__name__')
            try: print('f.__name__ [' + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
            try: print("'left held' if left_held else 'never left held' [" + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', 'left held' if left_held else 'never left held')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'left held' if left_held else 'never left held'")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for make in (threading.Lock, threading.RLock):')
