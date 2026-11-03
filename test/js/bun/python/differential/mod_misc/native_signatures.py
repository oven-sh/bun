# Functions written in C++ that look at their arguments themselves still show a signature.
import inspect, sys, atexit, _thread, _csv, _json, _pickle, pyexpat, _imp, _posixsubprocess, _lsprof, _queue
def show(name, f):
    try:
        signature = str(inspect.signature(f))
    except (ValueError, TypeError) as e:
        signature = type(e).__name__
    print(name, " ".join(str(getattr(f, "__text_signature__", "-")).split()), signature)  # CPython breaks the long ones into lines.
for name, f in {
    "sorted": sorted, "sys.audit": sys.audit, "atexit.register": atexit.register,
    "_thread.stack_size": _thread.stack_size, "_thread.start_new_thread": _thread.start_new_thread, "_thread.start_new": _thread.start_new,
    "_csv.reader": _csv.reader, "_csv.writer": _csv.writer, "_csv.register_dialect": _csv.register_dialect,
    "_json.scanstring": _json.scanstring,
    "Pickler.dump": _pickle.Pickler.dump, "Unpickler.load": _pickle.Unpickler.load, "Unpickler.find_class": _pickle.Unpickler.find_class,
    "Unpickler.persistent_load": _pickle.Unpickler.persistent_load,
    "Parse": pyexpat.XMLParserType.Parse, "ParseFile": pyexpat.XMLParserType.ParseFile, "UseForeignDTD": pyexpat.XMLParserType.UseForeignDTD,
    "_imp.is_frozen_package": _imp.is_frozen_package, "_imp.get_frozen_object": _imp.get_frozen_object, "_imp.init_frozen": _imp.init_frozen,
    "_imp.exec_dynamic": _imp.exec_dynamic, "fork_exec": _posixsubprocess.fork_exec, "getstats": _lsprof.Profiler.getstats,
    "get_nowait": _queue.SimpleQueue.get_nowait, "object.__init_subclass__": object.__init_subclass__, "object.__subclasshook__": object.__subclasshook__,
}.items():
    show(name, f)
# They take what they took before.
print(sorted([3, 1, 2], reverse=True), sorted("bA", key=str.lower))
for bad in (lambda: sorted(), lambda: sorted([1], None), lambda: sorted(iterable=[1]), lambda: sorted([1], nope=1)):
    try:
        bad()
    except TypeError as e:
        print("TypeError", e)
print(_json.scanstring('"a\\n"', 1), _thread.stack_size(), object.__subclasshook__(int), object.__init_subclass__())
print(inspect.signature(sorted).bind([1], key=len).arguments)
