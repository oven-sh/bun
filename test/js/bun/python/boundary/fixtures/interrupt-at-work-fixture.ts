// Cuts short what Python is in the middle of, after which the program goes on: a script of node:vm that SIGINT breaks. `process.argv[2]`
// says in the middle of what. It is the program that sends the signal, where it is to arrive, so nothing depends on how long anything takes.
import vm from "node:vm";
import { dict, exec } from "python:builtins";

// file(): a file whose close() is cut short the first time. after(): whether it has been closed since, and what is in it.
const fileWhoseFirstCloseIsCutShort = `import io, tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class File(io.FileIO):
    def close(self):
        log.append("close")
        if log.count("close") == 1: interrupt()
        super().close()
def file():
    global descriptor
    file = File(path, "w")
    descriptor = file.fileno()
    return file
def after():
    gc.collect()
    try: os.fstat(descriptor)
    except OSError: log.append("closed")
    with open(path) as file: log.append(file.read())
    os.unlink(path)`;

// file(): a file whose close() is cut short between what _IOBase does and what FileIO does. after(): whether the descriptor was closed all the same.
const fileThatIsCutShortOnceItSaysItIsClosed = `import io, tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class File(io.FileIO):
    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        if name == "__IOBase_closed":
            log.append("said")
            interrupt()
def file():
    global descriptor
    file = File(path)
    descriptor = file.fileno()
    return file
def after():
    try: os.fstat(descriptor)
    except OSError: log.append("closed")
    gc.collect()
    os.unlink(path)`;

const programs: Record<string, string> = {
  // That the pipe is full is reported before the handlers are called.
  "sys.unraisablehook, before the handlers of signals are called": `
sys.unraisablehook = lambda args: (log.append(args.err_msg), interrupt())
signal.signal(signal.SIGUSR1, lambda number, frame: log.append(signal.Signals(number).name))
r, w = os.pipe()
os.set_blocking(w, False)
try:
    while True: os.write(w, bytes(4096))
except BlockingIOError: pass
signal.set_wakeup_fd(w)
def work():
    signal.raise_signal(signal.SIGUSR1)
    while True: pass
def after():
    signal.set_wakeup_fd(-1)`,
  "sys.unraisablehook, between the handlers of two signals": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
# They are called in the order of their numbers. That the second has none any more is reported.
def first(number, frame):
    log.append("first")
    signal.signal(signal.SIGUSR1, signal.SIG_IGN)
signal.signal(signal.SIGHUP, first)
signal.signal(signal.SIGUSR1, lambda number, frame: log.append("second"))
signal.signal(signal.SIGUSR2, lambda number, frame: log.append("third"))
def work():
    signals = {signal.SIGHUP, signal.SIGUSR1, signal.SIGUSR2}
    signal.pthread_sigmask(signal.SIG_BLOCK, signals)
    for number in signals: os.kill(os.getpid(), number)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, signals)
    while True: pass
def after(): pass`,
  "sys.unraisablehook, between two of gc.callbacks": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
def first(phase, info):
    log.append("first " + phase)
    if len(log) == 1: raise KeyError
gc.callbacks += [first, lambda phase, info: log.append("second " + phase)]
def work(): gc.collect()
def after():
    collections = gc.get_stats()[2]["collections"]
    gc.collect()
    log.append(gc.get_stats()[2]["collections"] - collections)`,
  "sys.unraisablehook, between two finalizers": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
class D:
    def __del__(self):
        log.append("finalizer")
        if len(log) == 2: raise KeyError
def work():
    [D() for i in range(4)]
    gc.collect()
def after(): gc.collect()`,
  "sys.unraisablehook, between two callbacks of atexit": `
import atexit
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
def second():
    log.append("second")
    raise KeyError
atexit.register(log.append, "fourth")
atexit.register(log.append, "third")
atexit.register(second)
atexit.register(log.append, "first")
def work(): atexit._run_exitfuncs()
def after():
    log.append(atexit._ncallbacks())
    atexit._run_exitfuncs()`,
  "sys.stderr.write(), for gc.DEBUG_STATS": `
