# A call that waits is begun again now and then (see waits_go_on_after_idle_collections.py). What waits while it waits, or on its
# way, is not that call, though nothing on the stack tells them apart if it is written in C++.
import _warnings, os, select, socket, sys, threading, time, warnings

held = threading.Lock()
held.acquire()
r, w = os.pipe()
poll = select.poll()
poll.register(r, select.POLLIN)

# The finalizer of a socket warns, and for that takes a lock of the interpreter, which another thread holds for a while.
warnings.simplefilter("always")
seen = []
warnings.showwarning = lambda message, category, *rest: seen.append(category.__name__)


def keep_lock_of_warnings(ready, begun, writes):
    _warnings._acquire_lock()
    ready.set()
    end = time.monotonic() + 0.6
    while time.monotonic() < end:  # Not idle: it is not to be the one that finds the socket.
        pass
    _warnings._release_lock()
    while not begun or time.monotonic() < begun[0] + 1.2:
        pass
    if writes:
        os.write(w, b"x")


for name, wait in (("acquire", lambda: held.acquire(True, 1.2)), ("poll", lambda: poll.poll(1200)), ("sleep", lambda: time.sleep(1.2)), ("read", lambda: os.read(r, 10))):
    ready = threading.Event()
    begun = []
    dropped = socket.socket()
    other = threading.Thread(target=keep_lock_of_warnings, args=(ready, begun, name == "read"))
    other.start()
    ready.wait()
    del dropped
    start = time.monotonic()
    begun.append(start)
    result = wait()
    elapsed = time.monotonic() - start
    other.join()
    print(name, result, "not early:", elapsed >= 1.2 - 0.01, "not late:", elapsed < 2.2)
import gc
gc.collect()
print(seen)

# Two threads wait for a connection, and one comes. For the other it was a false alarm: it waits for what is left of its time.
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen()
listener.settimeout(1.5)
outcomes = []


def accept():
    start = time.monotonic()
    try:
        listener.accept()[0].close()
        outcomes.append("accepted")
    except TimeoutError:
        elapsed = time.monotonic() - start
        outcomes.append("timed out, not early: %s not late: %s" % (elapsed >= 1.5 - 0.01, elapsed < 2.3))


threads = [threading.Thread(target=accept) for i in range(2)]
for thread in threads:
    thread.start()
time.sleep(1.1)
client = socket.create_connection(listener.getsockname())
for thread in threads:
    thread.join()
client.close()
listener.close()
print(sorted(outcomes))

# A hook that comes while a sleep is under way hears nothing of it, and does not make it longer. (It stays, so this comes last.)
slept = []


def sleep():
    start = time.monotonic()
    time.sleep(1.5)
    elapsed = time.monotonic() - start
    slept.append("not early: %s not late: %s" % (elapsed >= 1.5 - 0.01, elapsed < 2.3))


sleeper = threading.Thread(target=sleep)
sleeper.start()
time.sleep(0.15)
heard = []
guard = threading.Lock()


def hook(name, arguments):
    if name == "time.sleep":
        with guard:
            heard.append(arguments)


sys.addaudithook(hook)
sleeper.join()
print(slept, heard)
print("done")
