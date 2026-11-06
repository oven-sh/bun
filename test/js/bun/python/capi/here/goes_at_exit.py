# The process ends, and exit() runs the destructor of a library, which raises. Nobody is there to look at it, and no code of the runtime's is further out on the stack.
# (CPython has finalized by then, and crashes.)
import ctypes, sys

lib = ctypes.PyDLL(sys.argv[1])
lib.when_it_goes(1)
print("loaded")