class Errors:
    def write(self, text):
        log.append("write")
        if len(log) == 2: interrupt()
    def flush(self): pass
errors, sys.stderr = sys.stderr, Errors()
gc.set_debug(gc.DEBUG_STATS)
gc.callbacks.append(lambda phase, info: log.append(phase))
def work(): gc.collect()
def after():
    gc.collect()
    gc.set_debug(0)
    sys.stderr = errors`,
  // Nobody hears what goes wrong there.
  "the finalizer of a stream, which asks whether it is closed": `
import io
class Raw(io.RawIOBase):
    @property
    def closed(self):
        log.append("closed")
        if len(log) == 1: interrupt()
        return True
def work():
    Raw()
    gc.collect()
    while True: pass
def after(): pass`,
  "sys.unraisablehook, between two streams with something left to write": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
r, w = os.pipe()
os.close(r)
broken = os.fdopen(w, "wb")
r, w = os.pipe()
whole = os.fdopen(w, "wb")
r2, w2 = os.pipe()
text = os.fdopen(w2, "w")
signal.signal(signal.SIGPIPE, signal.SIG_IGN)
def work():
    broken.write(b"lost")
    whole.write(b"kept")
    text.write("kept too")
    os.stat(".")
    while True: pass
def after():
    os.stat(".")
    for fd in r, r2:
        os.set_blocking(fd, False)
        log.append(os.read(fd, 10))`,
  // It is closed by what unwinds the frame.
  "the finally of a generator, while an exception leaves its loop": `
def gen():
    try: yield
    finally:
        log.append("finally")
        interrupt()
def work():
    try:
        for y in gen(): raise ValueError("on its way")
    except ValueError: log.append("caught")
    while True: pass
def after(): pass`,
  "a script within the finally of a generator, while an exception leaves its loop": `
def gen():
    try: yield
    finally: log.append(cut_short(interrupt))
def work():
    try:
        for y in gen(): raise ValueError("on its way")
    except ValueError as error: log.append((repr(error), error.__context__))
def after(): pass`,
  // Nothing propagates through the frames of C, which goes on and calls it again.
  "a function that C calls": `
import ctypes
Compare = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
def compare(a, b):
    log.append("compare")
    interrupt()
def work():
    ctypes.CDLL(None).qsort((ctypes.c_int * 5)(5, 1, 4, 2, 3), 5, 4, Compare(compare))
    log.append("went on")
    while True: pass
def after(): pass`,
  // The module is half made, and is made anew.
  "an audit hook, for what the initializer of a module imports": `
sys.modules.pop("collections.abc", None)
def hook(event, args):
    if event == "import" and args[0] == "collections.abc" and not log:
        log.append("hook")
        interrupt()
sys.addaudithook(hook)
def work():
    import array
    log.append("went on")
    while True: pass
def after():
    import array, collections.abc
    log.append(isinstance(array.array("i"), collections.abc.MutableSequence))`,
  // It is called by what unwinds the frame.
  "a trace function that is told of an exception": `
def trace(frame, event, arg):
    if event == "exception":
        log.append(event)
        interrupt()
    return trace
def f():
    try: raise ValueError
    except ValueError: log.append("caught")
    while True: pass
def work():
    sys.settrace(trace)
    f()
def after(): log.append(sys.gettrace())`,
  // What the runtime has to see to while the script is being ended is seen to, then or later.
  "__buffer__ of what a file that nothing else refers to is to read into": `
import tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class Evil:
    def __buffer__(self, flags): interrupt()
def work(): open(path, "rb", buffering=0).readinto(Evil())
def after():
    gc.collect()
    file = os.stat(path)
    for descriptor in range(256):
        try: other = os.fstat(descriptor)
        except OSError: continue
        if (other.st_dev, other.st_ino) == (file.st_dev, file.st_ino): log.append("still open")
    os.unlink(path)`,
  "__buffer__ of the second of two things to join, when the first is to be told of its release": `
class Exporter:
    def __buffer__(self, flags): return memoryview(b"exported")
    def __release_buffer__(self, view):
        log.append("released")
        view.release()
class Evil:
    def __buffer__(self, flags): interrupt()
def work(): b"".join([Exporter(), Evil()])
def after(): pass`,
  // The list is empty while it is being sorted.
  "the key function of list.sort()": `
items = [3, 1, 2]
def key(item):
    log.append(list(items))
    interrupt()
def work(): items.sort(key=key)
def after(): log.append(items)`,
  "a comparison of list.sort()": `
class Item:
    def __init__(self, number): self.number = number
    def __repr__(self): return str(self.number)
    def __lt__(self, other):
        log.append(list(items))
        interrupt()
items = [Item(3), Item(1), Item(2)]
def work(): items.sort()
def after(): log.append(sorted(item.number for item in items))`,
  "a comparison of list.sort() of a list that JavaScript has forbidden to grow": `
class Item:
    def __init__(self, number): self.number = number
    def __lt__(self, other): interrupt()
items = prevent_extensions([Item(3), Item(1), Item(2)])
def work(): items.sort()
def after(): log.append(sorted(item.number for item in items))`,
  // Nothing looks for the end of the script before the items are to go back: the signal is on its way while they are sorted.
  "list.sort(), after the last call of its key function": `
import random
count = 50000
items = [random.random() for i in range(count)]
calls = 0
def key(item):
    global calls
    calls += 1
    if calls == count: os.kill(os.getpid(), signal.SIGINT)
    return item
def work():
    items.sort(key=key)
    while True: pass
def after(): log.append(len(items))`,
  "list.sort(), before it has called anything": `
items = [(i % 7, i) for i in range(200000)]
def work():
    os.kill(os.getpid(), signal.SIGINT)
    items.sort()
    while True: pass
def after(): log.append(len(items))`,
  // What has gone wrong there is of no consequence to what asked. That the script is being ended is.
  "__index__ of what is looked for in bytes, which has a __buffer__ too": `
class Evil:
    def __index__(self): interrupt()
    def __buffer__(self, flags): log.append("asked all the same")
def work():
    Evil() in b""
    log.append("went on")
def after(): pass`,
  "__index__ of the start of an islice(), whose stop has one too": `
import itertools
class Evil:
    def __index__(self): interrupt()
class Stop:
    def __index__(self): log.append("asked all the same")
def work():
    itertools.islice([], Evil(), Stop())
    log.append("went on")
def after(): pass`,
  "__fspath__ of the program that os.spawnv() is to run": `
children = []
class Evil:
    def __fspath__(self): interrupt()
def work():
    children.append(os.spawnv(os.P_NOWAIT, Evil(), ["x"]))
    log.append("went on")
def after():
    try: log.append(os.waitpid(-1, os.WNOHANG))
    except ChildProcessError: log.append("no child")`,
  // It is finalized another time.
  "the finalizer of a file, which asks whether it is closed": `
import io, tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class File(io.FileIO):
    @property
    def closed(self):
        if not log:
            log.append("asked")
            interrupt()
        return super().closed
def work():
    File(path)
    gc.collect()
    while True: pass
def after():
    gc.collect()
    file = os.stat(path)
    for descriptor in range(256):
        try: other = os.fstat(descriptor)
        except OSError: continue
        if (other.st_dev, other.st_ino) == (file.st_dev, file.st_ino): log.append("still open")
    os.unlink(path)`,
  "the finalizer of a buffered file with something left to write, which asks whether it is closed": `
import io, tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class Writer(io.BufferedWriter):
    @property
    def closed(self):
        if not log:
            log.append("asked")
            interrupt()
        return super().closed
def work():
    Writer(open(path, "wb", buffering=0)).write(b"kept")
    gc.collect()
    while True: pass
def after():
    gc.collect()
    with open(path, "rb") as file: log.append(file.read())
    os.unlink(path)`,
  // A finalizer of the program's is called once.
  "close() of a file, which its own __del__ has called": `
import io, tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class File(io.FileIO):
    def __del__(self):
        log.append("__del__")
        super().__del__()
    def close(self):
        super().close()
        interrupt()
def work():
    File(path)
    gc.collect()
    while True: pass
def after():
    gc.collect()
    os.unlink(path)`,
  // None of the three has given anything up: they are closed another time, as if for the first.
  "close() of the file under a text file, which the collector closes": `
${fileWhoseFirstCloseIsCutShort}
def work():
    io.TextIOWrapper(io.BufferedWriter(file())).write("kept")
    gc.collect()
    while True: pass`,
  "close() of the file under a text file, at the end of a with statement": `
${fileWhoseFirstCloseIsCutShort}
def work():
    with io.TextIOWrapper(io.BufferedWriter(file())) as text: text.write("kept")`,
  "close() of the files under a pair, which the collector closes": `
${fileWhoseFirstCloseIsCutShort}
def work():
    io.BufferedRWPair(io.FileIO(path), file()).write(b"kept")
    gc.collect()
    while True: pass`,
  // It does not keep the descriptor: flush() of whatever is closed around it later would be told that the file is closed.
  "close() of the file under a buffered file, once _IOBase says that it is closed, which the collector closes": `
${fileThatIsCutShortOnceItSaysItIsClosed}
def work():
    io.BufferedReader(file())
    gc.collect()
    while True: pass`,
  "close() of the file under a text file, once _IOBase says that it is closed, at the end of a with statement": `
${fileThatIsCutShortOnceItSaysItIsClosed}
def work():
    with io.TextIOWrapper(io.BufferedReader(file())): pass`,
  // What close(2) has to say is not raised on top of the termination.
  "flush() of a file that is being closed, whose descriptor is no longer open": `
import io
class File(io.FileIO):
    def flush(self):
        log.append("flush")
        if len(log) == 1: interrupt()
file = File(os.devnull, "w")
def work():
    os.close(file.fileno())
    file.close()
def after(): log.append(file.closed)`,
  // A finalizer of the program's is called once, so what it was closing is on its own.
  "close() of the file under a text file, which its own __del__ closes": `
${fileWhoseFirstCloseIsCutShort}
class Text(io.TextIOWrapper):
    def __del__(self):
        log.append("__del__")
        super().__del__()
def work():
    Text(io.BufferedWriter(file())).write("kept")
    gc.collect()
    while True: pass`,
  // The callbacks of the profiler stop. Its books are in order all the same.
  "the timer of a profiler, when a function returns": `
import cProfile
calls = 0
def timer():
    global calls
    calls += 1
    if calls == 2: interrupt()
    return calls
def function(): pass
profile = cProfile.Profile(timer, builtins=False)
def work():
    profile.enable()
    function()
    while True: pass
def after():
    profile.disable()
    log.extend(entry.callcount for entry in profile.getstats() if entry.code is function.__code__)`,
  // It is not known when the call began, so it is not said to have taken since the beginning of time.
  "the timer of a profiler, when a function is entered": `
import cProfile
calls = 0
def timer():
    global calls
    calls += 1
    if calls == 1: interrupt()
    return 1000 + calls
def function(): pass
profile = cProfile.Profile(timer, 1.0, builtins=False)
def work():
    profile.enable()
    function()
def after():
    profile.disable()
    log.extend((entry.callcount, entry.inlinetime) for entry in profile.getstats() if entry.code is function.__code__)`,
  // No call is left under way: what is called when the profiler is on again is nobody's callee.
  "the timer of a profiler, while disable() ends the calls that are under way": `
import cProfile
calls = last = 0
def timer():
    global calls
    calls += 1
    if calls == last: interrupt()
    return calls
profile = cProfile.Profile(timer, 1.0, builtins=False)
def outer(): inner()
def inner():
    global last
    last = calls + 2
    profile.disable()
def later(): pass
def work():
    profile.enable()
    outer()
def after():
    profile.enable()
    later()
    profile.disable()
    functions = { function.__code__: function.__name__ for function in (outer, inner, later) }
    log.extend(sorted((functions[entry.code], entry.callcount, sorted(functions[callee.code] for callee in entry.calls or () if callee.code in functions)) for entry in profile.getstats() if entry.code in functions))`,
  "sys.unraisablehook, for what the timer of a profiler has raised": `
import cProfile
sys.unraisablehook = lambda args: (log.append(args.err_msg.split(" <")[0]), interrupt())
calls = 0
def timer():
    global calls
    calls += 1
    if calls == 2: raise ValueError
    return calls
def function(): pass
profile = cProfile.Profile(timer, builtins=False)
def work():
    profile.enable()
    function()
    while True: pass
def after():
    profile.disable()
    log.extend(entry.callcount for entry in profile.getstats() if entry.code is function.__code__)`,
  "the getter of the path of an error of the system, which JavaScript has thrown": `
def look():
    try: throw_error_of_the_system(lambda: "a path")
    except FileNotFoundError as error: log.append(error.filename)
# So that the class of such errors is there already.
look()
def work():
    try: throw_error_of_the_system(interrupt)
    except OSError: log.append("caught")
    while True: pass
after = look`,
  // It is said another time.
  "the exception handler of a loop, for a future whose exception was never retrieved": `
import asyncio
class Loop:
    def get_debug(self): return False
    def call_exception_handler(self, context):
        log.append(context["message"])
        if len(log) == 1: interrupt()
def work():
    asyncio.Future(loop=Loop()).set_exception(ValueError())
    gc.collect()
    while True: pass
def after(): gc.collect()`,
  // Nothing says that the handler has been left.
  "an except clause": `
def work():
    try: raise ValueError
    except ValueError: interrupt()
def after(): handled()`,
  "an except clause that names the exception, in an except clause": `
def work():
    try: raise ValueError
    except ValueError:
        try: raise KeyError
        except KeyError as error: interrupt()
def after(): handled()`,
  "the expression of an except clause": `
def work():
    try: raise ValueError
    except interrupt(): pass
def after(): handled()`,
  "a finally clause, on the way of an exception": `
def work():
    try: raise ValueError
    finally: interrupt()
def after(): handled()`,
  "an except* clause": `
def work():
    try: raise ExceptionGroup("group", [ValueError()])
    except* ValueError: interrupt()
def after(): handled()`,
  "__exit__, on the way of an exception": `
class Manager:
    def __enter__(self): pass
    def __exit__(self, *args): interrupt()
def work():
    with Manager(): raise ValueError
def after(): handled()`,
  "what an except clause calls": `
def work():
    try: raise ValueError
    except ValueError: (lambda: interrupt())()
def after(): handled()`,
  "an except clause of a generator": `
def gen():
    try: raise ValueError
    except ValueError: interrupt()
    yield
def work():
    for y in gen(): pass
def after(): handled()`,
  "an except clause of what a catch clause of JavaScript calls, which an except clause has called": `
def thrower(): raise ValueError("thrown to JavaScript")
def clause():
    handled()
    try: raise KeyError
    except KeyError: interrupt()
def work():
    try: raise IndexError
    except IndexError: catching(thrower, clause)
def after(): handled()`,
};

