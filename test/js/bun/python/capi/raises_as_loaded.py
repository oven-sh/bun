# What a library raises while it is being loaded does not wait for the next call of something else.
import ctypes, sys

try:
    print(ctypes.PyDLL(sys.argv[1]))
except SystemError as e:
    print(type(e).__name__, e)
    print(repr(e.__cause__), e.__context__ is e.__cause__, e.__suppress_context__)
# It is loaded all the same, and is not loaded twice.
lib = ctypes.PyDLL(sys.argv[1])
print(lib.seven(), lib.seven())
print(ctypes.CDLL(sys.argv[1]).seven())
