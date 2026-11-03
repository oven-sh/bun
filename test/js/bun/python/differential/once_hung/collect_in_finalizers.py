# test_asyncio.test_futures/test_tasks ("... never_retrieved", "log_destroyed ...", 9 tests), test_gc.test_trashcan_threads: not hangs. The finalizers of
# test_future_del_collect (100 objects whose __del__ calls gc.collect()) run in the first gc.collect() of a later test, and one gc.collect() takes 0.1 to 0.5 s.
import gc
import asyncio, unittest.mock
gc.collect()
class Evil:
    def __del__(self):
        gc.collect()
l = [Evil() for i in range(100)]
del l
gc.collect(); print("collected, with 100 finalizers that collect")
