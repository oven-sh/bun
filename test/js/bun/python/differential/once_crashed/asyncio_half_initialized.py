# The types of _asyncio, taken by a stand-in for asyncio while _asyncio is being initialized, and used after that has failed.
import sys, importlib, importlib.machinery
taken = {}
class Loader:
    def create_module(self, spec): return None
    def exec_module(self, module):
        import _asyncio
        taken.update(vars(_asyncio))
        raise ImportError("no asyncio")
class Finder:
    def find_spec(self, name, path=None, target=None):
        return importlib.machinery.ModuleSpec(name, Loader()) if name == "asyncio" else None
sys.meta_path.insert(0, Finder())
try:
    import _asyncio
except ImportError as e:
    print("ImportError")
del sys.meta_path[0]
for name in ("Future", "Task", "get_event_loop", "all_tasks"):
    try:
        taken[name]()
    except Exception as e:
        print(name, "raised")
try:
    taken["_register_task"](1)
except Exception as e:
    print("_register_task raised")
