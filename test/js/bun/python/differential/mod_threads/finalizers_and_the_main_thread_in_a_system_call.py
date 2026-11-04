# The main thread is in a system call when its finalizers fall due. Nobody asks for a collection.
# What gets it out is no signal of the program's: whatever the program does about signals, it is woken, and it hears of none.
import fcntl, os, signal, tempfile, threading, time

heard = []
said = []


class A:
    def __init__(self, what):
        self.what = what

    def __del__(self):
        said.append(self.what)


def churn(until):
    # With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
    deadline = time.monotonic() + 20
    while not until() and time.monotonic() < deadline:
        [[i] for i in range(1000)]
    return until()


def waits(name, begin, block, end):
    state = begin()
    is_about_to_block = threading.Event()
    came = []

    def target():
        is_about_to_block.wait()
        box.clear()
        came.append(churn(lambda: name in said))
        end(state)

    thread = threading.Thread(target=target)
    thread.start()
    box = [A(name)]
    is_about_to_block.set()
    result = block(state)
    thread.join()
    said.clear()
    print(name, "| finalized while its maker waited:", came[0], "| then the call returned", result, "| signals heard of:", heard, flush=True)


directory = tempfile.TemporaryDirectory()
path = os.path.join(directory.name, "lock")
fifo = os.path.join(directory.name, "fifo")
os.mkfifo(fifo)


def lock():
    held, wanted = open(path, "w"), open(path, "w")
    fcntl.flock(held, fcntl.LOCK_EX)
    return held, wanted


def all_of_them(how):
    print(how)
    waits("flock", lock, lambda files: fcntl.flock(files[1], fcntl.LOCK_EX), lambda files: files[0].close())
    waits("open", lambda: None, lambda _: os.close(os.open(fifo, os.O_RDONLY)), lambda _: os.close(os.open(fifo, os.O_WRONLY)))
    waits("sleep", lambda: None, lambda _: time.sleep(0.5), lambda _: None)


all_of_them("-- nothing done about signals")

everything = signal.valid_signals() - {signal.SIGKILL, signal.SIGSTOP, signal.SIGINT}
for number in everything:
    try:
        signal.signal(number, lambda number, frame: heard.append(number))
    except (OSError, ValueError):
        pass   # Some are not the program's to handle.
all_of_them("-- a handler for every signal")

for number in everything:
    try:
        signal.siginterrupt(number, False)
    except (OSError, ValueError):
        pass
all_of_them("-- system calls go on after a signal")

signal.pthread_sigmask(signal.SIG_BLOCK, everything)
all_of_them("-- every signal blocked")
