# The import system with what it relies on replaced, deleted or of the wrong type: sys.modules, sys.meta_path, sys.path_hooks, __import__,
# __builtins__, __spec__, __loader__, __path__, modules that change under it. Each case must end in a result or an exception, never in a crash.
import sys, types, gc, builtins, importlib, importlib.util, importlib.machinery, _imp, threading, os, tempfile, marshal, io

GROUP = sys.argv[1] if len(sys.argv) > 1 else None
def outcome(f):
    try:
        r = f()
        return "ok " + repr(r)[:80]
    except (RecursionError, MemoryError) as e:
        return type(e).__name__
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:80]
CASES = []
def case(name):
    def register(f):
        CASES.append((name, f))
        return f
    return register

JUNK = [None, 0, 1, -1, 1.5, "", "x", b"x", (), [], {}, set(), object(), type, len, lambda *a, **k: None, NotImplemented, Ellipsis, types.ModuleType("m"), types.SimpleNamespace(), sys, 2 ** 70, "a.b", ".", "..", "\0", "\ud800", "é" * 300]
class Raises:
    def __getattr__(self, name): raise KeyError(name)
    def __getitem__(self, key): raise ZeroDivisionError
    def __iter__(self): raise OverflowError
    def __len__(self): raise IndexError
    def __bool__(self): raise ValueError
    def __eq__(self, other): raise TypeError
    def __hash__(self): raise MemoryError
    def __repr__(self): raise SystemError
    def __call__(self, *a, **k): raise LookupError
JUNK.append(Raises())

def imports():
    "Statements that import, each in a fresh namespace."
    for src in ("import colorsys", "import json.tool", "from json import tool", "from os import path", "from colorsys import *", "import xml.dom.minidom as m", "from . import x", "from .. import y", "from .a import b", "import _struct", "import _frozen_importlib",
                "import zipimport", "import nosuchmodule", "from sys import nosuchname", "from json import nosuchname", "import sys.x", "__import__('colorsys')", "__import__('json.tool', fromlist=['x'])", "__import__('', level=1)",
                "importlib.import_module('colorsys')", "importlib.import_module('.a', 'json')", "importlib.reload(colorsys_)", "lazy import colorsys\ncolorsys.ONE_THIRD", "lazy from json import tool\ntool"):
        yield src
def run_imports(ns=None):
    rs = []
    for src in imports():
        for name in ("colorsys", "json.tool", "xml.dom.minidom", "xml.dom", "xml"):
            try: sys.modules.pop(name, None)
            except BaseException: pass
        g = {"importlib": importlib, "colorsys_": COLORSYS, "__name__": "pkg.mod", "__package__": "pkg"}
        if ns: g.update(ns)
        rs.append(outcome(lambda: exec(src, g))[:18])
    return len(rs)
import colorsys as COLORSYS

for attribute in ("modules", "meta_path", "path", "path_hooks", "path_importer_cache", "builtin_module_names", "stdlib_module_names", "flags", "implementation", "dont_write_bytecode", "pycache_prefix", "platlibdir", "warnoptions", "lazy_modules"):
    @case("sys." + attribute + " replaced")
    def _(attribute=attribute):
        n = 0; saved = getattr(sys, attribute, None)
        for junk in JUNK:
            setattr(sys, attribute, junk)
            try: n += run_imports()
            finally: setattr(sys, attribute, saved)
        return n
    @case("sys." + attribute + " deleted")
    def _(attribute=attribute):
        saved = getattr(sys, attribute, None)
        if hasattr(sys, attribute): delattr(sys, attribute)
        try: return run_imports()
        finally: setattr(sys, attribute, saved)

@case("junk in sys.modules")
def _():
    n = 0
    for junk in JUNK:
        for name in ("colorsys", "json", "json.tool", "os", "xml", "xml.dom", "pkg", "pkg.a", "importlib", "importlib._bootstrap", "_frozen_importlib", "warnings", "sys", "builtins", "_imp", "encodings", "codecs", "io", "abc", "types"):
            saved = sys.modules.get(name)
            sys.modules[name] = junk
            try:
                for src in ("import " + name, "from " + name + " import x", "from " + name + " import *", "import " + name + ".sub", "importlib.import_module(%r)" % name, "importlib.reload(sys.modules[%r])" % name, "importlib.util.find_spec(%r)" % name, "importlib.util.find_spec(%r)" % (name + ".sub")):
                    outcome(lambda: exec(src, {"importlib": importlib, "sys": sys})); n += 1
            finally:
                if saved is None: sys.modules.pop(name, None)
                else: sys.modules[name] = saved
    return n

