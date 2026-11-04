# try: threading.Event().wait() / except KeyboardInterrupt: a program without other threads sleeps until it is interrupted.
import os, queue, signal, subprocess, sys, threading

INTERRUPT = "import os, signal, sys; os.kill(int(sys.argv[1]), signal.SIGINT)"


def until_interrupted(name, wait):
    try:
        child = subprocess.Popen([sys.executable, "-c", INTERRUPT, str(os.getpid())])
        wait()
        print(name, "returned")
    except KeyboardInterrupt:
        print(name, "KeyboardInterrupt", flush=True)
    except RuntimeError as e:
        print(name, "RuntimeError", e, flush=True)
        try:
            child.wait()
        except KeyboardInterrupt:
            pass
    child.wait()


def twice(lock):
    lock.acquire()
    lock.acquire()


def wait(condition):
    with condition:
        condition.wait()


until_interrupted("Event.wait", threading.Event().wait)
until_interrupted("Lock.acquire", lambda: twice(threading.Lock()))
until_interrupted("Condition.wait", lambda: wait(threading.Condition()))
until_interrupted("Semaphore.acquire", threading.Semaphore(0).acquire)
until_interrupted("Queue.get", queue.Queue().get)

# The signal may as well end the process.
SLEEPER = """
import signal, threading
signal.signal(signal.SIGINT, signal.%s)
signal.signal(signal.SIGTERM, signal.SIG_DFL)
print("ready", flush=True)
threading.Event().wait()
"""
for action, number in (("SIG_DFL", signal.SIGINT), ("SIG_IGN", signal.SIGTERM)):
    child = subprocess.Popen([sys.executable, "-c", SLEEPER % action], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(child.stdout.readline().strip())
    child.send_signal(number)
    print(action, repr(child.stdout.read()), child.wait())

# What the wait is for may be brought about by a finalizer.
class Releases:
    def __init__(self, lock):
        self.lock = lock

    def __del__(self):
        self.lock.release()


lock = threading.Lock()
lock.acquire()
r = Releases(lock)
del r
print(lock.acquire())