// The script is within a handler, which goes on.
// Every way in which a handler is left.
const handlersThatAreLeft = `
class Suppresses:
    def __enter__(self): pass
    def __exit__(self, *args): return True
class Passes:
    def __enter__(self): pass
    def __exit__(self, *args): return False
def a_clause_that_is_left_at_its_end():
    try: raise ValueError
    except ValueError:
        pass
def a_clause_with_a_name():
    try: raise ValueError
    except ValueError as error:
        pass
def a_clause_that_returns():
    try: raise ValueError
    except ValueError:
        return
def a_clause_that_goes_on_with_the_loop():
    for i in range(2):
        try: raise ValueError
        except ValueError:
            continue
def a_clause_in_a_clause():
    try: raise ValueError
    except ValueError:
        try: raise TypeError
        except TypeError:
            pass
        pass
def no_clause_that_matches():
    try:
        try: raise ValueError
        except TypeError:
            pass
    except ValueError:
        pass
def no_clause_with_a_name_that_matches():
    try:
        try: raise ValueError
        except TypeError as error:
            pass
    except ValueError:
        pass
def a_clause_with_a_name_that_raises_again():
    try:
        try: raise ValueError
        except ValueError as error:
            raise
    except ValueError:
        pass
def an_async_for_whose_iterator_raises():
    class Iterator:
        def __aiter__(self): return self
        async def __anext__(self): raise ValueError
    async def loop():
        async for item in Iterator(): pass
    try: loop().send(None)
    except ValueError:
        pass
def an_async_for_that_comes_to_its_end():
    class Iterator:
        def __aiter__(self): return self
        async def __anext__(self): raise StopAsyncIteration
    async def loop():
        async for item in Iterator(): pass
    try: loop().send(None)
    except StopIteration:
        pass
def a_finally_clause():
    try:
        try: raise ValueError
        finally:
            pass
    except ValueError:
        pass
def clauses_for_a_group():
    try: raise ExceptionGroup("", [ValueError(), TypeError()])
    except* ValueError:
        pass
    except* TypeError:
        pass
def a_with_statement_that_suppresses():
    with Suppresses():
        raise ValueError
def a_with_statement_that_does_not():
    try:
        with Passes():
            raise ValueError
    except ValueError:
        pass
def a_clause_of_a_generator():
    def generator():
        try: raise ValueError
        except ValueError:
            yield
        yield
    list(generator())
# Of coroutines that were never awaited, because the script was ended.
import warnings
warnings.simplefilter("ignore")
bodies = [value for name, value in list(globals().items()) if name.startswith(("a_", "an_", "no_", "clauses_"))]
# The script is ended at the first event that the tool is told of, at the second, and so on, until it comes to its end.
def work():
    global count, last, name
    try: raise KeyError("outer")
    except KeyError:
        for body in bodies:
            wrong = []
            name = body.__name__
            for last in range(1, 1000):
                count = 0
                result = cut_short(lambda: script(body))
                switch_off()
                try: raise LookupError
                except LookupError as error:
                    if repr(error.__context__) != "KeyError('outer')": wrong.append((last, repr(error.__context__)))
                if result == "returned": break
            log.append((body.__name__, last > 5, wrong))
def told(code):
    global count
    # Of the function, and of those in it.
    if not code.co_qualname.startswith(name): return
    count += 1
    if count == last: interrupt()
def after(): handled()`;

