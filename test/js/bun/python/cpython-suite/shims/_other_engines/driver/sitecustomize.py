"""For an implementation on which CPython's own test driver (test.libregrtest) does not start: what the driver asks for and the
implementation lacks is filled in with something that does nothing. Children started with -I or -E do not see this."""
import faulthandler
import gc
import sys
if not hasattr(faulthandler, "register"):
    faulthandler.register = lambda *args, **kwargs: None
if not hasattr(faulthandler, "unregister"):
    faulthandler.unregister = lambda *args, **kwargs: False
if not hasattr(gc, "garbage"):
    gc.garbage = []
# The driver makes every entry of every module's __path__ absolute, by item assignment. GraalPy's module polyglot has a string there.
try:
    import polyglot
except ImportError:
    pass
for module in list(sys.modules.values()):
    if isinstance(getattr(module, "__path__", None), str):
        module.__path__ = [module.__path__]
