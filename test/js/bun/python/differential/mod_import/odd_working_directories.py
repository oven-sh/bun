# Imports while the working directory has a name that is not ASCII, is no text at all, or is gone.
import importlib
import itertools
import os
import sys
import tempfile

base = os.path.realpath(tempfile.mkdtemp())
sys.path.insert(0, "")
sys.dont_write_bytecode = True
fresh = itertools.cycle(["colorsys", "quopri", "stringprep", "this_is_nowhere", "nturl2path", "netrc", "tabnanny", "sched"])


def attempt(name):
    sys.modules.pop(name, None)
    try:
        module = importlib.import_module(name)
        where = os.path.dirname(module.__file__)
        return "%s: %s" % (name, "the library" if where == sys._stdlib_dir else ascii(os.path.basename(where)))
    except BaseException as e:
        return "%s: %s %s" % (name, type(e).__name__, ascii(str(e)))


def look_around(title):
    importlib.invalidate_caches()
    try:
        where = ascii(os.path.basename(os.getcwd())), os.path.basename(os.getcwdb())
    except OSError as e:
        where = type(e).__name__
    print(title, where)
    print("   ", attempt(next(fresh)), "|", attempt(next(fresh)), "|", attempt("here_only"), "|", attempt("no_such_module"), "|", attempt("no.such.package"))


for name in (b"plain", "\xe6".encode(), "€\U0001f600".encode(), b"\xe7w\xf0", b"\xff", b"a\xc3", "é".encode(), b" ", b"%41", b"node_modules"):
    directory = os.fsencode(base) + b"/" + name
    os.mkdir(directory)
    with open(directory + b"/here_only.py", "w") as f:
        f.write("value = 1\n")
    os.chdir(directory)
    look_around("bytes")
    os.chdir("/")
    os.chdir(os.fsdecode(directory))
    look_around("str")
    os.chdir("/")
    fd = os.open(directory, os.O_RDONLY)
    os.fchdir(fd)
    look_around("fchdir")
    os.chdir(fd)
    os.close(fd)
    look_around("chdir(fd)")
    os.chdir(b"..")
    print(os.getcwd() == base)

# Relative, one level at a time, and back.
os.chdir(base)
os.chdir(b"\xe7w\xf0")
os.mkdir(b"in\xfe")
os.chdir(b"in\xfe")
look_around("nested")
os.chdir("..")
look_around("up")

# A directory that is gone.
os.chdir(base)
os.mkdir("gone")
os.chdir("gone")
os.rmdir(os.path.join(base, "gone"))
look_around("gone")
for bad in (os.path.join(base, "nothing"), b"\xfe\xfe", ""):
    try:
        os.chdir(bad)
    except OSError as e:
        print(type(e).__name__, e.errno, ascii(e.filename if not isinstance(e.filename, str) else os.path.basename(e.filename)))
look_around("still gone")
os.chdir(os.path.join(base, "plain"))
look_around("back")

os.chdir("/")
import shutil
shutil.rmtree(os.fsencode(base))
