# Ctrl-C while the program sleeps comes out of the sleep, whatever else the interpreter does with the time.
# With reference counts nothing runs in a thread that sleeps. A collector has finalizers to run there, and what the handler of a signal raises
# in one of them must not end up as "Exception ignored in __del__".
import gc, os, signal, sys, threading, time

is_asleep = False
in_finalizer, sent = threading.Event(), threading.Event()


class A:
    def __del__(self):
        if is_asleep:
            in_finalizer.set()
            sent.wait(60)


def sender():
    in_finalizer.wait(1)   # Or there is no such finalizer.
    os.kill(os.getpid(), signal.SIGINT)
    sent.set()


sys.unraisablehook = lambda unraisable: print("ignored:", type(unraisable.exc_value).__name__)
a = A(); del a
thread = threading.Thread(target=sender)
is_asleep = True
thread.start()
try:
    time.sleep(60)
    print("slept to the end")
except KeyboardInterrupt:
    print("KeyboardInterrupt came out of the sleep")
is_asleep = False
thread.join()

# The same with the callback of a weak reference, and a wait for a lock.
import weakref


class B:
    pass


def callback(reference):
    if is_asleep:
        in_finalizer.set()
        sent.wait(60)


in_finalizer.clear(); sent.clear()
b = B(); r = weakref.ref(b, callback); del b
thread = threading.Thread(target=sender)
is_asleep = True
thread.start()
try:
    threading.Event().wait(60)
    print("waited to the end")
except KeyboardInterrupt:
    print("KeyboardInterrupt came out of the wait")
is_asleep = False
thread.join()

# Only what the handler of a signal raises. What the finalizer raises itself is ignored, wherever it runs.
done = threading.Event()


class C:
    def __del__(self):
        done.set()
        raise ValueError


c = C(); del c
print("the wait ended:", done.wait(60))


# And only where the program did not ask for the finalizer: in gc.collect() it is ignored, as what any finalizer raises is.
class D:
    def __del__(self):
        signal.raise_signal(signal.SIGINT)
        print("not reached")


d = D(); d.me = d; del d
try:
    gc.collect()
    print("gc.collect() returned")
except KeyboardInterrupt:
    print("KeyboardInterrupt came out of gc.collect()")
