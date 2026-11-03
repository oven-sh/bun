# Calls everything that is written in C++ with arguments nobody would pass. Whatever happens must be a result or an exception.
# usage: fuzz_api.py --list | GROUP [SEED [TRIALS]]. The call that is about to be made is written to stderr, so the last line tells what killed the process.
import sys, os, random, signal, types, io, gc

MODULES = """builtins math cmath itertools functools operator collections _collections heapq _heapq bisect _bisect struct _struct binascii zlib _json json _pickle pickle marshal re _sre unicodedata array
time _io io codecs _codecs _csv csv pyexpat _sqlite3 gc sys _abc abc _weakref weakref _functools _operator _random random _string string _stat stat errno copy copyreg types _types typing _typing
_contextvars contextvars _warnings warnings _tokenize tokenize _ast ast _symtable symtable _opcode _locale locale _md5 _sha1 _sha2 _sha3 _blake2 _hashlib hashlib _hmac hmac _zstd atexit _imp _queue _statistics _datetime
_decimal _bz2 _lzma _uuid _interpolation string.templatelib _suggestions _colorize mmap _thread _tracemalloc _lsprof _asyncio _elementtree _heapq _struct annotationlib reprlib keyword enum dataclasses numbers fractions""".split()

SKIP_NAMES = set("""exit quit _exit abort kill killpg fork forkpty system popen input breakpoint sleep pause sigwait sigwaitinfo sigtimedwait pthread_kill raise_signal alarm setitimer
_sigsegv _sigabrt _sigfpe _fatal_error _stack_overflow _read_null _fatal_error_c_thread remove unlink rmdir rename truncate chmod chown mkdir makedirs setrlimit chdir chroot close closerange dup2 dup
set_wakeup_fd setrecursionlimit setswitchinterval dump_traceback_later start_new_thread start_joinable_thread interrupt_main daemon_threads_allowed _shutdown open open_code fdopen FileIO _exit_thread exit_thread
settrace setprofile _settraceallthreads _setprofileallthreads set_asyncgen_hooks set_coroutine_origin_tracking_depth addaudithook setdlopenflags set_int_max_str_digits _clear_internal_caches _clear_type_cache
freeze unfreeze set_debug set_threshold disable help license credits copyright exec_dynamic create_dynamic load_dynamic acquire_lock release_lock lock_held stack_size register unregister _run_exitfuncs _clear
displayhook excepthook unraisablehook __interactivehook__ __import__ compile_command setlocale bindtextdomain textdomain getpass print pprint pp _set_sentinel get wait acquire join acquire_lock put
mmap flush tzset perf_counter process_time thread_time clock_settime clock_settime_ns remote_exec _dump_tracelets call_tracing _debugmallocstats getobjects gettotalrefcount dump_stats start stop enable
run_in_subinterp main _main _test test""".split())

def names_of(group):
    return group

class Raiser:
    "Every special method raises."
    def __getattr__(self, name): raise ZeroDivisionError(name)
    def _r(self, *a, **k): raise ZeroDivisionError("special")
    __repr__ = __str__ = __hash__ = __eq__ = __lt__ = __le__ = __gt__ = __ge__ = __bool__ = __len__ = __iter__ = __next__ = __index__ = __int__ = __float__ = __call__ = __getitem__ = __setitem__ = _r
    __contains__ = __add__ = __radd__ = __enter__ = __exit__ = __bytes__ = __fspath__ = __buffer__ = __format__ = __length_hint__ = __reduce_ex__ = __copy__ = __deepcopy__ = _r
class Liar:
    "Special methods that return the wrong kind of thing."
    def __init__(self, v): self.v = v
    def _v(self, *a, **k): return self.v
    __repr__ = __str__ = __hash__ = __bool__ = __len__ = __iter__ = __next__ = __index__ = __int__ = __float__ = __call__ = __getitem__ = __contains__ = __bytes__ = __fspath__ = __buffer__ = __format__ = _v
    __length_hint__ = __enter__ = __exit__ = __reduce_ex__ = __reduce__ = __copy__ = __sizeof__ = __dir__ = __eq__ = __lt__ = keys = read = write = readline = readinto = fileno = _v
class Sub:
    pass
