# test_threading.ThreadTests.test_start_new_thread_failed (run with -E or -I): the RuntimeError is right, but then the collection at exit cannot start its helper threads, and WTF::Thread::create() crashes
import resource, _thread
soft, hard = resource.getrlimit(resource.RLIMIT_NPROC)
resource.setrlimit(resource.RLIMIT_NPROC, (0, hard))
try:
    _thread.start_joinable_thread(lambda: None).join()
    print("no effect")
except RuntimeError as e:
    print("RuntimeError", e)
