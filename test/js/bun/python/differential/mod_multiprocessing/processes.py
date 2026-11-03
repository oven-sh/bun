# multiprocessing with the default start method, whatever it is. (Few processes: each is a new interpreter.)
import multiprocessing as mp, sys, time

def square(x): return x * x
def put(queue, value): queue.put(value)
def fail(): raise ValueError("in the child")

if __name__ == "__main__":
    print("spawn" in mp.get_all_start_methods(), mp.get_start_method() in mp.get_all_start_methods())
    with mp.Pool(2) as pool:
        print(pool.map(square, range(6)), pool.apply(square, (7,)), sorted(pool.imap_unordered(square, [1, 2, 3])))
        try:
            pool.apply(fail)
        except ValueError as e:
            print("ValueError", e)
    queue = mp.Queue()
    process = mp.Process(target=put, args=(queue, "hello"))
    process.start()
    print(queue.get(timeout=120))
    process.join()
    print(process.exitcode, process.is_alive())
    process = mp.get_context("spawn").Process(target=sys.exit, args=(3,))
    process.start(); process.join()
    print(process.exitcode)
    process = mp.Process(target=time.sleep, args=(120,))
    process.start()
    process.terminate(); process.join()
    print(process.exitcode)
    lock = mp.Lock()
    with lock:
        print(lock.acquire(False))
    try:
        mp.get_context("no such method")
    except ValueError as e:
        print("ValueError", e)
