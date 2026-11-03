"""Not CPython's _testinternalcapi, which is written in C and shows tests the inside of CPython.

test_class.py and test_with.py import a name from it at the top, for a few tests each, and so cannot be imported without it. Those
names are here, and skip the test that uses them; so does anything else that is asked of this module.
Only the scoreboard puts it on the path (score.py), and only for the test modules listed there: test.support and many tests do
something else, and sensible, when the module is missing.
"""
import sys
import unittest


def _skip(name):
    raise unittest.SkipTest("needs the C API: %s.%s" % (__name__, name))


def has_inline_values(obj):
    """How CPython lays out the attributes of an instance."""
    _skip("has_inline_values")


class SelfInterruptingContextManager:
    """Its __enter__ is written in C and leaves an exception for the interpreter to find when it is back in the bytecode."""

    def __init__(self):
        _skip("SelfInterruptingContextManager")


# test.support has ways of its own to find these things out when the module is missing. They are to go on being used.

def get_recursion_depth():
    depth = 0
    frame = sys._getframe(1)
    while frame is not None:
        depth += 1
        frame = frame.f_back
    return depth


def identify_type_slot_wrappers():
    raise NotImplementedError


def __getattr__(name):
    if name.startswith("__") and name.endswith("__") or name == "get_c_recursion_remaining":
        raise AttributeError(name)
    _skip(name)
