# A traceback that falls due (faulthandler.dump_traceback_later()) is written although the main thread waits in a system call. An
# interpreter in which that thread has to write it gets it out of the call with a signal. Whatever the program does about signals,
# that goes on working and does the process no harm. At most one real-time signal is taken away from the program for it.
import faulthandler, os, signal, subprocess, sys, tempfile, threading, time

# A child that is left behind does not keep the pipes of this script open.
NOWHERE = [(os.POSIX_SPAWN_OPEN, descriptor, "/dev/null", os.O_WRONLY, 0) for descriptor in (1, 2)]

MAIN = threading.get_ident()
REAL_TIME = range(signal.SIGRTMIN, signal.SIGRTMAX + 1)
# What ends a wait that nothing else can end is left alone.
ALL = signal.valid_signals() - {signal.SIGUSR1}
REFUSED = (OSError, RuntimeError, ValueError)


class Over(Exception):
    pass


def over(number, frame):
    raise Over


def is_written(log, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if b'File "' in os.pread(log.fileno(), 1 << 16, 0):
            return True
        time.sleep(0.01)
    return False


# Each waits until `then` is given what ends the wait.
def for_a_child(then):
    child = os.posix_spawn("/bin/sleep", ["sleep", "100"], {}, file_actions=NOWHERE)
    then(lambda: os.kill(child, signal.SIGKILL))
    os.waitpid(-1, 0)


def asleep(then):
    # What a handler raises is lost if the handler happens to be called in a finalizer. So the signal is sent until it has worked.
    awake = threading.Event()

    def end():
        while not awake.wait(1):
            signal.pthread_kill(MAIN, signal.SIGUSR1)

    signal.signal(signal.SIGUSR1, over)
    begun = False
    while True:
        try:
            if not begun:
                begun = True
                then(lambda: (signal.pthread_kill(MAIN, signal.SIGUSR1), end()))
                time.sleep(100)
            signal.signal(signal.SIGUSR1, signal.SIG_IGN)
            break
        except Over:
            pass
    awake.set()


def wait_with(function):
    def wait(then):
        old = signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGUSR1])
        then(lambda: signal.pthread_kill(MAIN, signal.SIGUSR1))
        function()
        signal.pthread_sigmask(signal.SIG_SETMASK, old)

    return wait


EVERYTHING = signal.valid_signals() - {signal.SIGCHLD}
for_signals = wait_with(lambda: signal.sigtimedwait(EVERYTHING, 100))
for_a_signal = wait_with(lambda: signal.sigwait([signal.SIGUSR1]))


def due_while_waiting(name, prepare=lambda: None, wait=for_a_child):
    log = tempfile.TemporaryFile()
    in_time = []
    threads = []

    def then(end):
        # The wait is not over before it has been seen, so it was written during the wait.
        threads.append(threading.Thread(target=lambda: (in_time.append(is_written(log)), end())))
        threads[0].start()

    faulthandler.dump_traceback_later(0.2, exit=False, file=log)
    undo = prepare()
    wait(then)
    threads[0].join()
    signal.signal(signal.SIGUSR1, signal.SIG_DFL)
    faulthandler.cancel_dump_traceback_later()
    if undo:
        undo()
    print(name + ":", "written while the thread waited:", in_time == [True])


def block_all_for_a_while():
    # As a program does around a fork.
    old = signal.pthread_sigmask(signal.SIG_BLOCK, ALL)
    signal.pthread_sigmask(signal.SIG_SETMASK, old)


def block_all():
    old = signal.pthread_sigmask(signal.SIG_BLOCK, ALL)
    return lambda: signal.pthread_sigmask(signal.SIG_SETMASK, old)


def all_to(action):
    def prepare():
        for number in sorted(ALL):
            if number in (signal.SIGINT, signal.SIGCHLD):
                continue
            try:
                signal.signal(number, action)
            except OSError:
                pass  # SIGKILL, SIGSTOP

    return prepare


got = []
handled = []


def handle_real_time():
    for number in REAL_TIME:
        try:
            signal.signal(number, lambda n, frame: got.append(n))
            handled.append(number)
        except OSError:
            pass


def restart_calls():
    # As an event loop does for the signals it handles.
    for number in REAL_TIME:
        try:
            signal.siginterrupt(number, False)
        except OSError:
            pass


def watch_and_stop_watching():
    for number in REAL_TIME:
        try:
            faulthandler.register(number, file=sys.stderr)
            faulthandler.unregister(number)
        except REFUSED:
            pass


due_while_waiting("nothing done about signals")
due_while_waiting("asleep", wait=asleep)
due_while_waiting("waiting for signals", wait=for_signals)
due_while_waiting("waiting for a signal", wait=for_a_signal)
due_while_waiting("all blocked for a while", block_all_for_a_while)
due_while_waiting("all blocked", block_all)
due_while_waiting("all blocked, asleep", block_all, asleep)
due_while_waiting("all ignored", all_to(signal.SIG_IGN))
due_while_waiting("all with their default effect", all_to(signal.SIG_DFL))
due_while_waiting("blocked for a while again", block_all_for_a_while)
due_while_waiting("watched for a while", watch_and_stop_watching)

# The real-time signals are the program's to handle, and none arrives that nobody has sent.
due_while_waiting("real-time signals handled", handle_real_time)
print("all but one at most:", len(REAL_TIME) - len(handled) <= 1)
due_while_waiting("calls restarted after them", restart_calls)
print("none has arrived:", got == [])
for number in handled:
    signal.raise_signal(number)
print("all have arrived:", got == handled)
for number in handled:
    signal.signal(number, signal.SIG_DFL)

# What the program blocks stays blocked, and what is sent meanwhile waits.
log = tempfile.TemporaryFile()
faulthandler.dump_traceback_later(0.2, exit=False, file=log)
signal.pthread_sigmask(signal.SIG_BLOCK, handled)
print("blocked:", set(handled) <= signal.pthread_sigmask(signal.SIG_BLOCK, []))
for number in handled:
    signal.raise_signal(number)
print("pending:", set(handled) <= signal.sigpending())
print("taken:", [signal.sigwait([number]) for number in handled] == handled)
print("written:", is_written(log))
print("nothing is left:", signal.sigpending() & set(REAL_TIME) == set())
signal.pthread_sigmask(signal.SIG_UNBLOCK, handled)
faulthandler.cancel_dump_traceback_later()
print("what the signals do:", {signal.getsignal(number) for number in REAL_TIME} == {signal.SIG_DFL}, signal.getsignal(signal.SIGURG) == signal.SIG_DFL)


# A process that is ended when the time is up says where it was, whatever was done about signals before the time was set.
def ended(name, before):
    program = f"""
import faulthandler, os, signal
{before}
nowhere = [(os.POSIX_SPAWN_OPEN, descriptor, "/dev/null", os.O_WRONLY, 0) for descriptor in (1, 2)]
os.posix_spawn("/bin/sleep", ["sleep", "5"], {{}}, file_actions=nowhere)
faulthandler.dump_traceback_later(0.2, exit=True)
os.waitpid(-1, 0)
"""
    result = subprocess.run([sys.executable, "-c", program], capture_output=True)
    print("ended,", name + ":", result.returncode, b"Timeout (0:00:00.200000)!" in result.stderr, b'File "<string>", line 7 in <module>' in result.stderr)


ended("all blocked", "signal.pthread_sigmask(signal.SIG_BLOCK, signal.valid_signals())")
ended("real-time signals ignored", "[signal.signal(number, signal.SIG_IGN) for number in range(signal.SIGRTMIN, signal.SIGRTMAX + 1)]")
print("done")
