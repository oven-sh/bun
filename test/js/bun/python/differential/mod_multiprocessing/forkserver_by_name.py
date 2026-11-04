# The start method "forkserver": the default on Linux, and asked for by name.
import multiprocessing as mp
import sys
from concurrent.futures import ProcessPoolExecutor


def double(x):
    return x * 2


def report(queue, inherited):
    queue.put((mp.get_start_method(), type(mp.get_context()).__name__, mp.current_process().name, inherited, "changed" in globals()))


if __name__ == "__main__":
    changed = True      # A child knows nothing of what happened in the parent.
    print(mp.get_start_method(allow_none=True))
    default = mp.get_all_start_methods()[0]
    print(default == ("spawn" if sys.platform == "darwin" else "forkserver"), mp.get_start_method() == default)
    print("forkserver" in mp.get_all_start_methods(), "spawn" in mp.get_all_start_methods())

    context = mp.get_context("forkserver")
    print(context.get_start_method(), type(context).__name__, context.Process.__name__, context.get_context() is context)
    print(context.set_forkserver_preload(["json", "no_such_module"]))
    queue = context.Queue()
    process = context.Process(target=report, args=(queue, [1, 2]), name="child")
    process.start()
    print(queue.get())
    process.join()
    print(process.exitcode)

    try:
        context.Process(target=lambda: None).start()
    except Exception as e:
        print(type(e).__name__)

    with context.Pool(2) as pool:
        print(pool.map(double, range(5)))
    with ProcessPoolExecutor(2, mp_context=context) as executor:
        print(list(executor.map(double, range(3))))
    with ProcessPoolExecutor(2) as executor:
        print(list(executor.map(double, range(3))))

    lock, event, value = context.Lock(), context.Event(), context.Semaphore(2)
    print(lock.acquire(False), event.is_set(), value.acquire(False))

    mp.set_start_method("spawn", force=True)
    print(mp.get_start_method())
    mp.set_start_method("forkserver", force=True)
    print(mp.get_start_method())
    queue = mp.Queue()
    process = mp.Process(target=report, args=(queue, None), name="another")
    process.start()
    print(queue.get())
    process.join()
