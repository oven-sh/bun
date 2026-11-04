# The interpreter exits while daemon threads are stopped in all sorts of places. Each holds an object with a finalizer, in a variable
# and as a temporary, and none of those is finalized.
import subprocess, sys

if len(sys.argv) > 1:
    import functools, os, select, threading, time

    class A:
        def __init__(self, name):
            self.name = name

        def __del__(self, write=os.write):
            write(1, ("finalized: %s\n" % self.name).encode())

    started = threading.Semaphore(0)
    never = threading.Event()

    def block(*held):
        started.release()
        never.wait()

    def spin(*held):
        started.release()
        while True:
            pass

    def spins(name):
        spin(A(name))

    def counts(name):
        held = A(name)
        started.release()
        n = 0
        while True:
            n += len([i for i in range(10)])

    def recursion(name, depth=200):
        held = A(name) if depth == 100 else None
        return recursion(name, depth - 1) if depth else block()

    def generator(name):
        def g():
            held = A(name)
            try:
                yield block(A(name + ", temporary"))
            finally:
                pass
        for _ in g():
            pass

    def delegating(name):
        def inner():
            yield block(A(name))

        def outer():
            yield from inner()
        list(outer())

    def comprehension(name):
        return [block(a) for a in [A(name)]]

    def class_body(name):
        class K:
            held = A(name)
            block()

    def key_function(name):
        sorted([A(name), A(name + ", second")], key=block)

    def operator(name):
        class N:
            def __add__(self, other):
                block()
        return (A(name), N() + N())

    def attribute(name):
        class N:
            def __getattr__(self, attribute):
                block()
        return (A(name), N().x)

    def star_arguments(name):
        block(*[A(name)], **{})

    def keywords(name):
        def f(*, a, b):
            pass
        f(a=A(name), b=block())

    def with_statement(name):
        class M:
            def __enter__(self):
                return A(name)

            def __exit__(self, *arguments):
                pass
        with M() as held, M() as second:
            block()

    def finally_clause(name):
        try:
            raise ValueError(A(name))
        except ValueError as e:
            try:
                pass
            finally:
                block()

    def partial(name):
        functools.partial(block, A(name))()

    def reduces(name):
        functools.reduce(lambda a, b: block(), [A(name), 1])

    def sleeps(name):
        held = A(name)
        started.release()
        time.sleep(1000)

    def selects(name):
        held = A(name)
        r, w = os.pipe()
        started.release()
        select.select([r], [], [])

    def reads(name):
        held = A(name)
        f = open(os.pipe()[0], "rb")
        started.release()
        f.read(1)

    def locks(name):
        held = A(name)
        lock = threading.Lock()
        lock.acquire()
        started.release()
        lock.acquire()

    def formats(name):
        class F:
            def __format__(self, spec):
                block()
        return (A(name), f"{name}{F()}")

    def unpacks(name):
        class I:
            def __iter__(self):
                return self

            def __next__(self):
                block()
        a, b = A(name), 0
        c, *d = I()

    def executes(name):
        exec("held = A(name)\nblock()", {"A": A, "block": block, "name": name})

    sorts = [value for key, value in list(globals().items()) if callable(value) and key not in ("A", "block", "spin")]
    for function in sorts:
        threading.Thread(target=function, args=(function.__name__,), daemon=True).start()
    for function in sorts:
        started.acquire()
    print(len(sorts), "threads", flush=True)
else:
    p = subprocess.run([sys.executable, __file__, "run"], capture_output=True, text=True, timeout=300)
    print(p.returncode, p.stdout, p.stderr)
