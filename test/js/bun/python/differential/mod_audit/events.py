# The events the runtime raises, with their arguments.
import sys, os, tempfile, warnings
import ast, io, time, gc, marshal, pickle, array, mmap, socket, fcntl, resource, signal, threading, syslog, subprocess
warnings.simplefilter("ignore")

log = []
wanted = set()
def hook(event, args):
    if event in wanted or any(event.startswith(p) for p in wanted if p.endswith(".")):
        log.append((event, args))
sys.addaudithook(hook)

here = tempfile.mkdtemp()
def show(*events):
    """Decorator: runs the function, prints what was heard of these events."""
    def run(function):
        wanted.clear(); wanted.update(events); log.clear()
        try:
            function()
        except Exception as e:
            print(function.__name__, "raised", type(e).__name__)
        wanted.clear()
        for event, args in log:
            text = repr(args).replace(here, "HERE")
            print(function.__name__, event, text)
        if not log:
            print(function.__name__, "nothing")
    return run

@show("open")
def opening():
    with open(os.path.join(here, "a"), "w") as f:
        f.write("x")
    with open(os.path.join(here, "a"), "rb"):
        pass
    fd = os.open(os.path.join(here, "a"), os.O_RDONLY)
    os.close(fd)

@show("os.")
def files():
    a, b = os.path.join(here, "a"), os.path.join(here, "b")
    os.chmod(a, 0o600)
    os.rename(a, b)
    os.link(b, a)
    os.remove(a)
    os.symlink(b, a)
    os.unlink(a)
    os.mkdir(os.path.join(here, "d"))
    os.mkdir(os.path.join(here, "e"), 0o700)
    os.listdir(here)
    os.listdir()
    with os.scandir(here):
        pass
    os.rmdir(os.path.join(here, "d"))
    os.rmdir(os.path.join(here, "e"))
    os.truncate(b, 0)
    os.utime(b, (1, 2))
    os.utime(b, ns=(1, 2))
    os.utime(b)
    os.chown(b, -1, -1)
    os.replace(b, a)
    os.remove(os.fsencode(a))

@show("os.")
def environment():
    os.putenv("AUDIT_TEST", "1")
    os.unsetenv("AUDIT_TEST")
    os.environ["AUDIT_TEST"] = "2"
    del os.environ["AUDIT_TEST"]

@show("os.")
def processes():
    os.kill(os.getpid(), 0)
    log[-1] = (log[-1][0], (log[-1][1][0] == os.getpid(), log[-1][1][1]))
    os.system("true")
    pid = os.posix_spawn("/bin/true", ["true"], {"A": "b"})
    os.waitpid(pid, 0)

@show("os.chdir")
def directory():
    old = os.getcwd()
    os.chdir(here)
    os.chdir(old)
    log[-1] = (log[-1][0], ("OLD",))

@show("compile", "exec")
def compiling():
    code = compile("1 + 1", "<audit>", "eval")
    eval(code)
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,))
    exec("pass")
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,))
    compile(ast.parse("2"), "<tree>", "exec")
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__, log[-1][1][1]))

@show("builtins.id", "builtins.input", "builtins.input/result", "builtins.breakpoint")
def builtins_():
    id(None)
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,))
    stdin, sys.stdin = sys.stdin, io.StringIO("typed\n")
    stdout, sys.stdout = sys.stdout, io.StringIO()
    try:
        input("prompt")
    finally:
        sys.stdin, sys.stdout = stdin, stdout
    old, sys.breakpointhook = sys.breakpointhook, lambda *a, **k: None
    try:
        breakpoint()
    finally:
        sys.breakpointhook = old
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,))

@show("sys.")
def system():
    sys._getframe()
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,))
    sys._getframemodulename()
    sys._current_frames()
    sys._current_exceptions()
    sys.settrace(None)
    sys.setprofile(None)
    hooks = sys.get_asyncgen_hooks()
    sys.set_asyncgen_hooks(firstiter=None)
    sys.set_asyncgen_hooks(finalizer=None)
    sys.set_asyncgen_hooks(*hooks)

@show("object.__setattr__", "object.__getattr__", "object.__delattr__")
def objects():
    class A: pass
    class B: pass
    a = A()
    a.__class__ = B
    log[-1] = (log[-1][0], (type(log[-1][1][0]).__name__,) + tuple(getattr(x, "__name__", x) for x in log[-1][1][1:]))
    def f(x=1, *, y=2): pass
    f.__code__
    f.__defaults__ = (3,)
    f.__kwdefaults__ = {"y": 4}
    A.__name__ = "C"
    A.__bases__ = (B,)
    for i in range(1, len(log)):
        event, args = log[i]
        log[i] = (event, (type(args[0]).__name__, args[1]))

@show("time.sleep", "gc.get_objects", "gc.get_referrers", "gc.get_referents")
def others():
    time.sleep(0)
    time.sleep(0.001)
    gc.get_objects()
    gc.get_objects(generation=1)
    gc.get_referrers(log, wanted) and None
    log[-1] = (log[-1][0], len(log[-1][1][0]))
    gc.get_referents(log) and None
    log[-1] = (log[-1][0], len(log[-1][1][0]))

