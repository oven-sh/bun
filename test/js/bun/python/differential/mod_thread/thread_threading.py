import threading, re, sys
def t(f, *a, **k):
    try:
        print(re.sub(r'0x[0-9a-f]+', '0x', repr(f(*a, **k))))
    except BaseException as e:
        print(type(e).__name__ + ':', re.sub(r'0x[0-9a-f]+', '0x', str(e)))
def norm(s): return re.sub(r'\d{4,}', 'N', re.sub(r'0x[0-9a-f]+', '0x', s))

m = threading.main_thread()
print(m.name, m.daemon, m.is_alive(), m is threading.current_thread(), m.ident == threading.get_ident(), m.native_id == threading.get_native_id(), threading.active_count(), threading.enumerate() == [m])
print(norm(repr(m)))
t(m.join); t(m.start)
print(threading.TIMEOUT_MAX, threading.ThreadError is RuntimeError, threading.stack_size())

l = threading.Lock(); print(type(l).__name__, l.acquire(), l.locked(), l.acquire(False), l.release(), l.locked())
r = threading.RLock(); print(type(r).__name__, r.acquire(), r.acquire(), r.release(), r.release())
t(r.release)

c = threading.Condition()
with c:
    print(c.wait(0.01), c.wait_for(lambda: False, 0.01), c.wait_for(lambda: True), c.notify(), c.notify_all())
t(c.wait, 0); t(c.notify)
c2 = threading.Condition(threading.Lock())
with c2:
    print(c2.wait(0.01), c2._is_owned())
print(norm(repr(c2)))

e = threading.Event(); print(e.is_set(), e.wait(0.01), e.set(), e.is_set(), e.wait(), e.wait(1), e.clear(), e.is_set()); print(norm(repr(e)))
s = threading.Semaphore(2); print(s.acquire(), s.acquire(), s.acquire(False), s.acquire(timeout=0.01), s.release(), s.acquire(), s.release(2)); print(norm(repr(s)))
t(threading.Semaphore, -1); t(s.acquire, False, 1); t(s.release, 0)
b = threading.BoundedSemaphore(1); print(b.acquire(), b.release()); t(b.release)
with s: print('in semaphore')
bar = threading.Barrier(1, action=lambda: print('action')); print(bar.parties, bar.n_waiting, bar.broken, bar.wait(), bar.wait(1)); print(norm(repr(bar)))
bar2 = threading.Barrier(2); t(bar2.wait, 0.01); print(bar2.broken); t(bar2.wait); bar2.reset(); print(bar2.broken); bar2.abort(); print(bar2.broken)
t(threading.Barrier, 0)

loc = threading.local(); loc.x = 1; print(loc.x, loc.__dict__, type(loc).__module__, type(loc).__name__)

th = threading.Thread(target=print, args=('never',), name='worker', daemon=True)
print(th.name, th.daemon, th.is_alive(), th.ident, th.native_id); print(norm(repr(th)))
t(th.join); th.daemon = False; th.name = 'renamed'; print(th.name, th.daemon)
th2 = threading.Thread(); print(re.sub(r'\d+', 'N', th2.name))
th3 = threading.Thread(target=len); print(re.sub(r'\d+', 'N', th3.name))
t(threading.Thread, group=1)
tm = threading.Timer(10, print); print(tm.is_alive(), tm.interval, tm.cancel(), tm.finished.is_set())
print(threading.excepthook is not None, threading.ExceptHookArgs.__name__, threading.__excepthook__ is threading.excepthook)
print(threading.gettrace(), threading.getprofile(), threading.settrace(None), threading.setprofile(None))
print(threading.active_count(), [x.name for x in threading.enumerate()])

import queue
q = queue.Queue(2); q.put(1); q.put(2); print(q.qsize(), q.full(), q.empty()); t(q.put, 3, False); t(q.put, 3, True, 0.01); print(q.get(), q.get_nowait(), q.empty()); t(q.get, False); t(q.get, True, 0.01); t(q.get_nowait)
q.task_done(); q.task_done(); t(q.task_done); print(q.join())
lq = queue.LifoQueue(); lq.put(1); lq.put(2); print(lq.get(), lq.get())
pq = queue.PriorityQueue(); [pq.put(x) for x in (3, 1, 2)]; print(pq.get(), pq.get(), pq.get())
sq = queue.SimpleQueue(); sq.put('a'); sq.put_nowait('b'); print(sq.qsize(), sq.get(), sq.get_nowait(), sq.empty(), type(sq).__module__); t(sq.get, False); t(sq.get, timeout=0.01)
q = queue.Queue(); q.put(1); q.shutdown(); print(q.get()); t(q.get); t(q.put, 1)

import sched, time
sc = sched.scheduler(time.monotonic, time.sleep); out = []
now = time.monotonic(); sc.enterabs(now + 0.02, 1, out.append, ('b',)); sc.enterabs(now + 0.01, 1, out.append, ('a',)); ev = sc.enter(5, 1, out.append, ('never',)); sc.cancel(ev); print(sc.empty(), len(sc.queue)); sc.run(); print(out, sc.empty())

import logging
log = logging.getLogger('test'); h = logging.StreamHandler(sys.stdout); h.setFormatter(logging.Formatter('%(levelname)s %(name)s %(threadName)s %(message)s')); log.addHandler(h); log.setLevel(logging.INFO)
log.info('hello %d', 1); log.debug('hidden'); log.warning('careful'); log.error('bad %s', 'thing')

import concurrent.futures as cf
f = cf.Future(); print(f.done(), f.running(), f.cancelled()); f.set_result(5); print(f.done(), f.result(), f.exception())
f = cf.Future(); f.set_exception(ValueError('x')); t(f.result); print(repr(f.exception()))
f = cf.Future(); f.add_done_callback(lambda fu: print('callback', fu.cancelled())); print(f.cancel(), f.cancelled()); t(f.result)
f = cf.Future(); t(f.result, 0.01)
print(cf.wait([], timeout=0), list(cf.as_completed([])))
