# A signal that arrives while a `with` statement calls an __enter__ written in C is not looked at between that call and the statements: what its handler
# raises is raised in the statement, and __exit__ is called. After any other call it is looked at there and then. Nor is it looked at between the end of what
# `async with` awaits and the statements.
import _thread
interrupt = _thread.interrupt_main

class Manager:
    __enter__ = staticmethod(interrupt)
    def __init__(self, log, name='exit'): self.log = log; self.name = name
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

for f in (plain, assigned, before_try, in_try, call_in_body, named, empty_body, no_call_in_body, loop_in_body, while_in_body, two, nested,
          swallowed, in_loop, returns, enter_in_python, in_generator, in_coroutine, in_handler, in_finally,
          second_of_two, second_nested, async_with, async_with_named, async_with_empty, async_second_of_two):
    log = []
    try: f(log)
    except KeyboardInterrupt: log.append('KeyboardInterrupt')
    print(f.__name__, log)
