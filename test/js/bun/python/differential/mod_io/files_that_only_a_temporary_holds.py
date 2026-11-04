# open(p).read(), open(p, "w").write(s): nothing but the expression holds the file, and it is closed when the method returns.
# Programs count on it: the next statement reads what was written, removes the file, or opens a thousand more.
import gc, io, os, re, subprocess, sys, tempfile, warnings

directory = tempfile.mkdtemp()
p = os.path.join(directory, "file.txt")


def lowest_free_descriptor():
    fd = os.open(directory, os.O_RDONLY)
    os.close(fd)
    return fd


free = lowest_free_descriptor()


def show(what, *values):
    print(what, *values, "| closed:", lowest_free_descriptor() == free, flush=True)


def showwarning(message, category, filename, lineno, file=None, line=None):
    print("   ", category.__name__, re.sub(r"name=\d+", "name=N", str(message).replace(p, "P")), "| line", lineno - first_line)


warnings.showwarning = showwarning
warnings.simplefilter("always")
first_line = sys._getframe().f_lineno

show("write", open(p, "w").write("one\ntwo\nthree\n"), os.path.getsize(p))
show("read", repr(open(p).read()))
show("read(n)", repr(open(p).read(5)))
show("readline", repr(open(p).readline()))
show("readlines", open(p).readlines())
show("writelines", open(p, "w").writelines(["a\n", "b\n"]), os.path.getsize(p))
show("append", open(p, "a").write("c\n"), os.path.getsize(p))
show("binary read", open(p, "rb").read())
show("binary readline", open(p, "rb").readline())
show("binary write", open(p, "wb").write(b"0123456789"), os.path.getsize(p))
show("update", open(p, "r+b").write(b"ab"), os.path.getsize(p))
show("update, read", open(p, "r+b").read())
show("unbuffered read", open(p, "rb", buffering=0).read())
show("unbuffered readall", open(p, "rb", 0).readall())
show("unbuffered write", open(p, "wb", 0).write(b"xyz"), os.path.getsize(p))
show("io.open", io.open(p).read())
show("keywords", open(file=p, mode="r", encoding="latin-1").read(2))
show("a descriptor", open(os.open(p, os.O_RDONLY)).read())
show("in an expression", len(open(p).read()) + len(open(p).read()), [open(p).read() for i in range(3)])

print("-- the use raises")
for use in (lambda: open(p).read("x"), lambda: open(p).write("x"), lambda: open(p, "w").write(1), lambda: open(p, "w").read(), lambda: open(p, "wb").write("x")):
    try:
        use()
    except Exception as e:
        show(type(e).__name__, e)
open(p, "wb").write(b"\xff\xfe\xfd")
try:
    open(p, encoding="utf-8").read()
except UnicodeDecodeError as e:
    show("UnicodeDecodeError", e.reason)

print("-- an argument is worked out in between")


def text():
    show("  meanwhile")
    return "text"


show("write(f())", open(p, "w").write(text()), os.path.getsize(p))
warnings.simplefilter("ignore")
try:
    open(p, "w").write(1 / 0)
except ZeroDivisionError:
    gc.collect()   # It has not come to the use. With reference counts the file went as the exception left the expression.
    show("the argument raises")

print("-- many")
for i in range(3000):
    open(p, "w").write(str(i))
    assert open(p).read() == str(i)
show("3000 times")
warnings.simplefilter("always")

print("-- somebody else holds it")
f = open(p)
show("a variable", f.read())
f.close()
method = open(p).read
show("a bound method", method())
del method; gc.collect()
kept = []


def spy():
    kept.extend(o for o in gc.get_objects() if isinstance(o, io.TextIOWrapper) and o.name == p and not o.closed)
    return "seen"


show("found by gc.get_objects()", open(p, "w").write(spy()), len(kept), kept[0].closed)
kept.pop().close()
with open(p) as f:
    show("with", f.read())


class Mine(io.FileIO):
    def read(self, *args):
        kept.append(self)
        return super().read(*args)


show("a class of the program", Mine(p).read(), kept[0].closed)
kept.pop().close()

# A process that ends without running anything more.
subprocess.run([sys.executable, "-c", "import os, sys; open(sys.argv[1], 'w').write('written'); os._exit(0)", p])
show("os._exit()", open(p).read())
os.remove(p)
os.rmdir(directory)
