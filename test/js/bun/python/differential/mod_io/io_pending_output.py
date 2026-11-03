# What is promised about output that a stream over a file still holds: whoever looks at a file next, through this process or one
# that it starts, finds it there, whether the stream was dropped or is still open. (CPython promises it for dropped streams only,
# because it closes them at once; for open ones it shows what was flushed. `early` is what tells the two apart below.)
import io, os, sys, subprocess, tempfile, shutil, glob, pathlib
early = sys.implementation.name != "cpython"
d = tempfile.mkdtemp(); p = os.path.join(d, "f")
def seen(expected_early, expected_late, value): return value == (expected_early if early else expected_late)

print("--- every way of looking")
looks = {
    "open": lambda: open(p).read(), "open rb": lambda: open(p, "rb").read().decode(), "io.FileIO": lambda: io.FileIO(p).read().decode(),
    "os.open": lambda: (lambda fd: (os.read(fd, 100).decode(), os.close(fd))[0])(os.open(p, os.O_RDONLY)),
    "stat": lambda: "x" * os.stat(p).st_size, "lstat": lambda: "x" * os.lstat(p).st_size, "getsize": lambda: "x" * os.path.getsize(p),
    "pathlib": lambda: pathlib.Path(p).read_text(), "copy": lambda: (shutil.copyfile(p, p + "2"), open(p + "2").read())[1],
    "child": lambda: subprocess.run(["cat", p], capture_output=True, text=True).stdout, "system": lambda: "x" * (os.system("test -s '%s'" % p) == 0),
    "scandir": lambda: "x" * [e.stat().st_size for e in os.scandir(d) if e.name == "f"][0],
}
for name, look in looks.items():
    f = open(p, "w"); f.write("x"); got = look(); f.close()
    print(name, seen("x", "", got), open(p).read())
    b = open(p, "wb"); b.write(b"x"); got = look(); b.close()
    print(name, seen("x", "", got), open(p).read())

print("--- nothing is written twice, and positions are what they were")
f = open(p, "w"); print(f.write("abc"), f.tell()); os.stat(p); print(f.write("def"), f.tell()); os.stat(p); f.seek(1); f.write("X"); f.close(); print(open(p).read())
f = open(p, "wb"); f.write(b"abc"); os.stat(p); print(f.tell()); f.seek(0); f.write(b"Z"); os.stat(p); f.truncate(); f.close(); print(open(p, "rb").read())
f = open(p, "r+b"); print(f.read(1)); f.write(b"123"); os.stat(p); print(f.tell(), f.read()); f.seek(0); print(f.read()); f.close()
f = open(p, "a"); f.write("tail"); os.stat(p); f.write("!"); f.close(); print(open(p).read())
f = open(p, "w", newline="\r\n"); f.write("a\n"); os.stat(p); f.write("b\n"); f.close(); print(open(p, "rb").read())
f = open(p, "w", encoding="utf-16"); f.write("a"); os.stat(p); f.write("b"); f.close(); print(open(p, "rb").read())
f = open(p, "w"); f.write("text "); f.flush(); f.buffer.write(b"bytes "); os.stat(p); f.write("text"); f.close(); print(open(p).read())

print("--- only streams that are what open() makes: nothing of the program's runs because someone looks at a file")
class Text(io.TextIOWrapper):
    def flush(self): log.append("Text.flush"); super().flush()
class Buffered(io.BufferedWriter):
    def flush(self): log.append("Buffered.flush"); super().flush()
class Raw(io.FileIO):
    def write(self, data): log.append("Raw.write"); return super().write(data)
log = []
t = Text(io.BufferedWriter(io.FileIO(p, "w"))); t.write("x"); print(os.stat(p).st_size, log); t.close(); print(log); log.clear()
b = Buffered(io.FileIO(p, "w")); b.write(b"x"); print(os.stat(p).st_size, log); b.close(); print(log); log.clear()
r = io.BufferedWriter(Raw(p, "w")); r.write(b"x"); print(os.stat(p).st_size, log); r.close(); print(log); log.clear()

print("--- closed, detached and broken streams")
f = open(p, "w"); f.write("x"); f.close(); os.stat(p); print(open(p).read())
f = open(p, "w"); f.write("x"); b = f.detach(); os.stat(p); b.close(); print(open(p).read())
f = open(p, "wb"); f.write(b"x"); r = f.detach(); os.stat(p); r.close(); print(open(p, "rb").read())
f = open(p, "wb"); f.write(b"x"); os.close(f.fileno()); print(os.stat(p).st_size in (0, 1))
try: f.close()
except OSError as e: print("OSError", e.errno)
r, w = os.pipe(); f = open(w, "wb"); f.write(b"piped"); os.stat(p); f.flush(); print(os.read(r, 10)); f.close(); os.close(r)
shutil.rmtree(d)
