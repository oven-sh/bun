"""Not CPython's _testlimitedcapi, which is written in C and calls the functions of the limited C API.

test_bytes.py imports it in the body of a class, so without it none of its tests can be imported. A few functions of the C API do
what a program can do as well: those are here, written in Python, as the documentation of the C API describes them. Anything
else skips the test that asks for it.
Only the scoreboard puts it on the path (score.py), and only for the test modules listed there.
"""
import operator
import sys
import unittest


def _position(sequence, index):
    # PySequence_GetItem and the like: the length is added to a negative index, once, and what the type is then asked
    # for (sq_item) has no negative indices.
    index = operator.index(index)
    if index < 0:
        index += len(sequence)
        if index < 0:
            raise IndexError("index out of range")
    return index


def sequence_getitem(sequence, index):
    return sequence[_position(sequence, index)]


def sequence_setitem(sequence, index, value):
    sequence[_position(sequence, index)] = value
    return 0


def sequence_delitem(sequence, index):
    del sequence[_position(sequence, index)]
    return 0


def object_hasattrstring(obj, name):
    try:
        getattr(obj, name.decode())
    except AttributeError:
        return 0
    return 1


def _py_getbuiltwithassert():
    # test.support.built_with_c_assertions(): what it says when this module is missing.
    return hasattr(sys, "gettotalrefcount")


def __getattr__(name):
    if name.startswith("__") and name.endswith("__"):
        raise AttributeError(name)
    raise unittest.SkipTest("needs the C API: %s.%s" % (__name__, name))
