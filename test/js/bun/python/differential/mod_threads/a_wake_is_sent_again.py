# A thread is to come out of a system call to run a finalizer, and the first try comes to nothing. Nobody collects after that.
# (What comes to nothing for real is a signal that arrives just before the system call begins. Here the program sees to it.)
import ctypes, fcntl, os, select, signal, tempfile, threading

libc = ctypes.CDLL(None)


class pollfd(ctypes.Structure):
    _fields_ = [("fd", ctypes.c_int), ("events", ctypes.c_short), ("revents", ctypes.c_short)]


directory = tempfile.TemporaryDirectory()
path = os.path.join(directory.name, "lock")
held = open(path, "w")
fcntl.flock(held, fcntl.LOCK_SH)   # Until the finalizer lets go of it.
r, w = os.pipe()
done = []


class A:
    def __init__(self, what):
        self.what = what

    def __del__(self):
        done.append(self.what)
        if self.what == "the thread's":
            fcntl.flock(held, fcntl.LOCK_UN)
            os.write(w, b"x")


def target():
    with open(path, "w") as mine:
        box.append(A("the thread's"))
        is_about_to_block.set()
        fcntl.flock(mine, fcntl.LOCK_EX)


box = []
is_about_to_block = threading.Event()
thread = threading.Thread(target=target)
a = A("mine")   # As old as the other one: a collection that finds this one dead has found that one dead.
thread.start()
is_about_to_block.wait()
# From here on a system call that is interrupted by this signal begins again by itself.
signal.siginterrupt(signal.SIGURG, False)
box.clear()
del a
while "mine" not in done:
    [[i] for i in range(1000)]
signal.siginterrupt(signal.SIGURG, True)
# In foreign code this thread does nothing: it does not collect, and wakes nobody.
print("finalized:", libc.poll(ctypes.byref(pollfd(r, select.POLLIN, 0)), 1, 20000))
thread.join()
print(sorted(done))
