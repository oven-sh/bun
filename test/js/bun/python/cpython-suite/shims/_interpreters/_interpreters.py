"""Not CPython's _interpreters, which is written in C and makes subinterpreters. There are none here.

test_concurrent_futures/util.py names concurrent.futures.InterpreterPoolExecutor in the body of a class, and that name is only there
if _interpreters can be imported: without it none of the tests of thread pools and process pools can be imported either.
This module is there to be imported. It knows of one interpreter, the main one, and cannot make another: the
tests of interpreter pools fail.
Only the scoreboard puts it on the path (score.py), and only for the test modules listed there.
"""

WHENCE_UNKNOWN = 0
WHENCE_RUNTIME = 1
WHENCE_LEGACY_CAPI = 2
WHENCE_CAPI = 3
WHENCE_XI = 4
WHENCE_STDLIB = 5


class InterpreterError(Exception):
    pass


class InterpreterNotFoundError(InterpreterError):
    pass


class NotShareableError(ValueError):
    pass


def create(config="isolated", *, reqrefs=False):
    raise InterpreterError("interpreter creation failed: there are no subinterpreters")


def get_current():
    return 0, WHENCE_RUNTIME


def get_main():
    return 0, WHENCE_RUNTIME


def list_all(*, require_ready=False):
    return [(0, WHENCE_RUNTIME)]


def _check(id):
    if id != 0:
        raise InterpreterNotFoundError(f"unrecognized interpreter ID {id}")


def whence(id):
    _check(id)
    return WHENCE_RUNTIME


def is_running(id, *, restrict=False):
    _check(id)
    return True


def incref(id, *, implieslink=False, restrict=False):
    _check(id)


def decref(id, *, restrict=False):
    _check(id)


def is_shareable(obj):
    return obj is None or type(obj) in (bool, int, float, str, bytes, memoryview) or (type(obj) is tuple and all(map(is_shareable, obj)))


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)

    def missing(*args, **kwargs):
        raise InterpreterError(f"_interpreters.{name}(): there are no subinterpreters")
    return missing
