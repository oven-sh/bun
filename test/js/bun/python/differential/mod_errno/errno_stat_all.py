# _stat: the constants, and the functions over many modes.
import _stat

print(_stat.__name__)
names = sorted(n for n in dir(_stat) if not n.startswith('__'))
print(len(names), names)
for n in names:
    v = getattr(_stat, n)
    if isinstance(v, int):
        print(n, type(v).__name__, v, oct(v))
    else:
        print(n, type(v).__name__, v.__name__, v.__module__)

FUNCS = [n for n in names if callable(getattr(_stat, n))]
MODES = [0, 1, 0o777, 0o755, 0o644, 0o7777, 0o4755, 0o2755, 0o1777, 0o4644, 0o2644, 0o1666, 0o111, 0o222, 0o444, 0o170000, 0o177777, 0o200000, 0o1000000, 2**31, 2**32 - 1, True]
for t in range(16):
    for p in (0, 0o644, 0o755, 0o7777, 0o7000):
        MODES.append(t << 12 | p)
for f in FUNCS:
    for m in MODES:
        print(f, oct(m), repr(getattr(_stat, f)(m)))
for p in range(0, 0o10000, 0o37):
    print(oct(p), _stat.filemode(0o100000 | p), _stat.filemode(0o040000 | p))

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%r)' % self.v
class I(int):
    pass
def show(name, *args, **kw):
    try:
        r = repr(getattr(_stat, name)(*args, **kw))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)
for f in FUNCS:
    for x in (-1, -2**70, 2**32, 2**63, 2**64 - 1, 2**64, 10**30, 1.0, 'a', None, b'a', [], Idx(0o40755), Idx(-1), Idx(2**32), I(0o100644), False):
        show(f, x)
    show(f)
    show(f, 1, 2)
    show(f, mode=1)
