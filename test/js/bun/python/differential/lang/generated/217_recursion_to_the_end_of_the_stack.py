# Recursion that ends where the stack does, not at sys.getrecursionlimit(): a RecursionError like any other, after which all is well.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import threading
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import threading')

try: sys.setrecursionlimit(200_000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(200_000)')


try:
    def plain():
        return plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain():')


try:
    def with_arguments(a, b=1, *, d=2):
        return with_arguments(a, b=b, d=d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_arguments(a, b=1, *, d=2):')


try:
    def not_a_tail_call(n):
        return 1 + not_a_tail_call(n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_a_tail_call(n):')


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')


try:
    def generator():
        yield from generator()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator():')


try:
    def comprehension():
        return [comprehension() for _ in (1,)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def comprehension():')


try:
    def with_handler():
        try:
            return with_handler()
        finally:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_handler():')


try:
    def with_locals():
        a, b, c, d, e, f, g, h = 1, 2, 3, 4, 5, 6, 7, 8
        return with_locals() + a + b + c + d + e + f + g + h
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_locals():')


try:
    def mutual_a():
        return mutual_b()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mutual_a():')


try:
    def mutual_b():
        return mutual_a()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mutual_b():')


try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try: cases = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cases = { "plain": plain, "with_arguments": lambda: with_arguments(1,...')


try:
    def countdown(n):
        return 0 if not n else 1 + countdown(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def countdown(n):')


try:
    def outcome(function):
        try:
            function()
            return "returned"
        except RecursionError as e:
            # What counts the frames has counted them all out again.
            return type(e).__name__, isinstance(e, RuntimeError), e.__traceback__ is not None, e.__traceback__.tb_next is not None, countdown(50)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outcome(function):')


# In threads with small stacks, so that the end is soon reached.
try:
    def in_thread(function, attempts=1):
        results = []
        threading.stack_size(64 * 1024)
        thread = threading.Thread(target=lambda: results.extend(outcome(function) for attempt in range(attempts)))
        thread.start()
        thread.join()
        threading.stack_size(0)
        return results
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_thread(function, attempts=1):')


try:
    for name, function in cases.items():
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('in_thread(function) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', in_thread(function))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_thread(function)')
        try: print('countdown(900) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', countdown(900))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: countdown(900)')
        try: print('len([x for x in range(5)]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', len([x for x in range(5)]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len([x for x in range(5)])')
        try: print('sys.getrecursionlimit() [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', sys.getrecursionlimit())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.getrecursionlimit()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, function in cases.items():')
try: print("again and again", 'in_thread(plain, 3) =>', in_thread(plain, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_thread(plain, 3)')
try: print("in the main thread", 'outcome(plain) =>', outcome(plain))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcome(plain)')
try: print('countdown(900) =>', countdown(900))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: countdown(900)')

# Caught deep down, and gone on from there.
try:
    def catches(n):
        try:
            return catches(n + 1)
        except RecursionError:
            return "caught"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catches(n):')


try: results = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results = []')
try: threading.stack_size(64 * 1024)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: threading.stack_size(64 * 1024)')
try: thread = threading.Thread(target=lambda: results.append(catches(0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread = threading.Thread(target=lambda: results.append(catches(0)))')
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try: thread.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.join()')
try: threading.stack_size(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: threading.stack_size(0)')
try: print(results)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results')
try: sys.setrecursionlimit(1000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(1000)')
try:
    try:
        countdown(2000)
    except RecursionError as e:
        print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(countdown(900))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: countdown(900)')
