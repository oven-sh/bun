# What cannot be called says so in the same words on every thread.
import sys, threading


class L(list):
    pass


values = [[1, 2], [], L(), (1,), {}, {1}, frozenset(), "s", b"b", bytearray(b"a"), 1, 10 ** 30, 1.5, 1j, None, True, ..., NotImplemented,
          object(), sys, range(3), slice(1), iter([]), memoryview(b"")]


def attempts(value):
    yield lambda: value()
    yield lambda: value(0)
    yield lambda: value(a=1)
    yield lambda: value(0, a=1)
    yield lambda: value(*[1, 2])
    yield lambda: value(**{"a": 1})
    yield lambda: [value(i) for i in range(2)]
    yield lambda: list(map(value, [1]))
    yield lambda: sorted([2, 1], key=value)
    yield lambda: threading.Thread(target=value).run()


def main(out):
    for value in values:
        for attempt in attempts(value):
            # More than once: a call site changes with what it has seen.
            for _ in range(3):
                try:
                    attempt()
                    out.append("no error")
                except Exception as e:
                    out.append("%s: %s" % (type(e).__name__, e))
        out.append(callable(value))


here, there = [], []
main(here)
thread = threading.Thread(target=main, args=(there,))
thread.start()
thread.join()
print(here == there, len(here))
for line in dict.fromkeys(map(str, there)):
    print(line)