class IntSub(int): pass
class StrSub(str): pass
class BytesSub(bytes): pass
class ListSub(list): pass
class DictSub(dict): pass
class TupleSub(tuple): pass
class FloatSub(float): pass
class SetSub(set): pass

def gen():
    yield 1
    yield 2
async def coro(): return 1
async def agen(): yield 1

JUNK = [
    lambda: None, lambda: True, lambda: False, lambda: 0, lambda: 1, lambda: -1, lambda: 2, lambda: 3, lambda: 7, lambda: 255, lambda: 256, lambda: 1000, lambda: -1000, lambda: 2 ** 40, lambda: -2 ** 40, lambda: 2 ** 62, lambda: 2 ** 63 - 1,
    lambda: 2 ** 63, lambda: -2 ** 63, lambda: -2 ** 63 - 1, lambda: 2 ** 64, lambda: 10 ** 30, lambda: -10 ** 30, lambda: 0.0, lambda: -0.0, lambda: 1.5, lambda: -2.5, lambda: 1e308, lambda: float("inf"), lambda: float("-inf"), lambda: float("nan"), lambda: 5e-324,
    lambda: 1j, lambda: complex("nan+infj"), lambda: "", lambda: "a", lambda: "abc", lambda: "\0", lambda: "\ud800", lambda: "\udc00\ud800", lambda: "é€😀", lambda: "a" * 1000, lambda: "%s%d{}{0}", lambda: "utf-8", lambda: "strict", lambda: "r", lambda: "<i", lambda: "\n\r\t ",
    lambda: b"", lambda: b"a", lambda: b"\0\xff", lambda: b"abc" * 100, lambda: bytearray(b"xyz"), lambda: bytearray(), lambda: memoryview(b"abc"), lambda: memoryview(bytearray(b"abcdefgh")).cast("i"), lambda: memoryview(b"")[::2],
    lambda: [], lambda: [1, 2, 3], lambda: [[]], lambda: ["a", b"b", None], lambda: [1] * 1000, lambda: (), lambda: (1,), lambda: (1, 2, 3), lambda: ((),), lambda: ("a", "b"), lambda: (None,) * 20, lambda: {}, lambda: {1: 2}, lambda: {"a": 1}, lambda: {(): []},
    lambda: set(), lambda: {1, 2}, lambda: frozenset({1}), lambda: range(3), lambda: range(0), lambda: range(5, -5, -2), lambda: slice(None), lambda: slice(1, 2, 3), lambda: slice(2 ** 70, -2 ** 70, 2 ** 70), lambda: Ellipsis, lambda: NotImplemented,
    lambda: object(), lambda: type, lambda: int, lambda: str, lambda: list, lambda: dict, lambda: object, lambda: Sub, lambda: Sub(), lambda: len, lambda: abs, lambda: (lambda *a, **k: None), lambda: (lambda: 1), lambda: [].append, lambda: "".join, lambda: str.join,
    lambda: iter([]), lambda: iter([1, 2]), lambda: iter("ab"), lambda: iter({}), lambda: gen(), lambda: (x for x in [1]), lambda: reversed([1]), lambda: zip(), lambda: map(abs, [1]), lambda: enumerate("a"),
    lambda: Exception(), lambda: ValueError("x"), lambda: StopIteration(1), lambda: KeyError, lambda: BaseException, lambda: ExceptionGroup("g", [ValueError()]), lambda: Raiser(), lambda: Liar(None), lambda: Liar(-1), lambda: Liar(2 ** 70), lambda: Liar("x"), lambda: Liar(b"x"),
    lambda: Liar([]), lambda: Liar(1.5), lambda: Liar(object()), lambda: Liar(()), lambda: IntSub(5), lambda: StrSub("s"), lambda: BytesSub(b"s"), lambda: ListSub([1]), lambda: DictSub(a=1), lambda: TupleSub((1,)), lambda: FloatSub(1.5), lambda: SetSub({1}),
    lambda: io.StringIO("text\nmore"), lambda: io.BytesIO(b"data\nmore"), lambda: sys, lambda: types.SimpleNamespace(a=1), lambda: types.MappingProxyType({}), lambda: gen, lambda: gen.__code__, lambda: sys._getframe(), lambda: property(), lambda: staticmethod(len), lambda: classmethod(len),
    lambda: super(Sub, Sub()), lambda: list[int], lambda: int | str, lambda: (lambda c: (c.close(), c)[1])(coro()), lambda: agen(), lambda: types.CellType(), lambda: NotImplementedError, lambda: __builtins__,
]

