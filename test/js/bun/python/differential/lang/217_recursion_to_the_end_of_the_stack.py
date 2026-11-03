# Recursion that ends where the stack does, not at sys.getrecursionlimit(): a RecursionError like any other, after which all is well.
import sys
import threading

sys.setrecursionlimit(200_000)


def plain():
    return plain()


def with_arguments(a, b=1, *, d=2):
    return with_arguments(a, b=b, d=d)


def not_a_tail_call(n):
    return 1 + not_a_tail_call(n + 1)


class C:
    def method(self):
        return self.method()

    def __call__(self):
        return self()

    @property
    def attribute(self):
        return self.attribute

    def __getitem__(self, key):
        return self[key]

    def __add__(self, other):
        return self + other

    def __repr__(self):
        return repr(self)

    def __eq__(self, other):
        return self == other

    __hash__ = None


def generator():
    yield from generator()


def comprehension():
    return [comprehension() for _ in (1,)]


def with_handler():
    try:
        return with_handler()
    finally:
        pass


def with_locals():
    a, b, c, d, e, f, g, h = 1, 2, 3, 4, 5, 6, 7, 8
    return with_locals() + a + b + c + d + e + f + g + h


def mutual_a():
    return mutual_b()


def mutual_b():
    return mutual_a()


c = C()
cases = {
    "plain": plain,
    "with_arguments": lambda: with_arguments(1, 2, d=4),
    "not_a_tail_call": lambda: not_a_tail_call(0),
    "method": c.method,
    "__call__": c,
    "property": lambda: c.attribute,
    "__getitem__": lambda: c[0],
    "__add__": lambda: c + 1,
    "__repr__": lambda: repr(c),
    "__eq__": lambda: c == 1,
    "generator": lambda: list(generator()),
    "comprehension": comprehension,
    "with_handler": with_handler,
    "with_locals": with_locals,
    "mutual": mutual_a,
    "lambda": lambda: (lambda f: f(f))(lambda f: f(f)),
}


def countdown(n):
    return 0 if not n else 1 + countdown(n - 1)


def outcome(function):
    try:
        function()
        return "returned"
    except RecursionError as e:
        # What counts the frames has counted them all out again.
        return type(e).__name__, isinstance(e, RuntimeError), e.__traceback__ is not None, e.__traceback__.tb_next is not None, countdown(50)


# In threads with small stacks, so that the end is soon reached.
def in_thread(function, attempts=1):
    results = []
    threading.stack_size(64 * 1024)
    thread = threading.Thread(target=lambda: results.extend(outcome(function) for attempt in range(attempts)))
    thread.start()
    thread.join()
    threading.stack_size(0)
    return results


for name, function in cases.items():
    print(name, in_thread(function), countdown(900), len([x for x in range(5)]), sys.getrecursionlimit())
print("again and again", in_thread(plain, 3))
print("in the main thread", outcome(plain), countdown(900))

# Caught deep down, and gone on from there.
def catches(n):
    try:
        return catches(n + 1)
    except RecursionError:
        return "caught"


results = []
threading.stack_size(64 * 1024)
thread = threading.Thread(target=lambda: results.append(catches(0)))
thread.start()
thread.join()
threading.stack_size(0)
print(results)
sys.setrecursionlimit(1000)
try:
    countdown(2000)
except RecursionError as e:
    print(e)
print(countdown(900))