@show("marshal.", "pickle.find_class", "array.__new__", "mmap.__new__")
def data():
    text = marshal.dumps([1, "a"])
    marshal.loads(text)
    log[-1] = (log[-1][0], (log[-1][1][0] == text,))
    marshal.load(io.BytesIO(text))
    marshal.dumps(1, 2)
    pickle.loads(pickle.dumps(os.stat_result))
    pickle.loads(pickle.dumps(len))
    array.array("i", [1])
    array.array("b")
    array.array("u", "ab")
    mmap.mmap(-1, 4096).close()

@show("socket.")
def sockets():
    s = socket.socket()
    log[-1] = (log[-1][0], log[-1][1][1:])
    s.bind(("127.0.0.1", 0))
    log[-1] = (log[-1][0], log[-1][1][1:])
    s.listen()
    port = s.getsockname()[1]
    c = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    log[-1] = (log[-1][0], log[-1][1][1:])
    c.connect(("127.0.0.1", port))
    log[-1] = (log[-1][0], (log[-1][1][1][0], log[-1][1][1][1] == port))
    c.close(); s.close()
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    log[-1] = (log[-1][0], log[-1][1][1:])
    u.sendto(b"x", ("127.0.0.1", 9))
    log[-1] = (log[-1][0], log[-1][1][1:])
    u.close()
    socket.gethostname()
    socket.gethostbyname("localhost")
    socket.getaddrinfo("localhost", 80, socket.AF_INET, socket.SOCK_STREAM)
    socket.getaddrinfo(None, "80")
    socket.getnameinfo(("127.0.0.1", 80), socket.NI_NUMERICHOST | socket.NI_NUMERICSERV)
    for call in (lambda: socket.getservbyport(80), lambda: socket.getservbyport(80, "tcp"),
                 lambda: socket.getservbyname("http"), lambda: socket.getservbyname("http", "tcp")):
        try:
            call()
        except OSError:
            pass

@show("fcntl.", "resource.", "signal.pthread_kill", "syslog.")
def unix():
    with open(os.path.join(here, "lock"), "w") as f:
        n = f.fileno()
        fcntl.fcntl(f, fcntl.F_GETFD)
        fcntl.flock(f, fcntl.LOCK_EX)
        fcntl.flock(f, fcntl.LOCK_UN)
        fcntl.lockf(f, fcntl.LOCK_EX)
        fcntl.lockf(f, fcntl.LOCK_UN, 1, 2, 0)
        for i, (event, args) in enumerate(log):
            log[i] = (event, (args[0] == n,) + args[1:])
    os.remove(os.path.join(here, "lock"))
    limits = resource.getrlimit(resource.RLIMIT_CORE)
    resource.setrlimit(resource.RLIMIT_CORE, limits)
    log[-1] = (log[-1][0], (log[-1][1][0] == resource.RLIMIT_CORE, log[-1][1][1] == limits))
    signal.pthread_kill(threading.get_ident(), 0)
    log[-1] = (log[-1][0], log[-1][1][1:])
    syslog.openlog("audit", 0, syslog.LOG_USER)
    syslog.setlogmask(0)
    syslog.closelog()

@show("_thread.start_new_thread", "_thread.start_joinable_thread", "subprocess.Popen", "_posixsubprocess.fork_exec")
def starting():
    t = threading.Thread(target=len, args=("",))
    t.start(); t.join()
    log[-1] = (log[-1][0], len(log[-1][1]))
    subprocess.run(["/bin/true"], start_new_session=True)
    for i, (event, args) in enumerate(log):
        if event == "_posixsubprocess.fork_exec":
            log[i] = (event, args[:2] + (args[2] if args[2] is None else "env",))

@show("sys.excepthook", "sys.unraisablehook")
def hooks():
    stderr, sys.stderr = sys.stderr, io.StringIO()
    try:
        class D:
            def __del__(self):
                raise ValueError("in del")
        d = D()
        del d
        gc.collect()
    finally:
        sys.stderr = stderr
    for i, (event, args) in enumerate(log):
        log[i] = (event, (getattr(args[0], "__name__", args[0]), type(args[1]).__name__))

# A hook may forbid.
def forbid(event, args):
    if event == "os.listdir" and args[0] == "/forbidden":
        raise PermissionError("not this one")
    if event == "open" and args[0] == "/forbidden":
        raise RuntimeError("nor this")
    if event == "time.sleep" and args[0] == 1000000:
        raise RuntimeError("too long")
sys.addaudithook(forbid)
for call in (lambda: os.listdir("/forbidden"), lambda: open("/forbidden"), lambda: os.open("/forbidden", 0), lambda: time.sleep(1000000)):
    try:
        call()
    except Exception as e:
        print(type(e).__name__, e)
os.rmdir(here)

# import: only for what is not in sys.modules yet.
imports = []
def importing(event, args):
    if event == "import":
        imports.append((args[0], args[1], args[2] is sys.path, args[3] is sys.meta_path, args[4] is sys.path_hooks))
sys.addaudithook(importing)
import os, sys
sys.modules.pop("this", None)
import colorsys
import colorsys
try:
    import no_such_module_at_all
except ImportError:
    pass
import importlib
importlib.import_module("chunk_of_nothing") if False else None
__import__("sndhdr_gone") if False else None
print([i for i in imports if i[0] in ("os", "sys", "colorsys", "no_such_module_at_all")])
def refuse(event, args):
    if event == "import" and args[0] == "antigravity":
        raise ImportError("not today")
sys.addaudithook(refuse)
try:
    import antigravity
except ImportError as e:
    print("ImportError", e)
