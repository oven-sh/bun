# cProfile and profile: who was called how often, and by whom.
import cProfile
import gc
import io
import profile
import pstats
import re
import sys

# What importing has left behind has callbacks (the locks of modules). They are called now, not at some time while a profiler is on.
gc.collect()


def leaf(n):
    return n + 1


def middle(n):
    total = 0
    for i in range(n):
        total += leaf(i)
    return total + len('abc')


def recursive(n):
    return 0 if n == 0 else 1 + recursive(n - 1)


def gen(n):
    for i in range(n):
        yield i


def top():
    middle(3)
    middle(2)
    recursive(4)
    sum(gen(3))
    sorted([3, 1, 2], key=leaf)
    try:
        int('x')
    except ValueError:
        pass
    [].append(1)


def name(function):
    filename, line, text = function
    text = re.sub(r' at 0x[0-9a-f]+', '', text)
    return text if filename == '~' else ('FILE' if filename == __file__ else filename.rsplit('/', 1)[-1]) + ':' + text


def report(stats):
    for function, (cc, nc, tt, ct, callers) in sorted(stats.items(), key=lambda item: name(item[0])):
        print('  ', name(function), cc, nc, tt >= 0, ct >= tt - 1e-9, sorted((name(c), v[0], v[1]) if isinstance(v, tuple) else (name(c), v) for c, v in callers.items()))


print('== cProfile')
p = cProfile.Profile()
p.enable()
top()
p.disable()
p.create_stats()
report(p.stats)

print('== cProfile.runcall, no builtins')
p = cProfile.Profile(builtins=False)
p.runcall(top)
p.create_stats()
report(p.stats)

print('== cProfile, no subcalls')
p = cProfile.Profile(subcalls=False)
p.runcall(top)
p.create_stats()
report(p.stats)

print('== getstats')
p = cProfile.Profile()
p.runcall(middle, 2)
for entry in sorted(p.getstats(), key=lambda e: str(getattr(e.code, 'co_name', e.code))):
    code = getattr(entry.code, 'co_name', entry.code)
    print('  ', type(entry).__name__, code, entry.callcount, entry.reccallcount, type(entry.totaltime).__name__, type(entry.inlinetime).__name__,
          sorted((type(c).__name__, getattr(c.code, 'co_name', c.code), c.callcount, c.reccallcount) for c in entry.calls) if entry.calls else entry.calls)

print('== a timer of its own')
ticks = [0]


def timer():
    ticks[0] += 1
    return ticks[0]


p = cProfile.Profile(timer, 0.5)
p.runcall(middle, 1)
for entry in sorted(p.getstats(), key=lambda e: str(getattr(e.code, 'co_name', e.code))):
    print('  ', getattr(entry.code, 'co_name', entry.code), entry.callcount, entry.totaltime, entry.inlinetime)

print('== two at once')
a = cProfile.Profile()
b = cProfile.Profile()
a.enable()
try:
    b.enable()
except ValueError as e:
    print('ValueError', e)
a.disable()
b.enable()
b.disable()
print(sys.monitoring.get_tool(sys.monitoring.PROFILER_ID))

print('== context manager, clear')
with cProfile.Profile() as p:
    leaf(1)
print(sorted(getattr(e.code, 'co_name', e.code) for e in p.getstats()))
p.clear()
print(p.getstats())

print('== pstats')
p = cProfile.Profile()
p.runcall(top)
out = io.StringIO()
pstats.Stats(p, stream=out).strip_dirs().sort_stats('name').print_stats('leaf|middle|recursive')
for line in out.getvalue().splitlines():
    parts = line.split()
    if parts and parts[-1].endswith(')') and '(' in parts[-1]:
        print('  ', parts[0], parts[-1].split(':')[-1])

print('== profile')
p = profile.Profile()
p.runcall(top)
p.create_stats()
for function, (cc, nc, tt, ct, callers) in sorted(p.stats.items(), key=lambda item: name(item[0])):
    print('  ', name(function), cc, nc, sorted((name(c), v) for c, v in callers.items()))

print('== cProfile.run')
out = sys.stdout
sys.stdout = captured = io.StringIO()
try:
    cProfile.run('leaf(1)', sort='name')
finally:
    sys.stdout = out
print([line.split()[-1] for line in captured.getvalue().splitlines() if line.strip().endswith(')') or line.strip().endswith('}')])
