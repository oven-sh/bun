# Threads blocked in every kind of wait while the main thread collects and allocates.
import threading, gc, time, os, select, socket, queue, subprocess, signal, sys

class Payload:
    def __init__(self, name): self.name = name; self.items = [name + str(i) for i in range(20)]; self.me = self
    def ok(self, name): return self.name == name and self.items[19] == name + "19" and self.me is self

results = {}
ready = []
release = []          # what the main thread calls to end each wait
def waiter(name, wait):
    def run():
        mine = Payload(name)               # only this frame refers to it
        also = {name: [Payload(name + "x")]}
        ready.append(name)
        r = wait()
        results[name] = (mine.ok(name), also[name][0].ok(name + "x"), r)
    t = threading.Thread(target=run, name=name); t.start(); return t

threads = []
lock = threading.Lock(); lock.acquire(); release.append(lock.release)
threads.append(waiter("lock", lambda: lock.acquire()))
rlock = threading.RLock(); rlock.acquire(); release.append(rlock.release)
threads.append(waiter("rlock", lambda: rlock.acquire()))
cond = threading.Condition()
def cond_wait():
    with cond: return cond.wait()
def cond_release():
    with cond: cond.notify_all()
release.append(cond_release); threads.append(waiter("condition", cond_wait))
event = threading.Event(); release.append(event.set); threads.append(waiter("event", event.wait))
sem = threading.Semaphore(0); release.append(sem.release); threads.append(waiter("semaphore", sem.acquire))
q = queue.Queue(); release.append(lambda: q.put("item")); threads.append(waiter("queue", q.get))
sq = queue.SimpleQueue(); release.append(lambda: sq.put("simple")); threads.append(waiter("simplequeue", sq.get))
threads.append(waiter("sleep", lambda: time.sleep(0.6)))
r1, w1 = os.pipe(); release.append(lambda: os.write(w1, b"a")); threads.append(waiter("os.read", lambda: os.read(r1, 1)))
r2, w2 = os.pipe(); release.append(lambda: os.write(w2, b"b")); threads.append(waiter("select", lambda: len(select.select([r2], [], [])[0])))
r3, w3 = os.pipe(); release.append(lambda: os.write(w3, b"c"))
def poll_wait():
    p = select.poll(); p.register(r3, select.POLLIN); return len(p.poll())
threads.append(waiter("poll", poll_wait))
r4, w4 = os.pipe(); release.append(lambda: os.write(w4, b"d"))
def epoll_wait():
    with select.epoll() as e:
        e.register(r4, select.EPOLLIN); return len(e.poll())
threads.append(waiter("epoll", epoll_wait))
s1, s2 = socket.socketpair(); release.append(lambda: s2.send(b"e")); threads.append(waiter("recv", lambda: s1.recv(1)))
srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen()
release.append(lambda: socket.create_connection(srv.getsockname()).close())
threads.append(waiter("accept", lambda: srv.accept()[0].close()))
r5, w5 = os.pipe(); f5 = os.fdopen(r5, "rb"); release.append(lambda: (os.write(w5, b"line\n"), os.close(w5)))
threads.append(waiter("readline", f5.readline))
threads.append(waiter("subprocess", lambda: subprocess.run(["sleep", "0.6"]).returncode))
threads.append(waiter("join", threads[0].join))
bar = threading.Barrier(2); release.append(bar.wait); threads.append(waiter("barrier", lambda: bar.wait() in (0, 1)))

while len(ready) < len(threads): time.sleep(0.005)
time.sleep(0.05)
for i in range(6):
    junk = [[Payload("junk")] for _ in range(300)]
    gc.collect()
del junk
for f in release: f()
for t in threads: t.join()
for name in sorted(results): print(name, results[name])
print(len(results), threading.active_count())
