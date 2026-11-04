# A loop that waits for an object to die, a short nap at a time, and allocates next to nothing. Nobody asks for a collection.
import queue, select, threading, time, weakref


class A:
    pass


def dies_while(name, nap):
    a = A()
    ref = weakref.ref(a)
    del a
    deadline = time.monotonic() + 10
    while ref() is not None and time.monotonic() < deadline:
        nap()
    print(name, ref() is None, flush=True)


def get(q=queue.Queue()):
    try:
        q.get(timeout=0.01)
    except queue.Empty:
        pass


def wait(condition=threading.Condition()):
    with condition:
        condition.wait(0.01)


held = threading.Lock()
held.acquire()
for seconds in (0.0005, 0.001, 0.01, 0.02, 0.05):
    dies_while("time.sleep(%s)" % seconds, lambda: time.sleep(seconds))
dies_while("Event.wait", lambda event=threading.Event(): event.wait(0.01))
dies_while("Lock.acquire", lambda: held.acquire(timeout=0.01))
dies_while("Condition.wait", wait)
dies_while("Queue.get", get)
dies_while("select", lambda: select.select([], [], [], 0.01))

# In a thread, while the main thread waits for it.
thread = threading.Thread(target=dies_while, args=("in a thread", lambda: time.sleep(0.01)))
thread.start()
thread.join()
