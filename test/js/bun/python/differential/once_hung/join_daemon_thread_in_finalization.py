# test_threading.ThreadTests.test_join_daemon_thread_in_finalization: must raise PythonFinalizationError
import threading
def loop():
    while True:
        pass
class Cycle:
    def __init__(self):
        self.self_ref = self
        self.thr = threading.Thread(target=loop, daemon=True)
        self.thr.start()
    def __del__(self):
        try:
            self.thr.join()
        except PythonFinalizationError:
            print("got the correct exception!")
Cycle()
