# A file that holds a lock is dropped, not closed, and the program takes the lock again. With reference counts the file is closed by
# then. Nobody asks for a collection, and a call that waits for the lock allocates nothing.
import fcntl, gc, os, subprocess, sys, tempfile, threading, warnings

warnings.simplefilter("ignore", ResourceWarning)
directory = tempfile.TemporaryDirectory()
path = os.path.join(directory.name, "lock")


def lock(how=fcntl.LOCK_EX):
    f = open(path, "w")
    fcntl.flock(f, how)


for i in range(5):
    lock()
    print("locked", i, flush=True)

# By the number of the descriptor.
for i in range(3):
    f = open(path, "w")
    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
    del f
    print("locked by number", i, flush=True)

# Shared, then exclusive.
lock(fcntl.LOCK_SH)
lock(fcntl.LOCK_SH)
lock()
print("exclusive after shared", flush=True)

# In an object with a finalizer of the program's, which gives the lock back.
given_back = []


class Holder:
    def __init__(self):
        self.f = open(path, "w")
        fcntl.flock(self.f, fcntl.LOCK_EX)

    def __del__(self):
        given_back.append(self.f.fileno())
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


for i in range(3):
    Holder()
    print("held", i, flush=True)
gc.collect()
print("given back:", len(given_back))

# Made and dropped by a thread that has ended; by one that is alive and waits.
thread = threading.Thread(target=lock)
thread.start()
thread.join()
lock()
print("after a thread that has ended", flush=True)
go_on = threading.Event()
has_locked = threading.Event()


def locks_and_waits():
    lock()
    has_locked.set()
    go_on.wait()


thread = threading.Thread(target=locks_and_waits)
thread.start()
has_locked.wait()
lock()
print("beside a thread that waits", flush=True)
go_on.set()
thread.join()

# A hook hears of each call once.
heard = []
sys.addaudithook(lambda event, args: heard.append(args[1]) if event == "fcntl.flock" else None)
lock()
lock()
print(heard == [fcntl.LOCK_EX] * 2)

# A lock that somebody holds for good reason is waited for.
held = open(path, "w")
fcntl.flock(held, fcntl.LOCK_EX)
order = []


def wants_it():
    with open(path, "w") as mine:
        is_about_to_block.set()
        fcntl.flock(mine, fcntl.LOCK_EX)
        order.append("got it")


is_about_to_block = threading.Event()
thread = threading.Thread(target=wants_it)
thread.start()
is_about_to_block.wait()
try:
    fcntl.flock(open(path, "w"), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError as e:
    print("BlockingIOError")
order.append("let go")
held.close()
thread.join()
print(order)

# A copy of the descriptor shares the lock: to drop the file does not give it back, with reference counts or without.
f = open(path, "w")
fcntl.flock(f, fcntl.LOCK_EX)
copy = os.dup(f.fileno())
del f
order.clear()
is_about_to_block.clear()
thread = threading.Thread(target=wants_it)
thread.start()
is_about_to_block.wait()
try:
    fcntl.flock(open(path, "w"), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError as e:
    print("BlockingIOError")
order.append("let go")
os.close(copy)
thread.join()
print(order)

# Another process holds the lock, and this one has had a lock on another file, which is closed: its descriptor is no more.
mine = open(path, "w")
child = subprocess.Popen([sys.executable, "-c", """
import fcntl, sys, time
f = open(sys.argv[1], "w")
fcntl.flock(f, fcntl.LOCK_EX)
print("the child has it", flush=True)
time.sleep(0.3)
""", path], stdout=subprocess.PIPE, text=True)
print(child.stdout.readline().strip())
other = open(os.path.join(directory.name, "other"), "w")
fcntl.flock(other, fcntl.LOCK_EX)
other.close()
fcntl.flock(mine, fcntl.LOCK_EX)
print("after the child")
child.stdout.close()
print(child.wait())

# Without waiting: "is another instance running?"
mine.close()
NB = fcntl.LOCK_NB
for i in range(3):
    lock(fcntl.LOCK_EX | NB)
    print("not waiting", i, flush=True)
lock(fcntl.LOCK_SH | NB)
lock(fcntl.LOCK_SH | NB)
lock(fcntl.LOCK_EX | NB)
lock(fcntl.LOCK_SH | NB)
print("not waiting: shared, exclusive, shared", flush=True)
f = open(path, "w")
fcntl.flock(f.fileno(), fcntl.LOCK_EX | NB)
del f
f = open(path, "w")
fcntl.flock(f.fileno(), fcntl.LOCK_EX | NB)
del f
print("not waiting, by number", flush=True)
thread = threading.Thread(target=lock)
thread.start()
thread.join()
lock(fcntl.LOCK_EX | NB)
print("not waiting, after a thread that has ended", flush=True)
go_on.clear()
has_locked.clear()
thread = threading.Thread(target=locks_and_waits)
thread.start()
has_locked.wait()
lock(fcntl.LOCK_EX | NB)
print("not waiting, beside a thread that waits", flush=True)
go_on.set()
thread.join()

# A program that polls for a lock that a file of its own holds, which is in use, is refused every time, and does not pay for it.
held = open(path, "w")
fcntl.flock(held, fcntl.LOCK_EX)
before = gc.get_stats()[2]["collections"]
refused = 0
with open(path, "w") as mine:
    for i in range(300):
        try:
            fcntl.flock(mine, fcntl.LOCK_EX | NB)
        except BlockingIOError:
            refused += 1
print(refused, gc.get_stats()[2]["collections"] - before < 20)
held.close()