@case("junk keys in sys.modules")
def _():
    n = 0
    for junk in JUNK:
        try: sys.modules[junk] = junk
        except BaseException: continue
        try: n += run_imports()
        finally:
            try: del sys.modules[junk]
            except BaseException: sys.modules.clear() if False else None
    return n

@case("sys.modules is a dict subclass, a mapping, a dict that changes")
def _():
    saved = sys.modules; n = 0
    class D(dict):
        def __getitem__(self, k): raise KeyError(k)
        def get(self, k, d=None): return 42
        def __contains__(self, k): return True
        def __setitem__(self, k, v): dict.clear(self)
        def pop(self, *a): raise ZeroDivisionError
    class E(dict):
        def __missing__(self, k): return types.ModuleType(k)
    import collections
    for m in (D(saved), E(saved), collections.ChainMap(dict(saved)), collections.OrderedDict(saved), types.MappingProxyType(dict(saved)), collections.UserDict(saved), collections.defaultdict(lambda: 1, saved)):
        sys.modules = m
        try: n += run_imports()
        finally: sys.modules = saved
    return n

for name in ("__import__", "__build_class__", "__name__", "getattr", "hasattr", "isinstance", "len", "ImportError", "ModuleNotFoundError", "AttributeError", "KeyError", "open", "print", "type", "object", "str", "__lazy_import__"):
    @case("builtins." + name + " replaced or deleted")
    def _(name=name):
        if not hasattr(builtins, name): return "absent"
        saved = getattr(builtins, name); n = 0
        for junk in JUNK[:18] + [JUNK[-1]]:
            setattr(builtins, name, junk)
            try: n += run_imports()
            finally: setattr(builtins, name, saved)
        delattr(builtins, name)
        try: n += run_imports()
        finally: setattr(builtins, name, saved)
        return n

@case("__builtins__ of the importing namespace")
def _():
    n = 0
    for junk in JUNK + [{"__import__": j} for j in JUNK] + [types.SimpleNamespace(__import__=j) for j in JUNK[:6]]:
        n += run_imports({"__builtins__": junk})
    return n

@case("__name__, __package__, __spec__, __path__, __loader__ of the importing namespace")
def _():
    n = 0
    for key in ("__name__", "__package__", "__spec__", "__path__", "__loader__", "__file__", "__cached__"):
        for junk in JUNK: n += run_imports({key: junk})
    for junk in JUNK: n += run_imports({"__spec__": types.SimpleNamespace(parent=junk), "__package__": None})
    return n

@case("attributes of a module in sys.modules")
def _():
    n = 0
    for key in ("__spec__", "__path__", "__loader__", "__name__", "__package__", "__all__", "__dict__", "__file__", "__getattr__", "__dir__", "__class__"):
        for junk in JUNK:
            m = types.ModuleType("evilmod"); sys.modules["evilmod"] = m
            if outcome(lambda: setattr(m, key, junk)).startswith("ok"):
                for src in ("import evilmod", "import evilmod.sub", "from evilmod import sub", "from evilmod import *", "importlib.reload(evilmod_)", "repr(evilmod_)", "dir(evilmod_)", "evilmod_.nosuch", "importlib.util.find_spec('evilmod')", "importlib.util.find_spec('evilmod.sub')", "del evilmod_.__name__\nevilmod_.nosuch", "evilmod_.__dict__.clear()\nrepr(evilmod_), evilmod_.x"):
                    outcome(lambda: exec(src, {"importlib": importlib, "evilmod_": m})); n += 1
            sys.modules.pop("evilmod", None)
    return n

