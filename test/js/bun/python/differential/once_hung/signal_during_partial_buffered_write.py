# test_io.test_signals.CSignalsTest.test_interrupted_write_buffered (and _text): after a partial write the buffered layer must run pending signal handlers
import os, signal, threading
def handler(*args):
    1 / 0
signal.signal(signal.SIGALRM, handler)
r, w = os.pipe()
def read_one():
    os.read(r, 1)
t = threading.Thread(target=read_one, daemon=True)
wio = open(w, "wb", closefd=False)
signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGALRM])
t.start()
signal.pthread_sigmask(signal.SIG_UNBLOCK, [signal.SIGALRM])
signal.alarm(1)
try:
    wio.write(b"x" * (4 * 1024 * 1024 + 1))
except ZeroDivisionError:
    print("ZeroDivisionError", flush=True)
os._exit(0)
