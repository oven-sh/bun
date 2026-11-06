# Signals and threads: handlers run in the main thread.
import signal, threading, time, os, _thread, sys

log = []
def handler(num, frame): log.append((signal.Signals(num).name, threading.current_thread() is threading.main_thread()))
signal.signal(signal.SIGUSR1, handler)

# sent by another thread, while the main one computes, sleeps, waits for a lock, joins
def send(): time.sleep(0.03); os.kill(os.getpid(), signal.SIGUSR1)
threading.Thread(target=send).start()
while not log: pass
print(log); log.clear()
# (If the sender is late, the signal comes after the wait. What is printed does not depend on it.)
def handled():
    while not log: time.sleep(0.001)
    return log
threading.Thread(target=send).start(); time.sleep(0.2); print(handled()); log.clear()
l = threading.Lock(); l.acquire()
threading.Thread(target=send).start(); print(l.acquire(timeout=0.2), handled()); log.clear()
t = threading.Thread(target=lambda: (send(), time.sleep(0.05))); t.start(); t.join(); print(handled()); log.clear()
ev = threading.Event()
threading.Thread(target=send).start(); print(ev.wait(0.2), handled()); log.clear()

# a handler that raises interrupts the wait
def boom(num, frame): raise KeyError("from handler")
signal.signal(signal.SIGUSR1, boom)
# The sender does not begin before the main thread is inside the try.
def send_after(go): go.wait(); send()
for name, wait in [("lock", lambda: l.acquire()), ("sleep", lambda: time.sleep(500)), ("event", lambda: threading.Event().wait()), ("join", lambda: blocked.join())]:
    stop = threading.Event(); go = threading.Event()
    blocked = threading.Thread(target=stop.wait, daemon=True); blocked.start()
    threading.Thread(target=send_after, args=(go,)).start()
    try: go.set(); wait(); print(name, "not interrupted")
    except KeyError as e: print(name, "KeyError", e)
    stop.set(); blocked.join()

# only the main thread may set handlers
res = []
def try_set():
    try: signal.signal(signal.SIGUSR2, handler)
    except ValueError as e: res.append(str(e))
    try: signal.set_wakeup_fd(-1)
    except ValueError as e: res.append(str(e))
t = threading.Thread(target=try_set); t.start(); t.join(); print(res)

# interrupt_main
signal.signal(signal.SIGINT, signal.default_int_handler)
go = threading.Event()
def interrupt(): go.wait(); time.sleep(0.03); _thread.interrupt_main()
threading.Thread(target=interrupt).start()
try:
    go.set()
    while True: time.sleep(0.01)
except KeyboardInterrupt: print("KeyboardInterrupt")
signal.signal(signal.SIGUSR1, handler)
threading.Thread(target=lambda: _thread.interrupt_main(signal.SIGUSR1)).start()
while not log: time.sleep(0.001)
print(log); log.clear()

# pthread_kill to a thread: the handler still runs in the main thread
started = threading.Event(); fin = threading.Event()
t = threading.Thread(target=lambda: (started.set(), fin.wait())); t.start(); started.wait()
signal.pthread_kill(t.ident, signal.SIGUSR1)
while not log: time.sleep(0.001)
print(log); fin.set(); t.join()

# a thread blocked in a system call goes on after a signal
r, w = os.pipe(); got = []
t = threading.Thread(target=lambda: got.append(os.read(r, 1))); t.start(); time.sleep(0.02)
log.clear(); signal.pthread_kill(t.ident, signal.SIGUSR1); time.sleep(0.02); os.write(w, b"k"); t.join(); print(got, handled())

# sigwait in a thread
signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGUSR2])
got = []
t = threading.Thread(target=lambda: got.append(signal.sigwait([signal.SIGUSR2]))); t.start(); time.sleep(0.02)
os.kill(os.getpid(), signal.SIGUSR2); t.join(); print(got)
