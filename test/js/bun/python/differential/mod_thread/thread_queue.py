import _queue, queue, weakref, signal
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(sorted(n for n in dir(_queue) if not n.startswith('__')), _queue.SimpleQueue.__mro__, _queue.Empty.__mro__, _queue.Empty.__module__, _queue.Empty.__name__, _queue.Empty.__doc__)
print(queue.Empty is _queue.Empty, queue.SimpleQueue is _queue.SimpleQueue, sorted(n for n in dir(_queue.SimpleQueue) if not n.startswith('__')))
q = _queue.SimpleQueue()
t(q.get, False); t(q.get, True, 0.01); t(q.get, True, -1); t(q.get, timeout='x'); t(q.get, False, -1); t(q.get, False, 'x'); t(q.put, 1, False, None); t(q.put, 1, 2, 3, 4); t(q.put); t(q.get_nowait); t(q.get_nowait, 1); t(q.qsize); t(q.empty)
t(_queue.SimpleQueue, 1); t(_queue.SimpleQueue, a=1); t(q.get, True, 1e30); t(lambda: _queue.SimpleQueue[int]); t(q.put, item=1); t(q.put, 1, block=0, timeout=5); t(q.put_nowait, item=2); t(q.get, block=False); t(q.get, timeout=None); t(q.get, True, 5); t(q.qsize)
class S(_queue.SimpleQueue): pass
print(type(S()).__mro__); t(setattr, q, 'x', 1); print(weakref.ref(q)() is q)
for i in range(1000): q.put(i)
print(q.qsize(), [q.get() for _ in range(5)], q.qsize(), sum(q.get() for _ in range(900)), q.qsize(), q.empty())
for i in range(10): q.put(('more', i))
print([q.get_nowait() for _ in range(q.qsize())][-3:], q.empty(), q.qsize())
for i in range(5):
    q.put(i); q.put(-i); print(q.get(), end=' ')
print(q.qsize(), [q.get() for _ in range(5)])
q.put(None); print(q.get(), q.empty())
signal.signal(signal.SIGALRM, lambda n, f: q.put('from the handler')); signal.setitimer(signal.ITIMER_REAL, 0.03); print(q.get()); signal.setitimer(signal.ITIMER_REAL, 0.03); print(q.get(timeout=5))
