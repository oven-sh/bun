# For ../stacks.test.ts, which knows the lines.
import traceback

def raiser(message):
    raise ValueError(message)

def call(function, *args):
    return function(*args)

def catch(function):
    try:
        function()
    except BaseException as exception:
        return exception

def format(function):
    try:
        function()
    except BaseException:
        return traceback.format_exc()

def chain(function):
    try:
        function()
    except Exception as exception:
        raise RuntimeError("outer") from exception

def context(function):
    try:
        function()
    except Exception:
        raise KeyError("during")

def group():
    raise ExceptionGroup("several", [ValueError("a"), TypeError("b")])

def frames(exception):
    return [f"{frame.filename.rsplit('/', 1)[-1]}:{frame.lineno} {frame.name}" for frame in traceback.extract_tb(exception.__traceback__)]


def deprecated(**options):
    import warnings
    warnings.warn("old", DeprecationWarning, stacklevel=2, **options)
