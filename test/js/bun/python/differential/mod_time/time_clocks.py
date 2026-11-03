# The clocks: only what holds whenever they are read.
import time

print(sorted(n for n in dir(time) if not n.startswith('__')))
print(time.__name__, repr(time.__doc__))
for n in sorted(n for n in dir(time) if n.startswith('CLOCK_')):
    print(n, type(getattr(time, n)).__name__, getattr(time, n))
for n in ('time', 'monotonic', 'perf_counter', 'process_time', 'thread_time'):
    info = time.get_clock_info(n)
    print(n, type(info).__name__, info, sorted(vars(info)), list(vars(info)))
    f = getattr(time, n)
    g = getattr(time, n + '_ns')
    a = f()
    b = g()
    c = f()
    print(type(a).__name__, type(b).__name__, a <= b / 1e9 + 1e-6, b / 1e9 <= c + 1e-6, a >= 0, f.__name__, f.__module__, type(f).__name__)
    last = g()
    ok = True
    for i in range(200):
        now = g()
        ok = ok and now >= last
        last = now
    print(ok if n != 'time' else True)
print(1.7e9 < time.time() < 1e10, 1.7e18 < time.time_ns() < 1e19)
print(abs(time.time() - time.clock_gettime(time.CLOCK_REALTIME)) < 5, abs(time.time_ns() - time.clock_gettime_ns(time.CLOCK_REALTIME)) < 5 * 10**9)
print(abs(time.monotonic() - time.clock_gettime(time.CLOCK_MONOTONIC)) < 5, abs(time.perf_counter() - time.monotonic()) < 5)
for n in sorted(n for n in dir(time) if n.startswith('CLOCK_')):
    c = getattr(time, n)
    print(n, type(time.clock_gettime(c)).__name__, type(time.clock_gettime_ns(c)).__name__, time.clock_getres(c), time.clock_gettime(c) >= 0)

for d in (0, 0.0, 1e-9, 0.001, 0.01, 0.05, True and 0.02):
    a = time.monotonic_ns()
    r = time.sleep(d)
    b = time.monotonic_ns()
    print(d, r, b - a >= d * 1e9, b - a < d * 1e9 + 2e9)
a = time.process_time()
time.sleep(0.05)
print(time.process_time() - a < 0.05)
x = 0
a = time.process_time_ns()
t = time.thread_time_ns()
for i in range(20000):
    x += i
print(time.process_time_ns() > a, time.thread_time_ns() > t)

now = time.time()
l = time.localtime()
g = time.gmtime()
print(abs(time.mktime(l) - now) < 5, g.tm_year >= 2025, l.tm_year >= 2025, time.localtime(None).tm_year == l.tm_year, time.gmtime(None).tm_year == g.tm_year)
print(len(time.asctime()), len(time.ctime()), time.asctime()[-4:] == str(l.tm_year), time.ctime(None)[-4:] == str(l.tm_year), time.strftime('%Y') == str(l.tm_year))
import _thread
print(type(time.pthread_getcpuclockid(_thread.get_ident())).__name__)
print(time.tzset(), time.timezone, time.altzone, time.daylight, time.tzname)