@case("__spec__ with odd attributes")
def _():
    n = 0
    for key in ("name", "loader", "origin", "submodule_search_locations", "_initializing", "_uninitialized_submodules", "parent", "cached", "has_location", "loader_state", "_set_fileattr"):
        for junk in JUNK:
            m = types.ModuleType("evilmod"); spec = importlib.machinery.ModuleSpec("evilmod", None)
            if not outcome(lambda: setattr(spec, key, junk)).startswith("ok"): continue
            m.__spec__ = spec; sys.modules["evilmod"] = m
            for src in ("import evilmod", "import evilmod.sub", "from evilmod import sub", "evilmod_.nosuch", "repr(evilmod_)", "importlib.reload(evilmod_)", "importlib.util.module_from_spec(evilmod_.__spec__)", "importlib._bootstrap._load(evilmod_.__spec__)", "repr(evilmod_.__spec__)", "evilmod_.__spec__ == evilmod_.__spec__"):
                outcome(lambda: exec(src, {"importlib": importlib, "evilmod_": m})); n += 1
            sys.modules.pop("evilmod", None)
    return n

class Finder:
    def __init__(self, action): self.action = action
    def find_spec(self, name, path=None, target=None): return self.action(name)

@case("finders that return junk")
def _():
    n = 0
    for junk in JUNK:
        sys.meta_path.insert(0, Finder(lambda name: junk))
        try: n += run_imports()
        finally: del sys.meta_path[0]
    return n

@case("loaders that misbehave")
def _():
    rs = []
    def spec_with(loader): return lambda name: importlib.machinery.ModuleSpec(name, loader) if name.startswith("evil") else None
    class L:
        def __init__(self, create, execute): self.create_module, self.exec_module = create, execute
    creates = [lambda spec: None, lambda spec: 1, lambda spec: sys, lambda spec: types.ModuleType("other"), lambda spec: 1 / 0, lambda spec: sys.modules.clear() if False else sys.modules.pop(spec.name, None), lambda spec: object(), lambda spec: type("M", (types.ModuleType,), {"__getattribute__": lambda s, n: 1 / 0})("m"), lambda spec: type("S", (), {"__slots__": ()})()]
    executes = [lambda m: None, lambda m: 1 / 0, lambda m: sys.modules.pop("evilmod", None), lambda m: sys.modules.__setitem__("evilmod", None), lambda m: sys.modules.__setitem__("evilmod", 5), lambda m: m.__dict__.clear(), lambda m: exec("import evilmod", {}), lambda m: importlib.reload(m),
                lambda m: setattr(m, "__spec__", None), lambda m: delattr(m, "__spec__"), lambda m: setattr(m, "__class__", type("M", (types.ModuleType,), {})), lambda m: gc.collect(), lambda m: sys.meta_path.clear() if False else None, lambda m: sys.exit(3)]
    for c in creates:
        for e in executes:
            sys.meta_path.insert(0, Finder(spec_with(L(c, e))))
            try:
                for src in ("import evilmod", "from evilmod import x", "import evilmod.sub"):
                    rs.append(outcome(lambda: exec(src, {}))[:12])
            finally:
                del sys.meta_path[0]; sys.modules.pop("evilmod", None); sys.modules.pop("evilmod.sub", None)
    return len(rs)

@case("finder that changes sys.meta_path, sys.path, sys.modules while it is asked")
def _():
    rs = []
    saved = list(sys.meta_path), list(sys.path), list(sys.path_hooks)
    for action in (lambda n: sys.meta_path.clear(), lambda n: sys.meta_path.extend(sys.meta_path), lambda n: sys.path.clear(), lambda n: sys.path_hooks.clear(), lambda n: sys.path_importer_cache.clear(), lambda n: sys.meta_path.reverse(), lambda n: sys.meta_path.__setitem__(slice(None), [1, 2, 3]),
                   lambda n: [sys.modules.pop(k) for k in list(sys.modules) if k.startswith("json")], lambda n: exec("import " + n, {}) if n.count("x") < 3 else None):
        sys.meta_path.insert(0, Finder(action))
        try: rs.append(run_imports())
        finally: sys.meta_path[:], sys.path[:], sys.path_hooks[:] = saved
    return rs

