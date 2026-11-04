# A thread that waits for any signal at all gets those of the program. What the interpreter sends its own threads is none of them.
import gc, signal, threading, time

EVERYTHING = signal.valid_signals() - {signal.SIGCHLD}
WAYS = {
    "sigwait": lambda: int(signal.sigwait(EVERYTHING)),
    "sigwaitinfo": lambda: signal.sigwaitinfo(EVERYTHING).si_signo,
    "sigtimedwait": lambda: signal.sigtimedwait(EVERYTHING, 100).si_signo,
}


def collect(begun):
    begun.wait()
    for i in range(8):
        gc.collect()
        time.sleep(0.002)


def wait_after(begun, wait):
    begun.set()
    return wait()


signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGUSR1])
main = threading.get_ident()
for name, wait in WAYS.items():
    result = []
    begun = threading.Event()
    thread = threading.Thread(target=lambda: result.append(wait_after(begun, wait)))
    thread.start()
    collect(begun)
    signal.pthread_kill(thread.ident, signal.SIGUSR1)
    thread.join()
    print(name, "on another thread:", result == [signal.SIGUSR1])

    begun = threading.Event()
    thread = threading.Thread(target=lambda: (collect(begun), signal.pthread_kill(main, signal.SIGUSR1)))
    thread.start()
    print(name, "on the main thread:", wait_after(begun, wait) == signal.SIGUSR1)
    thread.join()
print("done")
