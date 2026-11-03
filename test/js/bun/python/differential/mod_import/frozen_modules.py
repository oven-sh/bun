# Frozen modules: what importlib and _imp say about them.
import _imp
import importlib
import importlib.machinery
import importlib.util
import io
import contextlib
import os
import sys
import zipimport

library = sys._stdlib_dir


def shown(path):
    if isinstance(path, list):
        return [shown(item) for item in path]
    return path.replace(library, "<lib>") if isinstance(path, str) else path


def describe(module):
    spec = module.__spec__
    state = spec.loader_state
    print(module.__name__, spec.name, spec.origin, spec.loader.__name__, spec.has_location, spec.cached, spec.parent,
          shown(spec.submodule_search_locations and list(spec.submodule_search_locations)),
          state and state.origname, shown(getattr(module, "__file__", None)), hasattr(module, "__cached__"), module.__loader__.__name__)


for module in (os, os.path, io, sys.modules["abc"], sys.modules["site"], sys.modules["stat"], sys.modules["_collections_abc"], sys.modules["genericpath"],
               zipimport, importlib.util, importlib.machinery, importlib._bootstrap, importlib._bootstrap_external):
    describe(module)
print(importlib.__spec__.origin == importlib.__file__, type(importlib.__spec__.loader).__name__)
print(os.makedirs.__code__.co_filename, importlib.util.find_spec.__code__.co_filename, importlib._bootstrap._find_and_load.__code__.co_filename,
      importlib._bootstrap_external.PathFinder.find_spec.__func__.__code__.co_filename, zipimport.zipimporter.find_spec.__code__.co_filename)
print(repr(os).replace(library, "<lib>"), repr(importlib._bootstrap).replace(library, "<lib>"), repr(sys), repr(zipimport).replace(library, "<lib>"))

# What a host has frozen for itself is its own business.
names = [name for name in _imp._frozen_module_names() if not name.startswith("_bun_")]
print(names)
for name in names:
    data, is_package, original = _imp.find_frozen(name)
    print(name, data, is_package, original, _imp.is_frozen(name), _imp.is_frozen_package(name), type(_imp.get_frozen_object(name)).__name__,
          _imp.get_frozen_object(name).co_filename, _imp.get_frozen_object(name).co_name)

data, is_package, original = _imp.find_frozen("__hello__", withdata=True)
print(type(data).__name__, data.readonly, len(data) > 0, is_package, original)
code = _imp.get_frozen_object("anything", data)
print(code.co_filename, code.co_names)
print(_imp.get_frozen_object("__hello__", bytes(data)).co_filename)


def attempt(function, *args, **kwargs):
    try:
        print(function.__name__, args, "->", function(*args, **kwargs))
    except BaseException as e:
        print(function.__name__, args, "!", type(e).__name__, e, getattr(e, "name", "-"))


for name in ("nothing", "", "os.path", "OS", "a\0b", "\udc80"):
    for function in (_imp.find_frozen, _imp.is_frozen, _imp.is_frozen_package, _imp.get_frozen_object):
        attempt(function, name)
for bad in (None, 1, b"os"):
    for function in (_imp.find_frozen, _imp.is_frozen, _imp.is_frozen_package, _imp.get_frozen_object):
        attempt(function, bad)
attempt(_imp.get_frozen_object, "x", b"")
attempt(_imp.get_frozen_object, "x", b"6'\xd5Cu\x12")
attempt(_imp.get_frozen_object, "x", b"N")
attempt(_imp.get_frozen_object, "x", "text")
attempt(_imp.get_frozen_object, "x", 1)
attempt(_imp.find_frozen, "os", True)
attempt(_imp.find_frozen)

# The ones for tests.
for name in ("__hello__", "__hello_alias__", "__phello_alias__", "__phello_alias__.spam", "__phello__", "__phello__.spam", "__phello__.ham", "__phello__.ham.eggs", "__hello_only__"):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        module = importlib.import_module(name)
    print(name, repr(output.getvalue()), getattr(module, "initialized", None))
    describe(module)
    print(repr(module).replace(library, "<lib>"), shown(getattr(module, "__path__", None)))

# _imp.init_frozen() runs one without importlib.
for name in ("__hello__", "__phello__", "__phello__.spam", "__hello_only__", "__hello_alias__"):
    sys.modules.pop(name, None)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        module = _imp.init_frozen(name)
    print(name, repr(output.getvalue()), module is sys.modules[name], module.__name__, module.__spec__, module.__loader__, module.__origname__,
          getattr(module, "__path__", None), "__builtins__" in vars(module), hasattr(module, "__file__"), repr(module))
    del sys.modules[name]
attempt(_imp.init_frozen, "nothing")
attempt(_imp.init_frozen, "")
attempt(_imp.init_frozen, 1)
attempt(_imp.init_frozen)
existing = sys.modules["__hello__"] = type(sys)("__hello__")
existing.kept = True
with contextlib.redirect_stdout(io.StringIO()):
    again = _imp.init_frozen("__hello__")
print(again is existing, again.kept, again.initialized)
del sys.modules["__hello__"]

# Switched off, all but those the import system is made of come from their files.
_imp._override_frozen_modules_for_tests(-1)
print(_imp._frozen_module_names()[:3] == names[:3], [n for n in _imp._frozen_module_names() if not n.startswith("_bun_")])
for name in ("os", "__hello__", "zipimport", "_frozen_importlib", "__hello_only__"):
    print(name, _imp.find_frozen(name), _imp.is_frozen(name))
    spec = importlib.util.find_spec(name) if name not in sys.modules else importlib.machinery.PathFinder.find_spec(name)
    print("   ", spec and (spec.name, shown(spec.origin), type(spec.loader).__name__))
attempt(_imp.get_frozen_object, "os")
attempt(_imp.is_frozen_package, "os")
del sys.modules["__hello__"]
with contextlib.redirect_stdout(io.StringIO()):
    import __hello__
describe(__hello__) if __hello__.__spec__.loader_state else print(__hello__.__spec__.name, shown(__hello__.__spec__.origin), type(__hello__.__spec__.loader).__name__, __hello__.main.__code__.co_filename.replace(library, "<lib>"))
_imp._override_frozen_modules_for_tests(1)
print(_imp.is_frozen("os"))
_imp._override_frozen_modules_for_tests(0)
print(_imp.is_frozen("os"))
attempt(_imp._override_frozen_modules_for_tests, "x")

# A traceback through a frozen module.
import traceback
try:
    os.makedirs("/proc/nothing/here")
except OSError as e:
    for frame in traceback.extract_tb(e.__traceback__):
        print(frame.filename if frame.filename.startswith("<") else "file", frame.name, bool(frame.line))
