# ResourceWarning for what is collected unclosed, and warnings while the interpreter shuts down.
import sys, gc, os, warnings, socket, subprocess, tempfile, re
sys.stderr = sys.stdout

def clean(text):
    text = re.sub(r"0x[0-9a-f]+", "0x", text)
    text = re.sub(r"fd=\d+", "fd=N", text)
    text = re.sub(r"name=\d+", "name=N", text)
    text = re.sub(r"\('127.0.0.1', \d+\)", "ADDRESS", text)
    return text.replace(os.path.dirname(os.path.abspath(__file__)), "HERE")

def unclosed(make):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        make()
        gc.collect()
        for w in caught:
            print(w.category.__name__, clean(str(w.message)), type(w.source).__name__)
        if not caught:
            print("nothing")

def text_file(): open(__file__)
def binary_file(): open(__file__, "rb")
def raw_file(): open(__file__, "rb", buffering=0)
def closed_file(): open(__file__).close()
def with_file():
    with open(__file__): pass
def from_descriptor():
    fd = os.open(__file__, os.O_RDONLY)
    open(fd)
def not_owned():
    fd = os.open(__file__, os.O_RDONLY)
    open(fd, closefd=False)
    os.close(fd)
def a_socket(): socket.socket()
def closed_socket(): socket.socket().close()
def detached_socket(): os.close(socket.socket().detach())
def scandir(): next(os.scandir("."))
def scandir_done(): list(os.scandir("."))
def temporary(): tempfile.TemporaryFile()
for make in (text_file, binary_file, raw_file, closed_file, with_file, from_descriptor, not_owned, a_socket, closed_socket,
             detached_socket, scandir, scandir_done):
    print(make.__name__, end=": ")
    unclosed(make)

# Ignored unless asked for.
with warnings.catch_warnings(record=True) as caught:
    text_file()
    gc.collect()
    print(len(caught))

# As an error it cannot be raised anywhere: it is reported.
with warnings.catch_warnings():
    warnings.simplefilter("error", ResourceWarning)
    reports = []
    old, sys.unraisablehook = sys.unraisablehook, lambda u: reports.append((u.exc_type.__name__, clean(str(u.exc_value))))
    text_file()
    gc.collect()
    sys.unraisablehook = old
    print(reports)

def python(*args):
    p = subprocess.run([sys.executable, "-I", *args], capture_output=True, text=True)
    print(p.returncode, repr(p.stdout), [line for line in clean(p.stderr).splitlines() if line.strip(" ~^")])

# While the interpreter shuts down.
python("-c", """
import warnings
warn = warnings.warn
class A:
    def __del__(self):
        warn("test")
a = A()
""")
python("-Wd", "-c", "f = open(%r)" % __file__)
python("-Wd", "-c", "import warnings; f = open(%r)" % __file__)
python("-c", "f = open(%r)" % __file__)
python("-We", "-c", "f = open(%r)" % __file__)
python("-Wd", "-c", "import socket; s = socket.socket()")
python("-X", "dev", "-c", "f = open(%r)" % __file__)

# Options.
python("-Werror", "-c", "import warnings; warnings.warn('x')")
python("-Wignore", "-c", "import warnings; warnings.warn('x'); print('quiet')")
python("-Wonce", "-c", "import warnings\nfor i in range(3): warnings.warn('x')")
python("-Walways", "-c", "import warnings\nfor i in range(2): warnings.warn('x')")
python("-Werror::DeprecationWarning", "-c", "import warnings; warnings.warn('x'); warnings.warn('y', DeprecationWarning)")
python("-Wnonsense", "-c", "print(1)")
python("-c", "import sys, _warnings; print('warnings' in sys.modules); _warnings.warn('native'); print('warnings' in sys.modules)")
python("-c", "import sys; print(sys.warnoptions)")
python("-Wd", "-We::UserWarning", "-c", "import sys, warnings; print(sys.warnoptions); print(warnings.filters[:2])")
