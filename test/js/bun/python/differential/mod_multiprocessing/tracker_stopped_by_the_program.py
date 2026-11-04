# A program that stops the resource tracker learns from its status whether anything was leaked. What the program has dropped by then
# was not: semaphores and shared memory are struck off the tracker's list when they are finalized.
import multiprocessing, subprocess, sys
from multiprocessing import resource_tracker

if len(sys.argv) > 1:
    context = multiprocessing.get_context("spawn")

    def use():
        return [context.Lock(), context.RLock(), context.Semaphore(2), context.Condition(), context.Queue(), context.Event()]

    kept = None
    for _ in range(3):
        use()
    if sys.argv[1] == "leaks":
        kept = context.Lock()
    resource_tracker._resource_tracker._stop()
    print("status of the tracker:", resource_tracker._resource_tracker._exitcode)
else:
    for mode in ("drops all", "leaks"):
        p = subprocess.run([sys.executable, __file__, mode], capture_output=True, text=True, timeout=120)
        print(mode, p.returncode, p.stdout, "leaked" in p.stderr)