const programsThatGoOn: Record<string, string> = {
  "a trace function, wherever it is told of something in a function that leaves a handler": `
def trace(frame, event, arg):
    told(frame.f_code)
    return trace
def script(body):
    sys.settrace(trace)
    body()
def switch_off(): sys.settrace(None)
${handlersThatAreLeft}`,
  "a tool of sys.monitoring, at whichever instruction of a function that leaves a handler": `
def script(body):
    sys.monitoring.use_tool_id(1, "test")
    sys.monitoring.register_callback(1, sys.monitoring.events.INSTRUCTION, lambda code, offset: told(code))
    sys.monitoring.set_events(1, sys.monitoring.events.INSTRUCTION)
    body()
def switch_off(): sys.monitoring.free_tool_id(1)
${handlersThatAreLeft}`,
  // What stood in for the message then is not what the error is taken for from then on.
  "toString() of an error of JavaScript that is caught again later": `
says = interrupt
error = error_that_says(lambda: says())
def script():
    try: throw(error)
    except Exception: log.append("caught")
def work():
    global says
    log.append(cut_short(script))
    says = lambda: "what it says"
    try: throw(error)
    except Exception as caught: log.append(str(caught))
def after(): pass`,
  "toString() of what JavaScript has thrown, which an except clause asks": `
def script():
    try: throw_what_says(interrupt)
    except Exception: log.append("caught")
def work():
    try: raise KeyError("outer")
    except KeyError:
        log.append(cut_short(script))
        handled()
def after(): handled()`,
  "an except clause": `
def script():
    try: raise ValueError
    except ValueError: interrupt()
def work():
    try: raise KeyError("outer")
    except KeyError:
        log.append(cut_short(script))
        handled()
def after(): handled()`,
  "a generator, in an except clause of it": `
def script():
    try: raise ValueError
    except ValueError: interrupt()
def gen():
    try: raise KeyError("of the generator")
    except KeyError:
        log.append(cut_short(script))
        handled()
        yield
        handled()
    handled()
def work():
    try: raise IndexError("outer")
    except IndexError:
        for y in gen(): handled()
def after(): handled()`,
  // The clause begins as what the compiler puts around a handler does, and nothing is being handled in the try.
  "an except clause, and the script is in a try whose except clause is empty": `
def script():
    while True:
        try: interrupt(2, "x", [1, 2, 3])
        except: pass
def work():
    try: raise KeyError("outer")
    except KeyError:
        log.append(cut_short(script))
        handled()
def after(): handled()`,
  "an except clause, and the script is in a try whose except clause only returns": `
def script():
    try: interrupt(2, "x", [1, 2, 3])
    except: return 1
def work():
    try: raise KeyError("outer")
    except KeyError:
        log.append(cut_short(script))
        handled()
def after(): handled()`,
  "an except clause, and in the script a catch clause of JavaScript": `
def thrower(): raise ValueError("thrown to JavaScript")
def clause():
    handled()
    try: raise KeyError
    except KeyError: interrupt()
def work():
    try: raise IndexError("outer")
    except IndexError:
        log.append(cut_short(lambda: catching(thrower, clause)))
        handled()
def after(): handled()`,
};

