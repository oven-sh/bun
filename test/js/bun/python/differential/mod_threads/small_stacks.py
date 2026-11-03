# Threads with small stacks: they run, and what is too deep for them ends in RecursionError, not in a crash.
import json
import sys
import threading


def in_thread(size, function):
    result = []

    def run():
        try:
            result.append(function())
        except BaseException as e:
            result.append(type(e).__name__)

    threading.stack_size(size)
    try:
        thread = threading.Thread(target=run)
        thread.start()
        thread.join()
    finally:
        threading.stack_size(0)
    return result


def simple():
    return sum(range(10)), "%s-%d" % ("a", 1), sorted({3: 1, 1: 2}), json.loads("[1, {\"a\": 2}]")


def endless():
    return endless()


def endless_repr():
    class C:
        def __repr__(self):
            return repr(self)
    return repr(C())


def nested():
    value = []
    for _ in range(200_000):
        value = [value]
    try:
        return repr(value)
    finally:
        # Taken apart here, level by level: what is left is not for a small stack to free.
        while value:
            value = value[0]


def endless_getattr():
    class C:
        def __getattr__(self, name):
            return getattr(self, name + "x")
    return C().a


def recovers():
    caught = 0
    for _ in range(3):
        try:
            endless()
        except RecursionError:
            caught += 1
    return caught, simple()[0]


minimum = 64 * 1024
for size in (minimum, 96 * 1024, 128 * 1024, 256 * 1024, 1024 * 1024):
    print(size, threading.stack_size(), [in_thread(size, f) for f in (simple, endless, endless_repr, nested, endless_getattr, recovers)])
for bad in (1, 4096, -1):
    try:
        threading.stack_size(bad)
    except ValueError as e:
        print(bad, "ValueError")
print(threading.stack_size(minimum), threading.stack_size(0), threading.stack_size())
