# test_lazy_import.LazyImportTypeTests.test_deeply_dotted_name: replayLazyImportFrom() recurses once per dot without a stack check
import threading, types
def run():
    m = types.SimpleNamespace()
    m.m = m
    ns = {"__builtins__": {"__lazy_import__": __lazy_import__, "__import__": lambda *args: m}}
    exec("lazy import " + ".".join(["m"] * 10_000) + " as x", ns)
    try:
        ns["x"].resolve()
    except RecursionError:
        print("RecursionError")
    print("done")
# As support.run_with_limited_c_stack() does. (With the usual stacks 10_000 levels happen to fit.)
threading.stack_size(256 * 1024)
thread = threading.Thread(target=run)
thread.start()
thread.join()
