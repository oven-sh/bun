# A thread ends while it holds the import lock, or the lock of the warnings. Nobody else can let go of it.
# In CPython whoever asks for it next waits for ever, unless it is a thread that happens to get the identifier of the one that ended.
# So all that is said here is that a wait with a time limit ends. It once did not: a thread that waits collects, and that ran the
# callback of a weak reference of importlib, which takes the import lock.
import _imp, _warnings, sys, threading, warnings

def after(acquire, use):
    t = threading.Thread(target=acquire); t.start(); t.join()
    t = threading.Thread(target=use, daemon=True); t.start(); t.join(3)
    print("the wait is over", flush=True)

def imports():
    sys.modules.pop("colorsys", None)
    import colorsys

def warns():
    warnings.warn("x", DeprecationWarning)

after(_imp.acquire_lock, imports)
after(_warnings._acquire_lock, warns)