@case("path hooks and path entry finders that misbehave")
def _():
    n = 0; saved = list(sys.path_hooks), list(sys.path)
    for junk in JUNK:
        for hook in (junk, lambda p: junk, lambda p: types.SimpleNamespace(find_spec=junk), lambda p: types.SimpleNamespace(find_spec=lambda *a: junk)):
            sys.path_hooks.insert(0, hook); sys.path.insert(0, "/nonexistent/evil"); sys.path_importer_cache.clear()
            try:
                for src in ("import evilnothere", "import colorsys", "importlib.invalidate_caches()"):
                    sys.modules.pop("colorsys", None); outcome(lambda: exec(src, {"importlib": importlib})); n += 1
            finally: sys.path_hooks[:], sys.path[:] = saved; sys.path_importer_cache.clear()
    return n

@case("junk on sys.path and in __path__")
def _():
    n = 0; saved = list(sys.path)
    for junk in JUNK:
        sys.path.insert(0, junk)
        try: n += run_imports()
        finally: sys.path[:] = saved
        m = types.ModuleType("evilpkg"); m.__path__ = [junk]; sys.modules["evilpkg"] = m
        outcome(lambda: exec("import evilpkg.sub", {})); sys.modules.pop("evilpkg", None)
    return n

# ---- _imp and the frozen modules ----

@case("_imp functions with junk")
def _():
    n = 0
    names = [x for x in dir(_imp) if not x.startswith("__") and x not in ("acquire_lock", "release_lock", "lock_held")]
    for name in names:
        f = getattr(_imp, name)
        for a in JUNK + [importlib.machinery.ModuleSpec("x", None), importlib.machinery.ModuleSpec("sys", None), importlib.machinery.ModuleSpec("zipimport", None), "zipimport", "os", "_frozen_importlib", "__hello__", "__phello__", "__phello__.spam", "sys", "builtins", memoryview(b"abc"), bytearray(b"\xe3" * 50), marshal.dumps(compile("1", "f", "eval")), marshal.dumps(1)]:
            outcome(lambda: f(a)); n += 1
            for b in JUNK[:12] + [memoryview(b"abc"), marshal.dumps(compile("1", "f", "eval")), marshal.dumps([1])]:
                outcome(lambda: f(a, b)); outcome(lambda: f(a, withdata=b)) if name == "find_frozen" else None; n += 1
    return n

@case("the import lock")
def _():
    rs = [outcome(_imp.release_lock)[:30], _imp.lock_held()]
    for _ in range(100): _imp.acquire_lock()
    rs.append(_imp.lock_held())
    box = []
    t = threading.Thread(target=lambda: box.append((outcome(_imp.release_lock)[:30], _imp.lock_held()))); t.start(); t.join()
    for _ in range(100): _imp.release_lock()
    rs += [box, _imp.lock_held(), outcome(_imp.release_lock)[:30]]
    return rs

@case("thread ends holding the import lock and module locks")
def _():
    t = threading.Thread(target=_imp.acquire_lock); t.start(); t.join()
    box = []
    def importer(): box.append(outcome(lambda: exec("import colorsys", {})))
    sys.modules.pop("colorsys", None)
    t = threading.Thread(target=importer, daemon=True); t.start(); t.join(3)
    return box, t.is_alive(), _imp.lock_held()

@case("frozen modules executed again, with odd specs")
def _():
    rs = []
    F = importlib.machinery.FrozenImporter; B = importlib.machinery.BuiltinImporter
    for name in ("zipimport", "_frozen_importlib", "_frozen_importlib_external", "os", "codecs", "__hello__", "__phello__", "__phello__.spam", "importlib._bootstrap", "runpy", "nosuch", "sys", "builtins", "_imp", "_thread", "gc", "_io", "marshal", "posix", "_asyncio", "_datetime", "_ssl", "_sqlite3"):
        for I in (F, B):
            spec = outcome(lambda: I.find_spec(name))
            s = I.find_spec(name) if spec.startswith("ok") else None
            if s is None: s = importlib.machinery.ModuleSpec(name, I)
            for f in (lambda: I.create_module(s), lambda: I.exec_module(types.ModuleType(name)), lambda: I.exec_module(I.create_module(s) or types.ModuleType(name)), lambda: importlib.util.module_from_spec(s), lambda: I.get_code(name), lambda: I.get_source(name), lambda: I.is_package(name),
                      lambda: importlib._bootstrap._load_unlocked(s), lambda: _imp.create_builtin(s), lambda: _imp.exec_builtin(types.ModuleType(name)), lambda: _imp.exec_builtin(sys.modules.get(name)), lambda: _imp.exec_dynamic(sys.modules.get(name))):
                rs.append(outcome(f)[:10])
    return len(rs)

