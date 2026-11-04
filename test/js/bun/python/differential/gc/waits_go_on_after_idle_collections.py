# A thread that waits collects every now and then, and for that the call that waits is begun again. Nothing of that may show: a wait
# with a timeout ends when it was to end, whoever listens hears of one call, and what interrupts the wait finds it as it was.
import os, queue, select, signal, socket, sys, threading, time

SLACK = 3.0  # A debug build under load is slow. What is looked for is a timeout that starts anew, or a wait cut short.


def timed(name, seconds, function):
    start = time.monotonic()
    try:
        result = function()
    except BaseException as e:
        result = type(e).__name__
    elapsed = time.monotonic() - start
    print(name, result, "not early:", elapsed >= seconds - 0.001, "not late:", elapsed < seconds + SLACK)


held = threading.Lock()
held.acquire()
reentrant = threading.RLock()
taken = threading.Event()
release = threading.Event()


def hold():
    with reentrant:
        taken.set()
        release.wait()


holder = threading.Thread(target=hold, daemon=True)
holder.start()
taken.wait()

timed("Lock.acquire", 0.35, lambda: held.acquire(True, 0.35))
timed("Lock.acquire keyword", 0.35, lambda: held.acquire(timeout=0.35))
timed("RLock.acquire", 0.35, lambda: reentrant.acquire(True, 0.35))
timed("SimpleQueue.get", 0.35, lambda: queue.SimpleQueue().get(True, 0.35))
timed("Queue.get", 0.35, lambda: queue.Queue().get(timeout=0.35))
timed("Thread.join", 0.35, lambda: holder.join(0.35))
timed("Event.wait", 0.35, lambda: threading.Event().wait(0.35))
timed("Condition.wait", 0.35, lambda: (lambda c: c.__enter__() and c.wait(0.35))(threading.Condition()))
timed("sleep", 0.35, lambda: time.sleep(0.35))
timed("sleep of a whole number", 1, lambda: time.sleep(1))

r, w = os.pipe()
poll = select.poll()
poll.register(r, select.POLLIN)
timed("poll", 0.35, lambda: poll.poll(350))
timed("select", 0.35, lambda: select.select([r], [], [], 0.35))
if hasattr(select, "epoll"):
    epoll = select.epoll()
    epoll.register(r, select.EPOLLIN)
    timed("epoll", 0.35, lambda: epoll.poll(0.35))
    epoll.close()
else:
    print("epoll [] not early: True not late: True")

a, b = socket.socketpair()
a.settimeout(0.35)
timed("recv", 0.35, lambda: a.recv(10))
timed("recvfrom", 0.35, lambda: a.recvfrom(10))
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen()
listener.settimeout(0.35)
timed("accept", 0.35, lambda: listener.accept())

# What is waited for comes in the middle.
threading.Timer(0.5, lambda: os.write(w, b"x")).start()
timed("read", 0.4, lambda: os.read(r, 10))
threading.Timer(0.5, lambda: b.send(b"y")).start()
a.settimeout(5)
timed("recv of something", 0.4, lambda: a.recv(10))
threading.Timer(0.5, held.release).start()
timed("acquire of a lock that is released", 0.4, lambda: held.acquire(True, 5))
pid = os.posix_spawn("/bin/sleep", ["sleep", "0.5"], {})
timed("waitpid", 0.4, lambda: os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))

# One call is one call.
events = []
sys.setprofile(lambda frame, event, argument: events.append((event, getattr(argument, "__name__", None))) if event.startswith("c_") else None)
held.acquire(True, 0.4)
time.sleep(0.4)
sys.setprofile(None)
print([e for e in events if e[1] in ("acquire", "sleep")])

# The handler of a signal waits too, while the main thread is in the middle of a wait.
handled = []


def handler(number, frame):
    start = time.monotonic()
    held.acquire(True, 0.3)
    time.sleep(0.3)
    handled.append(time.monotonic() - start >= 0.6 - 0.001)


signal.signal(signal.SIGALRM, handler)
signal.setitimer(signal.ITIMER_REAL, 0.2)
timed("acquire with a handler in between", 1.2, lambda: held.acquire(True, 1.2))
signal.setitimer(signal.ITIMER_REAL, 0.2)
timed("sleep with a handler in between", 1.2, lambda: time.sleep(1.2))
signal.setitimer(signal.ITIMER_REAL, 0.2)
timed("poll with a handler in between", 1.2, lambda: poll.poll(1200))
print(handled)


# A handler that raises ends the wait.
def raising(number, frame):
    raise KeyError("from the handler")


signal.signal(signal.SIGALRM, raising)
signal.setitimer(signal.ITIMER_REAL, 0.4)
timed("acquire ended by a handler", 0.3, lambda: held.acquire(True, 5))
signal.setitimer(signal.ITIMER_REAL, 0.4)
timed("sleep ended by a handler", 0.3, lambda: time.sleep(5))


release.set()
holder.join()
print("done")