function cutShort(f: () => void) {
  try {
    vm.runInContext("f()", vm.createContext({ f }), { breakOnSigint: true });
    return "returned";
  } catch (error: any) {
    return error.code;
  }
}

const globals = dict([
  ["cut_short", cutShort],
  ["prevent_extensions", Object.preventExtensions],
  [
    "throw_error_of_the_system",
    (path: () => string) => {
      throw Object.defineProperty(Object.assign(new Error("no such file"), { errno: -2, code: "ENOENT" }), "path", {
        get: path,
      });
    },
  ],
  ["error_that_says", (toString: () => string) => Object.assign(new Error(), { toString })],
  [
    "throw",
    (error: unknown) => {
      throw error;
    },
  ],
  [
    "throw_what_says",
    (toString: () => string) => {
      throw { toString };
    },
  ],
  [
    "catching",
    (f: () => void, g: () => void) => {
      try {
        f();
      } catch {
        g();
      }
    },
  ],
]);
exec(
  `
import gc, os, signal, sys
log = []
def interrupt(*args):
    os.kill(os.getpid(), signal.SIGINT)
    while True: pass
# What is being handled, and what an exception that is raised now gets for its context.
def handled():
    handled = repr(sys.exception())
    try: raise LookupError
    except LookupError as error: log.append((handled, repr(error.__context__)))
` + (process.argv[3] ? programsThatGoOn : programs)[process.argv[2]],
  globals,
);
console.log(cutShort(globals.get("work")));
// It is over: nothing is cut short any more, in Python or in JavaScript.
exec(
  `
sys.unraisablehook = lambda args: log.append("another hook")
after()
for i in range(100000): pass
print(log, flush=True)`,
  globals,
);
for (let i = 0; i < 1e6; ++i);
console.log("the end");
