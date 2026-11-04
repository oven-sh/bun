# A file that is dropped unclosed is closed by its finalizer, which warns about it. With reference counts that happens where the file
# is dropped. A collector comes when it comes, and the code that runs by then has nothing to do with the file: the warning is not
# laid at its door, and nothing appears in its namespace (__warningregistry__), which it may be going through at that moment, as
# enum._convert_() goes through that of socket.
import warnings

def drop(count):
    for i in range(count):
        open(__file__)

source = """
def go_through_own_namespace(rounds):
    seen = 0
    for i in range(rounds):
        for name, value in globals().items():
            seen += len([name, value, [i]]) - 3
    return seen
"""

def bystander():
    namespace = {"__name__": "bystander"}
    exec(source, namespace)
    return namespace

# Ignored, as by default.
namespace = bystander()
drop(50)
print(namespace["go_through_own_namespace"](100000), sorted(namespace.keys() - {"__builtins__"}))

# Shown.
shown = []
warnings.simplefilter("always")
warnings.showwarning = lambda message, category, filename, lineno, file=None, line=None: shown.append((category.__name__, filename == "bystander" or "<string>" in filename))
namespace = bystander()
drop(50)
print(namespace["go_through_own_namespace"](100000), sorted(namespace.keys() - {"__builtins__"}))
import gc
gc.collect()
print(len(shown), set(shown))
