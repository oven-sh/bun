# A generator is made for a call that goes through it, and the call never comes, or comes late: another argument raises, the frame is suspended, the thread
# waits, somebody gets hold of the generator meanwhile. Nothing that is still in use may be closed, and what the call does own is closed when it is done.
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: import threading
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import threading')

try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')


try:
    def g(name, n=3):
        try:
            for i in range(n):
                yield i
        finally:
            log.append('closed ' + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(name, n=3):')


try:
    class E(Exception):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception):')


try:
    def show(title):
        print(title, log)
        log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(title):')


try: count = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count = 0')


try:
    def bad():
        global count
        count += 1
        if count % 2:
            raise E
        return 'xy'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bad():')


try:
    for turn in range(4):
        try:
            for a, b in zip(g('zip %d' % turn), bad()):
                log.append((a, b))
                break
            log.append('after the loop')
        except E:
            log.append('E')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for turn in range(4):')
try: show('another argument raises, and the same call is made again:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('another argument raises, and the same call is made again:')")

try:
    for turn in range(4):
        try:
            log.append(sum(g('sum %d' % turn), bad() and 0))
        except E:
            log.append('E')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for turn in range(4):')
try: show('the same for a function:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same for a function:')")

try:
    for turn in range(4):
        try:
            for i, (a, b) in enumerate(zip(g('inner %d' % turn), bad())):
                break
            log.append('after the loop')
        except E:
            log.append('E')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for turn in range(4):')
try: show('the same one level further in:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same one level further in:')")


try:
    def recursive(depth):
        for a, b in zip(g('depth %d' % depth), recursive(depth - 1) if depth else 'xy'):
            log.append((depth, a))
            break
        log.append('after %d' % depth)
        return 'xy'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def recursive(depth):')


try: recursive(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: recursive(3)')
try: show('the same call in the frames below:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same call in the frames below:')")


try:
    def suspended(name):
        for a, b in zip(g(name), (yield)):
            log.append((name, a, b))
        log.append('after the loop in ' + name)
        yield 'done'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def suspended(name):')


try: first = suspended('first')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: first = suspended('first')")
try: next(first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(first)')
try: second = suspended('second')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: second = suspended('second')")
try: next(second)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(second)')
try: log.append(second.send('xyzw'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append(second.send('xyzw'))")
try: log.append(first.send('xyzw'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append(first.send('xyzw'))")
try: show('frames that are suspended between the making and the use:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('frames that are suspended between the making and the use:')")
try: del first, second
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del first, second')


try:
    async def awaits(name, what):
        for a, b in zip(g(name), await what):
            log.append((name, a, b))
        log.append('after the loop in ' + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaits(name, what):')


try:
    class Awaitable:
        def __await__(self):
            return (yield)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Awaitable:')


try:
    def drive(*coroutines):
        for coroutine in coroutines:
            coroutine.send(None)
        for coroutine in reversed(coroutines):
            try:
                coroutine.send('xyzw')
            except StopIteration:
                pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(*coroutines):')


try: drive(awaits('one', Awaitable()), awaits('two', Awaitable()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: drive(awaits('one', Awaitable()), awaits('two', Awaitable()))")
try: show('the same with await:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same with await:')")

try: kept = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept = []')


try:
    def peek(kind):
        kept.extend(o for o in gc.get_objects() if type(o) is kind)
        return 'xy'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def peek(kind):')


try:
    for a, b in zip(enumerate(g('seen')), peek(enumerate)):
        break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for a, b in zip(enumerate(g('seen')), peek(enumerate)):")
try: log.append('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append('after the loop')")
try: log.append(next(kept[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.append(next(kept[0]))')
try: show('gc.get_objects() finds the iterator before it is used:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('gc.get_objects() finds the iterator before it is used:')")
try: kept.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.clear()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: show('and lets go of it:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and lets go of it:')")

try:
    for a in map(lambda x, y: x, g('seen too'), peek(type(g('')))):
        break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for a in map(lambda x, y: x, g('seen too'), peek(type(g('')))):")
try: log.append('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append('after the loop')")
try: log.append([next(o) for o in kept if o.gi_frame.f_locals['name'] == 'seen too'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append([next(o) for o in kept if o.gi_frame.f_locals['name'] == '...")
try: show('the same for the generator:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same for the generator:')")
try: kept.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.clear()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: log.sort()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.sort()')
try: show('and lets go of it:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and lets go of it:')")

try: ready = threading.Event()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ready = threading.Event()')
try: go = threading.Event()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go = threading.Event()')


try:
    def wait():
        ready.set()
        go.wait()
        return 'xy'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wait():')


try:
    def waits(name):
        for a, b in zip(g(name), wait()):
            log.append((name, a, b))
            break
        log.append('after the loop in ' + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def waits(name):')


try: thread = threading.Thread(target=waits, args=('the thread',))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: thread = threading.Thread(target=waits, args=('the thread',))")
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try: ready.wait()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ready.wait()')
try:
    for a, b in zip(g('main'), 'xy'):
        break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for a, b in zip(g('main'), 'xy'):")
try: log.append('after the loop in main')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append('after the loop in main')")
try: log.append(sum(g('sum')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: log.append(sum(g('sum')))")
try: go.set()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go.set()')
try: thread.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.join()')
try: show('a thread that waits between the making and the use:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a thread that waits between the making and the use:')")

try: ready.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ready.clear()')
try: go.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go.clear()')
try: thread = threading.Thread(target=waits, args=('the thread',))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: thread = threading.Thread(target=waits, args=('the thread',))")
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try: ready.wait()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ready.wait()')
try: peek(type(g('')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: peek(type(g('')))")
try: mine = [o for o in kept if o.gi_frame.f_locals['name'] == 'the thread']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: mine = [o for o in kept if o.gi_frame.f_locals['name'] == 'the thread']")
try: kept.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.clear()')
try: go.set()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go.set()')
try: thread.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.join()')
try: log.append([next(o) for o in mine])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.append([next(o) for o in mine])')
try: show('and another thread gets hold of the generator meanwhile:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and another thread gets hold of the generator meanwhile:')")
try: del mine
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del mine')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: log.sort()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.sort()')
try: show('and lets go of it:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and lets go of it:')")
