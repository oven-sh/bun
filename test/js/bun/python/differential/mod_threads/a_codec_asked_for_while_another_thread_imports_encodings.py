# The codecs that are not built in are found by a function that the package `encodings` registers. An interpreter that imports the package when such a codec is first asked for has to see to a second thread that asks
# while the first is still importing: it waits, as for any module that another thread is busy with. (It found no search function: "LookupError: no codec search functions registered".)
# Nothing here goes by the clock. The first thread is held in the last thing that the package does, its call of codecs.register(), until the second has its answer, or is seen to wait for the module in importlib's own
# table of who waits for which lock. (Not in a finder: importlib calls those with the import lock in its hand, and the second thread would not come as far as the lock of the module.) CPython has imported the package
# long ago, and nothing is held there.
import codecs, importlib._bootstrap as bootstrap, threading, time
inside = threading.Event(); answered = threading.Event(); results = {}
register = codecs.register
def holds_the_first_thread(search_function):
    if threading.current_thread() is first:
        inside.set()
        deadline = time.monotonic() + 50          # Reached only where something is wrong, and then it is said.
        while not answered.is_set() and not bootstrap._blocking_on.get(second.ident):
            if time.monotonic() > deadline: results['the second thread'] = 'neither has an answer nor is seen to wait'; break
            time.sleep(0.001)
    return register(search_function)
codecs.register = holds_the_first_thread
def ask(who, encoding):
    try: results[who] = 'x'.encode(encoding)
    except LookupError as e: results[who] = 'LookupError: %s' % e
def run_first():
    try: ask('first', 'cp037')
    finally: inside.set()
def run_second():
    inside.wait()
    try: ask('second', 'cp500')
    finally: answered.set()
first = threading.Thread(target=run_first); second = threading.Thread(target=run_second)
second.start(); first.start(); first.join(); second.join()
print(sorted(results.items()))
