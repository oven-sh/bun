# Files that are dropped without being closed: what was written is there for whoever looks next.
import os, tempfile, json, pickle, subprocess, sys, csv, gc, io, resource, socket
d = tempfile.mkdtemp(); p = os.path.join(d, "f")
open(p, "w").write("hello"); print(repr(open(p).read()))
open(p, "wb").write(b"bytes"); print(open(p, "rb").read(), os.path.getsize(p), os.stat(p).st_size)
def save(path, text):
    f = open(path, "w")
    f.write(text)
save(p, "from a function"); print(open(p).read())
json.dump({"a": [1, 2]}, open(p, "w")); print(json.load(open(p)))
pickle.dump((1, "x"), open(p, "wb")); print(pickle.load(open(p, "rb")))
print("printed", file=open(p, "w")); print(repr(open(p).read()))
csv.writer(open(p, "w", newline="")).writerows([[1, 2], [3, 4]]); print(repr(open(p).read()))
open(p, "a").write("appended\n"); print(repr(open(p).read()))
open(p, "w").writelines(["a\n", "b\n"]); print(os.path.getsize(p))
open(p, "w").write("for a child"); print(subprocess.run(["cat", p], capture_output=True, text=True).stdout)
open(p, "w").write("x" * 300000); print(os.path.getsize(p))
open(p, "r+").write("Y"); print(open(p).read(3))
fd = os.open(p, os.O_RDONLY); print(os.read(fd, 2)); os.close(fd)
f = open(p, "w"); f.write("kept open"); print(repr(open(p).read()) in ("''", "'kept open'")); f.write(" and more"); f.close(); print(open(p).read())
b = io.BufferedWriter(io.FileIO(p, "w")); b.write(b"raw stack"); del b; gc.collect(); print(open(p, "rb").read())
t = io.TextIOWrapper(io.BufferedWriter(io.FileIO(p, "w")), encoding="utf-8"); t.write("é"); del t; gc.collect(); print(open(p, "rb").read())

# Nor do descriptors run out.
soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE); resource.setrlimit(resource.RLIMIT_NOFILE, (120, hard))
for i in range(400): open(os.path.join(d, "g%d" % (i % 7)), "w").write(str(i))
for i in range(400): open(os.path.join(d, "g%d" % (i % 7))).read()
for i in range(400): socket.socket()
for i in range(400): socket.socketpair()
class Fd:
    def __init__(self, *fds): self.fds = fds
    def __del__(self):
        for fd in self.fds: os.close(fd)
for i in range(400): Fd(os.open(p, os.O_RDONLY))
for i in range(400): Fd(*os.pipe())
for i in range(400): Fd(os.dup(0))
for i in range(400): os.scandir(d)
print(sorted(os.listdir(d)), open(os.path.join(d, "g0")).read())
