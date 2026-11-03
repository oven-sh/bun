"""Not CPython's _interpqueues: see _interpreters.py beside it. No queue can be made."""


class QueueError(Exception):
    pass


class QueueNotFoundError(QueueError):
    pass


def _register_heap_types(queuetype, emptyerror, fullerror):
    pass


def list_all():
    return []


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)

    def missing(*args, **kwargs):
        raise QueueError(f"_interpqueues.{name}(): there are no subinterpreters")
    return missing
