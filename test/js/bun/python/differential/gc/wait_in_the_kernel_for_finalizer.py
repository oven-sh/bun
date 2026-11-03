# A program that waits, in a system call, for what only the finalizer of an object it has dropped brings about.
# With reference counts the finalizer has run before the wait begins. Without them, whoever waits has to find out.
import os, select, socket, subprocess, sys, time
class Writes:
    def __init__(self, fd): self.fd = fd
    def __del__(self): os.write(self.fd, b"x")
class Closes:
    def __init__(self, fd): self.fd = fd
    def __del__(self): os.close(self.fd)
class Sends:
    def __init__(self, sock): self.sock = sock
    def __del__(self): self.sock.send(b"y")
def drop(cls, what):
    cls(what)

r, w = os.pipe()
drop(Writes, w); print("os.read", os.read(r, 1))
# What does not wait is not made to.
print("nothing to read", os.read(r, 0))
try: os.read(w, 1)
except OSError as e: print("not open for reading", e.errno)
drop(Writes, w); print("select", select.select([r], [], []) == ([r], [], []), os.read(r, 1))
p = select.poll(); p.register(r, select.POLLIN)
drop(Writes, w); print("poll", p.poll() == [(r, select.POLLIN)], os.read(r, 1))
drop(Writes, w); print("poll with a long timeout", p.poll(600000) == [(r, select.POLLIN)], os.read(r, 1))
if hasattr(select, "epoll"):
    e = select.epoll(); e.register(r, select.EPOLLIN)
    drop(Writes, w); print("epoll", e.poll() == [(r, select.EPOLLIN)], os.read(r, 1))
    e.close()
else:
    print("epoll", True, b"x")
a, b = socket.socketpair()
drop(Sends, b); print("recv", a.recv(1))
a.settimeout(600)
drop(Sends, b); print("recv with a timeout", a.recv(1))
a.close(); b.close()
# The child ends when the last descriptor for the other end of its input is closed.
child_in, ours = os.pipe()
child = subprocess.Popen(["cat"], stdin=child_in, stdout=subprocess.DEVNULL, close_fds=True)
os.close(child_in)
drop(Closes, ours); print("waitpid", os.waitpid(child.pid, 0) == (child.pid, 0))
child.returncode = 0
os.close(r); os.close(w)