@case("built-in modules made twice, emptied, and used")
def _():
    rs = []
    for name in sorted(sys.builtin_module_names):
        if name in ("__main__", "_tkinter", "readline", "_curses", "_curses_panel", "faulthandler", "_testcapi", "_signal", "signal"): continue
        saved = sys.modules.pop(name, None)
        try:
            r = outcome(lambda: importlib.import_module(name))
            m = sys.modules.get(name)
            rs.append(r[:6])
            if m is not None and m is not saved and name not in ("sys", "builtins", "_imp", "_frozen_importlib", "_frozen_importlib_external", "_thread", "_weakref", "_io", "posix", "marshal", "_warnings", "_abc", "_codecs", "errno", "time", "gc", "_collections_abc"):
                fs = [v for v in vars(m).values() if callable(v)]
                vars(m).clear(); gc.collect()
                for f in fs[:40]:
                    if getattr(f, "__name__", "") not in ("_exit", "abort", "fork", "forkpty", "pause", "sigwait", "input", "exit", "_fork_exec", "fork_exec", "kill", "killpg", "setsid", "sleep", "get_event_loop", "breakpoint"): outcome(f)
        finally:
            if saved is not None: sys.modules[name] = saved
    return len(rs)

@case("a stand-in for asyncio takes the types of _asyncio while it is being initialized")
def _():
    for k in [k for k in sys.modules if k == "asyncio" or k.startswith("asyncio.") or k == "_asyncio"]: del sys.modules[k]
    taken = {}
    class L:
        def create_module(self, spec): return None
        def exec_module(self, m):
            import _asyncio
            taken.update(vars(_asyncio))
            raise ImportError("no asyncio for you")
    sys.meta_path.insert(0, Finder(lambda name: importlib.machinery.ModuleSpec(name, L()) if name == "asyncio" else None))
    try: r = outcome(lambda: importlib.import_module("_asyncio"))
    finally: del sys.meta_path[0]
    rs = [r[:40], sorted(k for k in taken if not k.startswith("__"))[:3]]
    loop = types.SimpleNamespace(get_debug=lambda: False, call_soon=lambda *a, **k: None, call_exception_handler=lambda c: None, is_running=lambda: False)
    async def c(): pass
    for name, f in sorted(taken.items()):
        if not callable(f): continue
        co = c()
        for args in ((), (loop,), (co,), (co, loop), (None,), (1, 2)):
            for kw in ({}, {"loop": loop}):
                x = outcome(lambda: f(*args, **kw))
                try: obj = f(*args, **kw)
                except BaseException: continue
                for m in dir(obj):
                    if m.startswith("__") and m not in ("__repr__", "__iter__", "__await__", "__del__"): continue
                    a = outcome(lambda: getattr(obj, m))
                    if a.startswith("ok"):
                        v = getattr(obj, m)
                        if callable(v):
                            for margs in ((), (1,), (ValueError(),), (lambda *a: None,)): outcome(lambda: v(*margs))
        co.close()
    gc.collect()
    return rs

