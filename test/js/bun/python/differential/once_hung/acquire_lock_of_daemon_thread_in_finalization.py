# test_threading.ThreadTests.test_acquire_daemon_thread_lock_in_finalization: must raise PythonFinalizationError
import threading, time
started = threading.Event()
lock = threading.Lock()
def loop():
    with lock:
        started.set()
        while True:
            time.sleep(1)
class Cycle:
    def __init__(self):
        self.self_ref = self
        self.thr = threading.Thread(target=loop, daemon=True)
        self.thr.start()
        started.wait()
    def __del__(self):
        try:
            lock.acquire()
        except PythonFinalizationError:
            print("got the correct exception!")
Cycle()
