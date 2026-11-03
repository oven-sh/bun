import select, signal, time, os
calls = []
def handler(n, f): calls.append(n)
signal.signal(signal.SIGALRM, handler)
r, w = os.pipe()
def timed(f, least):
    calls.clear(); signal.setitimer(signal.ITIMER_REAL, 0.03, 0.03); t0 = time.monotonic()
    try: res = f()
    finally: signal.setitimer(signal.ITIMER_REAL, 0)
    d = time.monotonic() - t0
    print(res, least <= d < least + 3, len(calls) >= 2)
timed(lambda: select.select([r], [], [], 0.2), 0.2)
p = select.poll(); p.register(r, select.POLLIN); timed(lambda: p.poll(200), 0.2)
e = select.epoll(); e.register(r, select.EPOLLIN); timed(lambda: e.poll(0.2), 0.2)
timed(lambda: time.sleep(0.2), 0.2)
# a handler that raises ends the wait
class Stop(Exception): pass
def raiser(n, f): raise Stop('from handler')
signal.signal(signal.SIGALRM, raiser)
for f in [lambda: select.select([r], [], [], 5), lambda: select.select([r], [], []), lambda: p.poll(5000), lambda: p.poll(), lambda: e.poll(5), lambda: e.poll()]:
    signal.setitimer(signal.ITIMER_REAL, 0.03); t0 = time.monotonic()
    try: print(f())
    except Stop as x: print('Stop', x, time.monotonic() - t0 < 3)
print(p.poll(0))
# data arrives after a signal
signal.signal(signal.SIGALRM, lambda n, f: os.write(w, b'x'))
signal.setitimer(signal.ITIMER_REAL, 0.03); print(select.select([r], [], [], 5) == ([r], [], [])); os.read(r, 1)
signal.setitimer(signal.ITIMER_REAL, 0.03); print(p.poll() == [(r, select.POLLIN)]); os.read(r, 1)
signal.setitimer(signal.ITIMER_REAL, 0.03); print(e.poll() == [(r, select.EPOLLIN)]); os.read(r, 1)
e.close()
