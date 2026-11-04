# What the program has done about a signal before faulthandler.dump_traceback_later() is called for the first time stays as it is:
# an interpreter that needs a signal of its own to get the main thread out of a system call takes one that is free.
import faulthandler, os, signal, tempfile, threading, time

# A child that is left behind does not keep the pipes of this script open.
NOWHERE = [(os.POSIX_SPAWN_OPEN, descriptor, "/dev/null", os.O_WRONLY, 0) for descriptor in (1, 2)]

got = []
high = [signal.SIGRTMAX - n for n in range(6)]
for number in high[::2]:
    signal.signal(number, lambda n, frame: got.append(n))
signal.pthread_sigmask(signal.SIG_BLOCK, high[1::2])

# A thread has one to itself, which the others tell it things with.
PRIVATE = signal.SIGRTMAX - 6
told = []
ready = threading.Event()


def listen():
    signal.pthread_sigmask(signal.SIG_BLOCK, [PRIVATE])
    ready.set()
    while len(told) < 3:
        told.append(signal.sigwait([PRIVATE]))


listener = threading.Thread(target=listen)
listener.start()
ready.wait()
signal.pthread_kill(listener.ident, PRIVATE)

log = tempfile.TemporaryFile()
seen = threading.Event()
child = os.posix_spawn("/bin/sleep", ["sleep", "100"], {}, file_actions=NOWHERE)


def look():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if b'File "' in os.pread(log.fileno(), 1 << 16, 0):
            seen.set()
            break
        time.sleep(0.01)
    os.kill(child, signal.SIGKILL)


faulthandler.dump_traceback_later(0.2, exit=False, file=log)
threading.Thread(target=look).start()
os.waitpid(-1, 0)
faulthandler.cancel_dump_traceback_later()
print("written while the thread waited:", seen.is_set())
print("none has arrived:", got, sorted(signal.sigpending() & set(high)))
for number in high:
    signal.raise_signal(number)
print("handled:", got == high[::2])
print("pending:", sorted(signal.sigpending() & set(high)) == sorted(high[1::2]))
print("taken:", sorted(signal.sigwait(high[1::2]) for number in high[1::2]) == sorted(high[1::2]))
print("blocked:", set(high[1::2]) <= signal.pthread_sigmask(signal.SIG_BLOCK, []))
for i in range(2):
    signal.pthread_kill(listener.ident, PRIVATE)
listener.join()
print("the thread was told:", told == [PRIVATE] * 3)
