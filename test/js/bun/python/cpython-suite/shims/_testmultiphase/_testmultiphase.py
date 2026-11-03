"""Not CPython's _testmultiphase, which is an extension module written in C to test the loading of extension modules.

Lib/test/test_importlib/util.py imports it before anything else, so without it nothing that uses those helpers can even be imported:
all of test_importlib, test_import, test_runpy and more, nearly all of which have nothing to do with extension modules.

This lets that one import succeed and no other. It puts None in its own place in sys.modules: the import that is under way hands
that out, which util.py does not look at, and to every later `import _testmultiphase` None there means that there is no such
module. So the tests that need the real thing find it missing, and skip themselves as they would without this file.

Only the scoreboard puts it on the path (score.py), and only for the test modules listed there.
"""
import sys

sys.modules[__name__] = None
