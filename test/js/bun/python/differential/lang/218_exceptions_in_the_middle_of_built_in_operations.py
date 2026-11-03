# An exception raised half way through an operation written in C ends the operation there: nothing of the program's runs after it.
import types


class Spec:
    @property
    def _initializing(self):
        print("_initializing asked for")
        raise RuntimeError("no answer")


def annotate(format):
    print("annotate called")
    return {}


module = types.ModuleType("m")
module.__spec__ = Spec()
module.__annotate__ = annotate
try:
    print(module.__annotations__)
except RuntimeError as e:
    print("RuntimeError:", e)
print("__annotations__" in vars(module))
