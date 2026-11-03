"""Not CPython's _testcapi, which is written in C and calls the functions of the C API.

test.support.requires_debug_ranges() asks it whether code objects have column numbers, and skips the test if it cannot be
imported: that is how the tests of the carets in tracebacks are guarded, which have nothing to do with the C API. What is here
is what a program can find out or do as well. Anything else skips the test that asks for it.
Only the scoreboard puts it on the path (score.py), and only for the test modules listed there: test.support and many tests do
something else, and sensible, when the module is missing.
"""
import sys
import unittest


def config_get(name):
    """PyConfig_Get()"""
    if name == "code_debug_ranges":
        return int("no_debug_ranges" not in sys._xoptions)
    raise unittest.SkipTest("needs the C API: PyConfig_Get(%r)" % (name,))


def exception_print(exception, legacy=False):
    """PyErr_DisplayException(), which is what the sys.excepthook the interpreter starts with calls."""
    if legacy:
        raise unittest.SkipTest("needs the C API: PyErr_Display()")
    sys.__excepthook__(type(exception), exception, exception.__traceback__)


def __getattr__(name):
    if name.startswith("__") and name.endswith("__"):
        raise AttributeError(name)
    raise unittest.SkipTest("needs the C API: %s.%s" % (__name__, name))