def log(text):
    os.write(2, (text[:300] + "\n").encode("utf-8", "backslashreplace"))

class CallTimeout(BaseException): pass
def on_alarm(*a): raise CallTimeout()

def short(v):
    try:
        t = type(v).__name__
        if isinstance(v, (int, float, str, bytes, type(None), bool)) and type(v) in (int, float, str, bytes, type(None), bool):
            r = repr(v)
            return r if len(r) < 30 else r[:27] + "..."
        return "<" + t + ">"
    except BaseException:
        return "<?>"

def attempt(rng, label, f, max_args=4):
    n = rng.choice((0, 1, 1, 1, 2, 2, 2, 3, 3, 4))
    n = min(n, max_args)
    args = [rng.choice(JUNK)() for _ in range(n)]
    kwargs = {}
    log("%s(%s)" % (label, ", ".join(short(a) for a in args)))
    try:
        signal.setitimer(signal.ITIMER_REAL, 3)
        try:
            return True, f(*args, **kwargs)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)     # The handler may run here.
    except CallTimeout:
        log("    timed out (interruptible)")
        return False, None
    except BaseException as e:
        return False, None

def use(rng, label, value, depth, trials):
    "Exercise what a call returned: its methods, with junk."
    if depth <= 0 or value is None or isinstance(value, (bool, types.ModuleType)):
        return
    try:
        names = dir(value)
    except BaseException:
        return
    rng.shuffle(names)
    for name in names[:40]:
        if name in SKIP_NAMES or name in ("__class__", "__init_subclass__", "__subclasshook__", "__del__"):
            continue
        if isinstance(value, range) and name in ("index", "count", "__contains__"):     # They look at each of 2**62 numbers, in CPython too.
            continue
        log("%s.%s" % (label, name))
        try:
            attribute = getattr(value, name)
        except BaseException:
            continue
        if callable(attribute):
            for _ in range(trials):
                ok, result = attempt(rng, "%s.%s" % (label, name), attribute)
                if ok and depth > 1 and rng.random() < 0.2:
                    use(rng, "%s.%s()" % (label, name), result, depth - 1, 1)

def fuzz_module(name, seed, trials):
    rng = random.Random(seed)
    try:
        module = __import__(name, fromlist=["x"])
    except BaseException as e:
        print("cannot import", name, type(e).__name__)
        return
    for attr in sorted(vars(module)):
        if attr in SKIP_NAMES or attr.startswith("__") and attr not in ("__build_class__", "__lazy_import__"):
            continue
        value = vars(module)[attr]
        label = name + "." + attr
        if isinstance(value, type):
            if issubclass(value, BaseException) and name != "builtins":
                continue
            instances = []
            for how, make in (("__new__", lambda value=value: value.__new__(value)), ("object.__new__", lambda value=value: object.__new__(value))):
                log("%s via %s" % (label, how))
                try:
                    instances.append((label + "<" + how + ">", make()))
                except BaseException:
                    pass
            for _ in range(trials * 3):
                ok, result = attempt(rng, label, value)
                if ok and len(instances) < 6:
                    instances.append((label + "()", result))
            for ilabel, instance in instances:
                use(rng, ilabel, instance, 2, trials)
            use(rng, label, value, 1, max(1, trials // 2))
        elif callable(value):
            for _ in range(trials * 2):
                ok, result = attempt(rng, label, value)
                if ok and rng.random() < 0.3:
                    use(rng, label + "()", result, 2, 1)
    gc.collect()
    print("done", name)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        for m in dict.fromkeys(MODULES): print(m)
    else:
        os.chdir(os.environ.get("FUZZ_DIR", "/tmp"))
        signal.signal(signal.SIGALRM, on_alarm)
        import warnings; warnings.simplefilter("ignore")
        sys.unraisablehook = lambda *a: None
        fuzz_module(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1, int(sys.argv[3]) if len(sys.argv) > 3 else 6)
