# faulthandler.enable(): what is written when a fatal signal arrives.
import subprocess, sys, re, os, tempfile

def run(code, *options, fds=()):
    p = subprocess.run([sys.executable, "-I", *options, "-c", code], capture_output=True, text=True, pass_fds=fds,
                       env={**os.environ, "ASAN_OPTIONS": "handle_segv=0:handle_abort=0:handle_sigfpe=0:detect_leaks=0:allocator_may_return_null=1"})
    return p

def clean(text):
    text = re.sub(r"0x[0-9a-f]+", "0x", text)
    text = re.sub(r'File "[^"]*/', 'File "', text)
    text = re.sub(r" \[[^\]]*\] \(most", " (most", text)
    # The C stack is not the same, and there is none here.
    text = re.sub(r"(Current thread's C stack trace \(most recent call first\):\n)(  .*\n)+", r"\1", text)
    text = text.split("\nExtension modules:")[0]
    lines = []
    for line in text.split("\n"):
        if lines and lines[-1][0] == line:
            lines[-1][1] += 1
        else:
            lines.append([line, 1])
    return "\n".join(line if count == 1 else "%s   (%d times)" % (line, count) for line, count in lines)

def show(title, code, *options):
    p = run(code, *options)
    print("==", title, "| killed by a signal:", p.returncode < 0, "| stdout:", repr(p.stdout))
    print(clean(p.stderr))

show("segv", """
import faulthandler
faulthandler.enable()
def inner():
    faulthandler._sigsegv()
def outer():
    inner()
outer()
""")
show("fpe", "import faulthandler\nfaulthandler.enable()\nfaulthandler._sigfpe()")
show("abort", "import faulthandler\nfaulthandler.enable()\nfaulthandler._sigabrt()")
show("one thread only", "import faulthandler\nfaulthandler.enable(all_threads=False)\nfaulthandler._sigsegv()")
show("no C stack", "import faulthandler\nfaulthandler.enable(c_stack=False)\nfaulthandler._sigsegv()")
show("without the GIL", "import faulthandler\nfaulthandler.enable()\nfaulthandler._sigsegv(True)")
show("-X faulthandler", "import faulthandler\nprint(faulthandler.is_enabled(), flush=True)\nfaulthandler._sigsegv()", "-X", "faulthandler")
show("a name that is not ASCII", "import faulthandler\nfaulthandler.enable(c_stack=False)\ndef café中():\n    faulthandler._sigsegv()\ncafé中()")
show("in a finalizer", """
import faulthandler, gc
faulthandler.enable(c_stack=False)
class C:
    def __del__(self):
        faulthandler._sigsegv()
a = C(); a.a = a
del a
gc.collect()
""")
show("deep", """
import faulthandler
faulthandler.enable(c_stack=False)
def f(n):
    if n:
        f(n - 1)
    else:
        faulthandler._sigsegv()
f(150)
""")
# The other thread is on the line it stays on by the time the signal comes.
other_thread = """
lock = threading.Lock(); lock.acquire()
def wait():
    lock.acquire()
thread = threading.Thread(target=wait, daemon=True); thread.start()
while True:
    frame = sys._current_frames().get(thread.ident)
    if frame and frame.f_code is wait.__code__ and frame.f_lineno == wait.__code__.co_firstlineno + 1:
        break
del frame
faulthandler._sigsegv()
"""
show("threads", "import faulthandler, sys, threading\nfaulthandler.enable(c_stack=False)" + other_thread)
show("more threads than are shown", "import faulthandler, sys, threading\nfaulthandler.enable(c_stack=False, max_threads=1)" + other_thread)

# Disabled again: nothing of Python's is written.
p = run("import faulthandler\nfaulthandler.enable()\nprint(faulthandler.disable(), faulthandler.is_enabled(), faulthandler.disable(), flush=True)\nfaulthandler._sigsegv()")
print(p.stdout, p.returncode != 0, "Fatal Python error" in p.stderr)

# To a file, and to a descriptor: nothing on stderr.
with tempfile.TemporaryDirectory() as directory:
    path = os.path.join(directory, "log")
    p = run("import faulthandler\nf = open(%r, 'wb')\nfaulthandler.enable(f, c_stack=False)\nfaulthandler._sigsegv()" % path)
    print(repr(p.stderr), clean(open(path).read()))
    with open(path, "wb") as f:
        p = run("import faulthandler\nfaulthandler.enable(%d, c_stack=False)\nfaulthandler._sigsegv()" % f.fileno(), fds=(f.fileno(),))
    print(repr(p.stderr), clean(open(path).read()))
