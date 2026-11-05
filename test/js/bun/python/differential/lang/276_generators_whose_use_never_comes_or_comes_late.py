# A generator is made for a call that goes through it, and the call never comes, or comes late: another argument raises, the frame is suspended, the thread
# waits, somebody gets hold of the generator meanwhile. Nothing that is still in use may be closed, and what the call does own is closed when it is done.
import gc
import threading

log = []


def g(name, n=3):
    try:
        for i in range(n):
            yield i
    finally:
        log.append('closed ' + name)


class E(Exception):
    pass


def show(title):
    print(title, log)
    log.clear()


count = 0


def bad():
    global count
    count += 1
    if count % 2:
        raise E
    return 'xy'


for turn in range(4):
    try:
        for a, b in zip(g('zip %d' % turn), bad()):
            log.append((a, b))
            break
        log.append('after the loop')
    except E:
        log.append('E')
show('another argument raises, and the same call is made again:')

for turn in range(4):
    try:
        log.append(sum(g('sum %d' % turn), bad() and 0))
    except E:
        log.append('E')
show('the same for a function:')

for turn in range(4):
    try:
        for i, (a, b) in enumerate(zip(g('inner %d' % turn), bad())):
            break
        log.append('after the loop')
    except E:
        log.append('E')
show('the same one level further in:')


def recursive(depth):
    for a, b in zip(g('depth %d' % depth), recursive(depth - 1) if depth else 'xy'):
        log.append((depth, a))
        break
    log.append('after %d' % depth)
    return 'xy'


recursive(3)
show('the same call in the frames below:')


def suspended(name):
    for a, b in zip(g(name), (yield)):
        log.append((name, a, b))
    log.append('after the loop in ' + name)
    yield 'done'


first = suspended('first')
next(first)
second = suspended('second')
next(second)
log.append(second.send('xyzw'))
log.append(first.send('xyzw'))
show('frames that are suspended between the making and the use:')
del first, second


async def awaits(name, what):
    for a, b in zip(g(name), await what):
        log.append((name, a, b))
    log.append('after the loop in ' + name)


class Awaitable:
    def __await__(self):
        return (yield)


def drive(*coroutines):
    for coroutine in coroutines:
        coroutine.send(None)
    for coroutine in reversed(coroutines):
        try:
            coroutine.send('xyzw')
        except StopIteration:
            pass


drive(awaits('one', Awaitable()), awaits('two', Awaitable()))
show('the same with await:')

kept = []


def peek(kind):
    kept.extend(o for o in gc.get_objects() if type(o) is kind)
    return 'xy'


for a, b in zip(enumerate(g('seen')), peek(enumerate)):
    break
log.append('after the loop')
log.append(next(kept[0]))
show('gc.get_objects() finds the iterator before it is used:')
kept.clear()
gc.collect()
show('and lets go of it:')

for a in map(lambda x, y: x, g('seen too'), peek(type(g('')))):
    break
log.append('after the loop')
log.append([next(o) for o in kept if o.gi_frame.f_locals['name'] == 'seen too'])
show('the same for the generator:')
kept.clear()
gc.collect()
log.sort()
show('and lets go of it:')

ready = threading.Event()
go = threading.Event()


def wait():
    ready.set()
    go.wait()
    return 'xy'


def waits(name):
    for a, b in zip(g(name), wait()):
        log.append((name, a, b))
        break
    log.append('after the loop in ' + name)


thread = threading.Thread(target=waits, args=('the thread',))
thread.start()
ready.wait()
for a, b in zip(g('main'), 'xy'):
    break
log.append('after the loop in main')
log.append(sum(g('sum')))
go.set()
thread.join()
show('a thread that waits between the making and the use:')

ready.clear()
go.clear()
thread = threading.Thread(target=waits, args=('the thread',))
thread.start()
ready.wait()
peek(type(g('')))
mine = [o for o in kept if o.gi_frame.f_locals['name'] == 'the thread']
kept.clear()
go.set()
thread.join()
log.append([next(o) for o in mine])
show('and another thread gets hold of the generator meanwhile:')
del mine
gc.collect()
log.sort()
show('and lets go of it:')
