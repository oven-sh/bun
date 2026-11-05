# A thread is to come out of a system call to run a finalizer, and the first try comes to nothing. Nobody collects after that.
# (What comes to nothing for real is a signal that arrives just before the system call begins. Here the program sees to it.)
import ctypes, fcntl, os, select, signal, tempfile, threading

libc = ctypes.CDLL(None)


class pollfd(ctypes.Structure):
    _fields_ = [("fd", ctypes.c_int), ("events", ctypes.c_short), ("revents", ctypes.c_short)]


# What gets a thread out of a system call is SIGURG, and a handler of the program's hears of it as of any other.
tries = []
signal.signal(signal.SIGURG, lambda number, frame: tries.append(number))

directory = tempfile.TemporaryDirectory()
path = os.path.join(directory.name, "lock")
held = open(path, "w")
fcntl.flock(held, fcntl.LOCK_SH)   # Until the finalizer lets go of it.
r, w = os.pipe()
done = []


class A:
    def __del__(self):
        done.append(True)
        fcntl.flock(held, fcntl.LOCK_UN)
        os.write(w, b"x")


def target():
    with open(path, "w") as mine:
        box.append(A())
        is_about_to_block.append(True)
        fcntl.flock(mine, fcntl.LOCK_EX)


box = []
is_about_to_block = []
thread = threading.Thread(target=target)
thread.start()
# Not a wait: a thread that waits collects, and an object that has been through a collection is found dead much later.
while not is_about_to_block:
    pass
# From here on a system call that is interrupted by this signal begins again by itself.
signal.siginterrupt(signal.SIGURG, False)
box.clear()
# With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
while not tries and not done:
    bytearray(1 << 20)
signal.siginterrupt(signal.SIGURG, True)
# In foreign code this thread does nothing: it does not collect, and wakes nobody.
print("finalized:", libc.poll(ctypes.byref(pollfd(r, select.POLLIN, 0)), 1, 120000))
thread.join()
print(done)
