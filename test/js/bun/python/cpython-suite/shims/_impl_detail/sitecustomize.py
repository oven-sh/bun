"""score.py --impl-detail: the tests marked @cpython_only, or guarded by check_impl_detail(), are run as they are under CPython.

They are skipped here because sys.implementation.name is not "cpython". Many of them look at what only CPython has (reference
counts, sizes of objects, bytecode); many others were marked because nobody knew what another implementation would do, and pass.
No part of Bun, and not what the scoreboard counts: a way to find out which is which.
"""
import sys

if sys.implementation.name != "cpython" and "test" in sys.orig_argv:
    import test.support as _support

    def _check_impl_detail(**guards):
        guards, default = _support._parse_guards(guards)
        return guards.get("cpython", default)

    _support.check_impl_detail = _check_impl_detail
