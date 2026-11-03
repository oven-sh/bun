import socket, signal, time, os
calls = []
signal.signal(signal.SIGALRM, lambda n, f: calls.append(n))
a, b = socket.socketpair()
srv = socket.create_server(('127.0.0.1', 0))
def timed(f, least):
    calls.clear(); signal.setitimer(signal.ITIMER_REAL, 0.03, 0.03); t0 = time.monotonic()
    try: res = f()
    except TimeoutError as x: res = 'TimeoutError'
    finally: signal.setitimer(signal.ITIMER_REAL, 0)
    print(res, least <= time.monotonic() - t0 < least + 3, len(calls) >= 2)
a.settimeout(0.2); srv.settimeout(0.2)
buf = bytearray(4)
for f in [lambda: a.recv(1), lambda: a.recv_into(buf), lambda: a.recvfrom(1), lambda: a.recvmsg(1), lambda: srv.accept()]: timed(f, 0.2)
# a blocking call goes on after the handler, until there is something
a.settimeout(None)
n = [0]
def feed(s, f):
    n[0] += 1
    if n[0] == 3: b.send(b'late')
signal.signal(signal.SIGALRM, feed)
signal.setitimer(signal.ITIMER_REAL, 0.02, 0.02); print(a.recv(10), n[0] >= 3); signal.setitimer(signal.ITIMER_REAL, 0)
# sendall is not cut short
def drain(s, f):
    try: calls.append(len(b.recv(1 << 20)))
    except BlockingIOError: pass
signal.signal(signal.SIGALRM, drain)
calls.clear(); data = b'z' * (1 << 22); signal.setitimer(signal.ITIMER_REAL, 0.01, 0.01)
b.setblocking(False); print(a.sendall(data)); signal.setitimer(signal.ITIMER_REAL, 0)
got = sum(calls)
while got < len(data):
    try: got += len(b.recv(1 << 20))
    except BlockingIOError: break
print(got == len(data), len(calls) >= 1)
# a handler that raises
class Stop(Exception): pass
def raiser(s, f): raise Stop('handler')
signal.signal(signal.SIGALRM, raiser)
big = b'y' * (1 << 24)
for f in [lambda: a.recv(1), lambda: a.recv_into(buf), lambda: a.recvmsg(1), lambda: srv.accept(), lambda: a.sendall(big)]:
    srv.settimeout(None); signal.setitimer(signal.ITIMER_REAL, 0.03); t0 = time.monotonic()
    try: print(f())
    except Stop as x: print('Stop', time.monotonic() - t0 < 3)
a.close(); b.close(); srv.close()
