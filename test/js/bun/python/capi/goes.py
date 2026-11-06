# What a library raises while it goes does not wait for the next call of something else.
import _ctypes, ctypes, sys

lib = ctypes.PyDLL(sys.argv[1])
lib.when_it_goes(1)
try:
    print(_ctypes.dlclose(lib._handle))
except SystemError as e:
    print(type(e).__name__, e)
    print(repr(e.__cause__), e.__context__ is e.__cause__, e.__suppress_context__)
print(ctypes.CDLL(None).abs(-7), type(ctypes.CDLL(None)).__name__)
# Loaded anew, it goes in silence.
lib = ctypes.PyDLL(sys.argv[1])
print(_ctypes.dlclose(lib._handle))