@case("modules whose __dict__ is cleared, replaced or shared during import")
def _():
    d = tempfile.mkdtemp(); rs = []
    bodies = {"evil_a": "import sys\nsys.modules[__name__].__dict__.clear()\nx = 1\n", "evil_b": "globals().clear()\nimport evil_a\n", "evil_c": "import sys\ndel sys.modules[__name__]\nimport evil_c\n" , "evil_d": "import sys, gc\nm = sys.modules.pop(__name__)\ndel m\ngc.collect()\ny = 2\ndef f(): return y\n",
              "evil_e": "import sys\nsys.modules[__name__] = sys.modules[__name__].__dict__\n", "evil_f": "__builtins__.clear() if False else None\ndel __builtins__\nimport evil_a\n", "evil_g": "import sys\nclass M(type(sys)):\n    def __getattr__(s, n): return s\n    def __setattr__(s, n, v): raise KeyError(n)\nsys.modules[__name__].__class__ = M\n",
              "evil_h": "from evil_h import nothing\n", "evil_i": "import evil_j\n", "evil_j": "from evil_i import late\n", "evil_k": "__spec__._initializing = 'x'\n__spec__ = None\n__name__ = 5\n__path__ = 7\nimport evil_k.sub\n", "evil_l": "raise SystemExit(9)\n", "evil_m": "import sys\nsys.setrecursionlimit(60)\ndef f(): import evil_n\nf()\n", "evil_n": "import evil_o\n", "evil_o": "x = 1\n"}
    for name, body in bodies.items():
        with open(os.path.join(d, name + ".py"), "w") as f: f.write(body)
    sys.path.insert(0, d); sys.dont_write_bytecode = True
    try:
        for name in sorted(bodies):
            for _ in range(2): rs.append(outcome(lambda: importlib.import_module(name))[:24])
            sys.setrecursionlimit(1000)
            m = sys.modules.get(name)
            rs.append(outcome(lambda: (repr(m), dir(m), getattr(m, "f", len)() if callable(getattr(m, "f", None)) else 0) and 1)[:10])
    finally: sys.path.remove(d)
    return len(rs)

@case("bytecode caches with junk in them")
def _():
    d = tempfile.mkdtemp(); rs = []
    src = os.path.join(d, "evilcached.py")
    with open(src, "w") as f: f.write("x = 1\n")
    sys.path.insert(0, d)
    try:
        import evilcached
        cached = importlib.util.cache_from_source(src)
        good = open(cached, "rb").read() if os.path.exists(cached) else importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(compile("x = 1", src, "exec"))
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        import random; rnd = random.Random(1)
        variants = [b"", good[:4], good[:15], good[:16], good[:-1], good[:20], good[:16] + marshal.dumps(1), good[:16] + marshal.dumps([1, "a"]), good[:16] + b"\xff" * 40, good + b"x", bytes(16) + good[16:], good[:16] + b"c" + bytes(60), good[:16] + b"\xe3" + b"\xff" * 80]
        for _ in range(300):
            b = bytearray(good); i = rnd.randrange(16, len(b)); b[i] = rnd.randrange(256); variants.append(bytes(b))
        for v in variants:
            with open(cached, "wb") as f: f.write(v)
            sys.modules.pop("evilcached", None); importlib.invalidate_caches()
            rs.append(outcome(lambda: importlib.machinery.SourcelessFileLoader("evilcached", cached).load_module().x)[:8])
            rs.append(outcome(lambda: importlib.import_module("evilcached").x)[:8])
    finally: sys.path.remove(d)
    return len(rs)

@case("many threads import the same and each other's modules")
def _():
    d = tempfile.mkdtemp()
    for i in range(12):
        with open(os.path.join(d, "evilring%d.py" % i), "w") as f: f.write("import time\ntime.sleep(0.001)\nimport evilring%d\nx = %d\n" % ((i + 1) % 12, i))
    sys.path.insert(0, d); sys.dont_write_bytecode = True; box = []
    old = sys.getswitchinterval(); sys.setswitchinterval(1e-5)
    try:
        ts = [threading.Thread(target=lambda i=i: box.append(outcome(lambda: importlib.import_module("evilring%d" % (i % 12)).x)[:6])) for i in range(24)]
        for t in ts: t.start()
        for t in ts: t.join(30)
    finally: sys.path.remove(d); sys.setswitchinterval(old)
    return len(box), any(t.is_alive() for t in ts)

if GROUP == "--list":
    for name, f in CASES: print(name)
else:
    for name, f in CASES:
        if GROUP is None or GROUP == name:
            print(name, "->", outcome(f), flush=True)
