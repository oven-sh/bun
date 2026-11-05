# A thread is to come out of a system call to run a finalizer, and the first try comes to nothing. Nobody collects after that.
# (What comes to nothing for real is a signal that arrives just before the system call begins. Here the program sees to it.)
import ctypes, errno, fcntl, os, select, signal, tempfile, threading, time

libc = ctypes.CDLL(None, use_errno=True)


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


# In a function that has returned by the time the thread blocks: the frame of target() stays as it is from then on, with whatever it
# has had in its registers. What that function leaves on the stack lies where the frames of flock() come to lie, which do not write all
# of it: the object is found dead because flock() may wait, and a function that may wait begins on a stack that has been wiped.
# (Before it was such a function, this script gave up here.)
def make():
    box.append(A())


def target():
    with open(path, "w") as mine:
        make()
        is_about_to_block.append(True)
        fcntl.flock(mine, fcntl.LOCK_EX)


def give_up_after(deadline, what):
    if time.monotonic() > deadline:
        print("gave up:", what, flush=True)
        os._exit(1)   # The thread is in a system call for good.


box = []
is_about_to_block = []
thread = threading.Thread(target=target)
thread.start()
deadline = time.monotonic() + 120
# Not a wait: a thread that waits collects, and an object that has been through a collection is found dead much later.
while not is_about_to_block:
    give_up_after(deadline, "the thread has not got as far as its system call")
# From here on a system call that is interrupted by this signal begins again by itself.
signal.siginterrupt(signal.SIGURG, False)
box.clear()
# With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
while not tries and not done:
    bytearray(1 << 20)
    give_up_after(deadline, "the object was not found dead")
signal.siginterrupt(signal.SIGURG, True)
# In foreign code this thread does nothing: it does not collect, and wakes nobody.
# (A collector may stop the threads with a signal, if the other thread collects, and poll() is never begun again after one.)
while (ready := libc.poll(ctypes.byref(pollfd(r, select.POLLIN, 0)), 1, 120000)) == -1 and ctypes.get_errno() == errno.EINTR:
    pass
print("finalized:", ready)
thread.join()
print(done)
