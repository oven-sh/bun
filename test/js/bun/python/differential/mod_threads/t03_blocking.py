# Every kind of wait lets the other threads run.
import threading, time, os, select, socket, subprocess, sys, signal

ticks = 0
stop = False
def ticker():
    global ticks
    while not stop:
        ticks += 1
        time.sleep(0.001)
t = threading.Thread(target=ticker, daemon=True); t.start()

def check(name, f):
    before = ticks
    r = f()
    print(name, ticks - before >= 1, r)

check("sleep", lambda: time.sleep(0.05))
r, w = os.pipe()
threading.Timer(0.05, os.write, (w, b"x")).start()
check("os.read", lambda: os.read(r, 1))
threading.Timer(0.05, os.write, (w, b"y")).start()
check("select", lambda: [len(x) for x in select.select([r], [], [], 5)]); os.read(r, 1)
threading.Timer(0.05, os.write, (w, b"z")).start()
p = select.poll(); p.register(r, select.POLLIN)
check("poll", lambda: len(p.poll(5000))); os.read(r, 1)
check("select timeout", lambda: select.select([r], [], [], 0.05))
ep = select.epoll(); ep.register(r, select.EPOLLIN)
threading.Timer(0.05, os.write, (w, b"e")).start()
check("epoll", lambda: len(ep.poll(5))); os.read(r, 1); ep.close()
f = os.fdopen(r, "rb", buffering=0)
threading.Timer(0.05, os.write, (w, b"file")).start()
check("FileIO.read", lambda: f.read(4))
a, b = socket.socketpair()
threading.Timer(0.05, b.send, (b"sock",)).start()
check("recv", lambda: a.recv(10))
a.settimeout(0.05)
def timed():
    try: a.recv(1)
    except TimeoutError: return "timed out"
check("recv timeout", timed)
srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen()
def connect_later():
    time.sleep(0.05)
    c = socket.create_connection(srv.getsockname()); c.sendall(b"hi"); c.close()
threading.Thread(target=connect_later).start()
def accept():
    c, _ = srv.accept(); d = c.recv(10); c.close(); return d
check("accept", accept)
check("subprocess", lambda: subprocess.run(["sleep", "0.05"]).returncode)
check("os.system", lambda: os.system("sleep 0.05"))
check("lock timeout", lambda: threading.Lock().acquire() and None)
l = threading.Lock(); l.acquire()
check("lock timeout", lambda: l.acquire(timeout=0.05))
check("event", lambda: threading.Event().wait(0.05))
check("getaddrinfo", lambda: (time.sleep(0.02), socket.getaddrinfo("127.0.0.1", 80, type=socket.SOCK_STREAM)[0][4])[1])
stop = True; t.join()

# the same waits in a thread that is not the main one, while the main one computes
out = []
def waits():
    time.sleep(0.01); out.append("sleep")
    r, w = os.pipe(); os.write(w, b"1"); out.append(os.read(r, 1))
    out.append(select.select([], [], [], 0.01))
    x, y = socket.socketpair(); y.send(b"2"); out.append(x.recv(1))
    out.append(subprocess.run(["true"]).returncode)
t = threading.Thread(target=waits); t.start()
n = 0
while t.is_alive(): n += 1
print(out, n > 0)
