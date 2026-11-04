# An object of the program whose finalizer calls into a library, which calls back: the callback belongs to another module, and
# nothing connects the two but an address that the library has. At exit both go, and the callback is still there.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import callbacks_at_exit_helper as helper


class Handle:
    def __init__(self, name):
        self.name = name
        self.sort = helper.sort   # The module's globals are emptied at exit.

    def __del__(self):
        print(self.name, self.sort([3, 1, 4, 1, 5, 9, 2, 6]), flush=True)


print(helper.sort([1, 2, 3]))
in_a_global = Handle("a global of the program")
in_a_cycle = Handle("in a cycle")
in_a_cycle.me = in_a_cycle
del in_a_cycle
sys.stderr = sys.stdout   # Whatever is said about callbacks is part of what is compared.
print("the end")
