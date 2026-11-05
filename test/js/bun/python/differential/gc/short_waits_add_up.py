# A loop that waits for an object to die, a short nap at a time, and allocates next to nothing. Nobody asks for a collection.
# Each kind of nap in a process of its own: threads that wait have a share of the time for collecting, and one that has just
# collected waits for the next turn, which on a slow build is seconds.
import queue, select, subprocess, sys, threading, time, weakref


class A:
    pass


def dies_while(name, nap):
    a = A()
    ref = weakref.ref(a)
    del a
    deadline = time.monotonic() + 60
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
naps = {"time.sleep(%s)" % seconds: lambda seconds=seconds: time.sleep(seconds) for seconds in (0.0005, 0.001, 0.01, 0.02, 0.05)}
naps["Event.wait"] = lambda event=threading.Event(): event.wait(0.01)
naps["Lock.acquire"] = lambda: held.acquire(timeout=0.01)
naps["Condition.wait"] = wait
naps["Queue.get"] = get
naps["select"] = lambda: select.select([], [], [], 0.01)

if len(sys.argv) == 1:
    children = [subprocess.Popen([sys.executable, __file__, name], stdout=subprocess.PIPE, text=True) for name in [*naps, "in a thread"]]
    for child in children:
        print(child.communicate()[0], end="")
elif sys.argv[1] in naps:
    dies_while(sys.argv[1], naps[sys.argv[1]])
else:
    # While the main thread waits for it.
    thread = threading.Thread(target=dies_while, args=("in a thread", lambda: time.sleep(0.01)))
    thread.start()
    thread.join()
