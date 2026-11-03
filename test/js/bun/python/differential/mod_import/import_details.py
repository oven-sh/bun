# Smaller things about imports: _imp's checks, a submodule that is blocked, repr() of modules, lazy imports and threads.
import _imp
import importlib
import importlib.machinery
import importlib.util
import os
import re
import sys
import tempfile
import threading
import types

tmp = os.path.realpath(tempfile.mkdtemp())
sys.path.insert(0, tmp)
sys.dont_write_bytecode = True


def write(name, text=""):
    path = os.path.join(tmp, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def attempt(function, *args):
    try:
        print(getattr(function, "__name__", "?"), "->", str(function(*args)).replace(tmp, "<tmp>"))
    except BaseException as e:
        print(getattr(function, "__name__", "?"), "!", type(e).__name__, str(e).replace(tmp, "<tmp>"), "|", getattr(e, "name", "-"), str(getattr(e, "path", "-")).replace(tmp, "<tmp>"))


class Spec:
    def __init__(self, name, origin=None):
        self.name = name
        self.origin = origin


for name in (1, None, b"sys", "", "nothing", "a\0b", "os", "a.b", "\xe9", "\xe9\0", "\udc80"):
    attempt(_imp.create_builtin, Spec(name))
attempt(_imp.create_builtin, object())
attempt(_imp.create_builtin)
print(_imp.is_builtin("sys"), _imp.is_builtin("os"), _imp.is_builtin("time"), _imp.is_builtin(""))
attempt(_imp.is_builtin, 1)
attempt(_imp.exec_builtin, sys)
attempt(_imp.exec_builtin, 1)
for spec in (Spec("a\0b", "/x.so"), Spec("a", "/x\0.so"), Spec(1, "/x.so"), Spec("a", 1)):
    attempt(_imp.create_dynamic, spec)
attempt(_imp.create_dynamic)
print(_imp.extension_suffixes() == importlib.machinery.EXTENSION_SUFFIXES, _imp.lock_held(), type(_imp.source_hash(1, b"abc")).__name__, len(_imp.source_hash(1, b"abc")), _imp.check_hash_based_pycs)

# A submodule that None in sys.modules blocks.
write("pkg/__init__.py")
write("pkg/sub.py", "value = 1")
write("pkg/other.py", "value = 2")
sys.modules["pkg.sub"] = None


def blocked():
    from pkg import sub
    return sub


def blocked_star():
    import pkg
    pkg.__all__ = ["sub"]
    namespace = {}
    exec("from pkg import *", namespace)
    return sorted(k for k in namespace if not k.startswith("__"))


def not_blocked():
    from pkg import other, nothing
    return other


attempt(blocked)
attempt(blocked_star)
attempt(not_blocked)
attempt(importlib.import_module, "pkg.sub")
attempt(__import__, "pkg", {}, {}, ["sub"])
attempt(__import__, "pkg", {}, {}, ["missing"])
attempt(__import__, "pkg", {}, {}, [1])
attempt(__import__, "pkg", {}, {}, ["*"])
del sys.modules["pkg.sub"]
attempt(blocked)

# repr()
os.makedirs(os.path.join(tmp, "space", "inner"))
import space
import space.inner
import pkg.other
for module in (space, space.inner, pkg, pkg.other, sys, types.ModuleType("made"), importlib.util.module_from_spec(importlib.machinery.ModuleSpec("specified", None, origin="somewhere"))):
    print(repr(module).replace(tmp, "<tmp>"), re.sub(" at 0x[0-9a-f]+", "", str(module.__spec__)).replace(tmp, "<tmp>"))
made = types.ModuleType("made")
made.__file__ = "/f.py"
print(repr(made))
made.__loader__ = importlib.machinery.BuiltinImporter
print(repr(made))
del made.__file__
print(repr(made))
made.__name__ = 5
print(repr(made))
del made.__name__
print(repr(made))


class Sub(types.ModuleType):
    pass


print(repr(Sub("s")), str(Sub("s")))

# Lazy imports that several threads want at once.
write("slow_one.py", "import threading, time\nstarted.set()\nrelease.wait(10)\ncount = globals().get('count', 0) + 1\nvalue = 'loaded'\n".replace("started", "__import__('builtins')._started").replace("release", "__import__('builtins')._release"))
import builtins
builtins._started = threading.Event()
builtins._release = threading.Event()
write("uses_lazy.py", "lazy import slow_one\ndef get():\n    return slow_one.value\n")
import uses_lazy
print("slow_one" in sys.modules, "slow_one" in sys.lazy_modules if hasattr(sys, "lazy_modules") else None)
results = []
errors = []


def worker():
    try:
        results.append(uses_lazy.get())
    except BaseException as e:
        errors.append(type(e).__name__ + ": " + str(e))


threads = [threading.Thread(target=worker) for _ in range(6)]
threads[0].start()
builtins._started.wait(10)
for thread in threads[1:]:
    thread.start()
builtins._release.set()
for thread in threads:
    thread.join()
print(results, errors, sys.modules["slow_one"].count)

# A lazy import that needs itself is an error in the thread that is resolving it, and only there.
write("selfish.py", "lazy import selfish_helper\nvalue = selfish_helper.value\n")
write("selfish_helper.py", "import selfish_user\nvalue = 1\n")
write("selfish_user.py", "import selfish\n")
attempt(importlib.import_module, "selfish")

# The flag that says a module is being initialized is looked at without running anything of the program's.
class Truth:
    def __bool__(self):
        print("asked")
        return True


write("flagged.py", "value = 3\n")
import flagged
flagged.__spec__._initializing = Truth()
write("uses_flagged.py", "lazy import flagged\ndef get():\n    return flagged.value\n")
import uses_flagged
print(uses_flagged.get())

import shutil
shutil.rmtree(tmp)
