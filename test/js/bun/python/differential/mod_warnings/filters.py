# The module _warnings: filters, registries, actions, stack levels.
import sys, warnings, _warnings, re
sys.stderr = sys.stdout

print(_warnings.filters is warnings.filters, _warnings._defaultaction, _warnings._onceregistry)
for f in warnings.filters:
    print(f)
print(warnings.warn is _warnings.warn, warnings.warn_explicit is _warnings.warn_explicit)
print(sorted(n for n in dir(_warnings) if not n.startswith("__")))

def shown(message, category, filename, lineno, file=None, line=None):
    print("SHOWN", category.__name__, message, filename.rsplit("/", 1)[-1], lineno, line)
warnings.showwarning = shown

# default: once for each place.
for i in range(3):
    warnings.warn("in a loop")
warnings.warn("in a loop")
print(sorted((k for k in __warningregistry__ if k != "version"), key=repr))

# Categories.
warnings.warn("deprecated", DeprecationWarning)           # shown: this is __main__
warnings.warn("pending", PendingDeprecationWarning)       # ignored
warnings.warn("import", ImportWarning)
warnings.warn("resource", ResourceWarning)
warnings.warn(RuntimeWarning("an instance"))
warnings.warn(RuntimeWarning("an instance wins"), UserWarning)
warnings.warn("none", None)
warnings.warn(42)
warnings.warn(None)
class Mine(UserWarning): pass
warnings.warn("mine", Mine)
warnings.warn(Mine("a", "b"))

for bad in (int, 3, "x", Exception, (UserWarning,)):
    try:
        warnings.warn("bad", bad)
    except TypeError as e:
        print("TypeError", e)

# Actions.
def each(action, **kw):
    print("--", action, kw)
    with warnings.catch_warnings():
        warnings.resetwarnings()
        warnings.filterwarnings(action, **kw)
        for i in range(2):
            try:
                warnings.warn("text one")
                warnings.warn("text one")
                warnings.warn("text two", RuntimeWarning)
            except Warning as e:
                print("raised", type(e).__name__, e)
for action in ("error", "ignore", "always", "all", "default", "module", "once"):
    each(action)
each("error", category=RuntimeWarning)
each("error", message="text t")
each("error", message="TEXT ONE")
each("error", message="ext")
each("error", module="__main__")
each("error", module="__mai")
each("error", module="other")
each("ignore", lineno=1)
try:
    each("nonsense")
except ValueError as e:
    print("ValueError", e)

# A filter with an action nobody knows, put there by hand.
with warnings.catch_warnings():
    warnings.filters.insert(0, ("nonsense", None, Warning, None, 0))
    _warnings._acquire_lock(); _warnings._filters_mutated_lock_held(); _warnings._release_lock()
    try:
        warnings.warn("x")
    except RuntimeError as e:
        print("RuntimeError", e)
with warnings.catch_warnings():
    warnings.filters.insert(0, ("ignore", None))
    try:
        warnings.warn("y")
    except ValueError as e:
        print("ValueError", e)

# Stack levels.
def inner(level):
    warnings.warn("level %d" % level, stacklevel=level)
def outer(level):
    inner(level)
with warnings.catch_warnings():
    warnings.simplefilter("always")
    for level in (-1, 0, 1, 2, 3, 4, 100):
        outer(level)
    try:
        warnings.warn("big", stacklevel=2**70)
    except OverflowError as e:
        print("OverflowError", e)
    try:
        warnings.warn("text", stacklevel="1")
    except TypeError as e:
        print("TypeError", e)

# skip_file_prefixes.
with warnings.catch_warnings():
    warnings.simplefilter("always")
    warnings.warn("skipping nothing", skip_file_prefixes=())
    warnings.warn("skipping elsewhere", skip_file_prefixes=("/nowhere",))
    import os
    def helper():
        warnings.warn("skipping this file", skip_file_prefixes=(os.path.dirname(os.path.abspath(__file__)),))
    helper()
    for bad in (["/x"], "x", (1,), None):
        try:
            warnings.warn("bad prefixes", skip_file_prefixes=bad)
        except TypeError as e:
            print("TypeError", e)

# warn_explicit.
with warnings.catch_warnings():
    warnings.simplefilter("default")
    registry = {}
    warnings.warn_explicit("explicit", UserWarning, "file.py", 10, registry=registry)
    warnings.warn_explicit("explicit", UserWarning, "file.py", 10, registry=registry)
    warnings.warn_explicit("explicit", UserWarning, "file.py", 11, registry=registry)
    print(sorted((k for k in registry if k != "version"), key=repr), "version" in registry)
    warnings.warn_explicit("no registry", UserWarning, "file.py", 10)
    warnings.warn_explicit("no registry", UserWarning, "file.py", 10)
    warnings.warn_explicit(UserWarning("instance"), None, "file.py", 12)
    warnings.warn_explicit("with module", UserWarning, "dir/file.py", 13, module="m")
    warnings.warn_explicit("globals", UserWarning, "file.py", 1, module_globals={"__name__": "x"})
    for args in (("m", UserWarning, "f", "x"), ("m", UserWarning, 3, 1), ("m", 3, "f", 1), ("m", UserWarning, "f", 1, None, 3),
                 ("m", UserWarning, "f", 1, None, None, 3)):
        try:
            warnings.warn_explicit(*args)
        except TypeError as e:
            print("TypeError", e)

# once, over several places.
with warnings.catch_warnings():
    warnings.resetwarnings()
    warnings.simplefilter("once")
    warnings.warn("only once")
    warnings.warn("only once")
    def elsewhere():
        warnings.warn("only once")
    elsewhere()
    print(sorted(_warnings._onceregistry, key=repr))

# module: once for each module, whatever the line.
with warnings.catch_warnings():
    warnings.resetwarnings()
    warnings.simplefilter("module")
    warnings.warn("for the module")
    warnings.warn("for the module")

# A change of filters makes the registries forget.
with warnings.catch_warnings():
    warnings.resetwarnings()
    warnings.simplefilter("default")
    def again():
        warnings.warn("forgotten")
    again(); again()
    warnings.simplefilter("default")
    again(); again()

# record=True.
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    warnings.warn("recorded", FutureWarning)
    warnings.warn("with source", ResourceWarning, source=caught)
    for w in caught:
        print(type(w).__name__, w.category.__name__, w.message, w.lineno, w.filename.rsplit("/", 1)[-1], w.line, w.source is caught)

# The default action.
with warnings.catch_warnings():
    warnings.resetwarnings()
    saved = warnings.defaultaction
    warnings.defaultaction = "ignore"
    warnings.warn("ignored by default")
    warnings.defaultaction = "error"
    try:
        warnings.warn("an error by default")
    except UserWarning as e:
        print("raised", e)
    warnings.defaultaction = saved

# The lock.
try:
    _warnings._release_lock()
except RuntimeError as e:
    print("RuntimeError", e)
try:
    _warnings._filters_mutated_lock_held()
    print("no error")
except RuntimeError as e:
    print("RuntimeError", e)
