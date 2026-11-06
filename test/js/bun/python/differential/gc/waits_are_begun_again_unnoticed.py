# A thread that waits collects every now and then, and for that the call that waits is begun again (see
# waits_go_on_after_idle_collections.py). What runs in between, and what the call is given, does not notice.
import os, queue, select, socket, sys, threading, time

held = threading.Lock()
held.acquire()
r, w = os.pipe()
poll = select.poll()
poll.register(r, select.POLLIN)
a, b = socket.socketpair()


# Finalizers run in the middle of the wait: they wait themselves, for nearly as long, and raise. The wait ends when it was to end, not
# that much later than the finalizers. (With reference counts they run before it begins.)
class Dropped:
    def __init__(self, action):
        self.action = action

    def __del__(self):
        self.action()


done = []
finished = []
sys.unraisablehook = lambda unraisable: done.append(unraisable.exc_type.__name__)
for name, wait in (
    ("acquire", lambda: held.acquire(True, 1.5)),
    ("poll", lambda: poll.poll(1500)),
):
    first = Dropped(lambda: (time.sleep(0.7), held.acquire(True, 0.7), done.append("waited"), finished.append(time.monotonic())))
    second = Dropped(lambda: 1 / 0)
    del first, second
    start = time.monotonic()
    wait()
    end = time.monotonic()
    # On a busy machine everything takes longer, the finalizers too. What must not happen is that the time begins anew after them.
    print(name, "while finalizers run, not early:", end - start >= 1.5 - 0.001, "not late:", end - max(start + 1.5, *finished[-1:]) < 1.4)
import gc
gc.collect()
print(sorted(done))

# (From here on there is another thread. Had it been idle above, it might have been the one to find the objects and to finalize them.)
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


# Arguments that run code of the program are looked at once.
looked = []


class Index:
    def __init__(self, value):
        self.value = value

    def __index__(self):
        looked.append("index")
        return self.value


class Float:
    def __init__(self, value):
        self.value = value

    def __float__(self):
        looked.append("float")
        return self.value


class Bool:
    def __bool__(self):
        looked.append("bool")
        return True


def looks(name, function):
    looked.clear()
    try:
        result = function()
    except BaseException as e:
        result = type(e).__name__
    print(name, result, looked)


looks("sleep", lambda: time.sleep(Index(1)))
looks("sleep", lambda: time.sleep(Float(1.2)))
threading.Timer(1.2, lambda: os.write(w, b"x")).start()
looks("read", lambda: os.read(Index(r), 10))
threading.Timer(0.2, lambda: os.write(w, b"x")).start()
looks("read", lambda: os.read(Index(r), Index(10)))
pid = os.posix_spawn("/bin/sleep", ["sleep", "0.2"], {})
looks("waitpid", lambda: os.waitpid(Index(pid), 0)[1])
looks("acquire", lambda: held.acquire(True, Float(0.2)))
looks("acquire", lambda: held.acquire(Bool(), 0.2))
looks("acquire, not bound", lambda: type(held).acquire(held, True, 0.2))
looks("get", lambda: queue.SimpleQueue().get(True, Float(0.2)))
looks("poll", lambda: poll.poll(Index(200)))
looks("poll", lambda: poll.poll(Float(200.0)))
a.settimeout(0.2)
for name, bound, arguments in (
    ("acquire", held.acquire, (Bool(), 1.2)),
    ("acquire", reentrant.acquire, (Bool(), 0.2)),
    ("get", queue.SimpleQueue().get, (Bool(), 0.2)),
    ("poll", poll.poll, (Index(200),)),
    ("recv", a.recv, (Index(10),)),
):
    looks(name + ", bound", lambda: bound(*arguments))

# A hook hears of one sleep. (It stays, so this comes last.)
heard = []
sys.addaudithook(lambda name, arguments: heard.append((name, arguments)) if name == "time.sleep" else None)
time.sleep(1.2)
print(heard)

release.set()
holder.join()
print("done")
