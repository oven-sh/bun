# faulthandler.dump_traceback_later() is called for the first time by a thread that leaves all signals to the main thread. The
# traceback is written although the main thread waits in a system call.
import faulthandler, os, signal, tempfile, threading, time

# A child that is left behind does not keep the pipes of this script open.
NOWHERE = [(os.POSIX_SPAWN_OPEN, descriptor, "/dev/null", os.O_WRONLY, 0) for descriptor in (1, 2)]

log = tempfile.TemporaryFile()
seen = threading.Event()
child = os.posix_spawn("/bin/sleep", ["sleep", "100"], {}, file_actions=NOWHERE)


def work():
    signal.pthread_sigmask(signal.SIG_BLOCK, signal.valid_signals())
    faulthandler.dump_traceback_later(0.2, file=log)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if b'File "' in os.pread(log.fileno(), 1 << 16, 0):
            seen.set()
            break
        time.sleep(0.01)
    os.kill(child, signal.SIGKILL)


threading.Thread(target=work).start()
os.waitpid(-1, 0)
faulthandler.cancel_dump_traceback_later()
print("written while the main thread waited:", seen.is_set())
