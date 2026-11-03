# What the functions say of bad arguments.
import time

def show(name, *args, **kw):
    try:
        r = getattr(time, name)(*args, **kw)
        r = 'returned ' + type(r).__name__
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%r)' % self.v
class Fl:
    def __init__(self, v): self.v = v
    def __float__(self): return self.v
    def __repr__(self): return 'Fl(%r)' % self.v
class T(tuple):
    pass

NOARGS = 'time time_ns monotonic monotonic_ns perf_counter perf_counter_ns process_time process_time_ns thread_time thread_time_ns tzset'.split()
for name in NOARGS:
    show(name)
    show(name, 1)
    show(name, 1, 2)
    show(name, x=1)
    show(name, None)

for name in ('gmtime', 'localtime', 'ctime'):
    for args in ((), (None,), (0,), (0, 1), (0, 1, 2), ('a',), (b'a',), ([],), (1j,), (Idx(5),), (Fl(5.5),), (Idx(2**70),), (Fl(1e30),), (Fl(float('nan')),), (object(),) and (type,), (2**63,), (-2**63 - 1,), (1e19,), (-1e19,), (float('nan'),), (float('inf'),), (2**62,), (-2**62,)):
        show(name, *args)
    show(name, seconds=0)
    show(name, x=0)
    show(name, 0, x=0)

for name in ('asctime', 'mktime', 'strftime'):
    pre = ('%Y',) if name == 'strftime' else ()
    for arg in (None, 0, 1.5, 'a', [2000, 1, 1, 0, 0, 0, 0, 1, 0], (), (1,), (2000, 1, 1, 0, 0, 0, 0, 1), (2000, 1, 1, 0, 0, 0, 0, 1, 0, 0), (2000, 1, 1, 0, 0, 0, 0, 1, 0, 'X', 0), T((2000, 1, 1, 0, 0, 0, 0, 1, 0)),
                ('a', 1, 1, 0, 0, 0, 0, 1, 0), (2000, 'a', 1, 0, 0, 0, 0, 1, 0), (2000, 1, 1, 0, 0, 0, 0, 1, 'a'), (2000.0, 1, 1, 0, 0, 0, 0, 1, 0), (2000, 1, 1, 0, 0, 0.5, 0, 1, 0), (2000, 1, 1, 0, 0, None, 0, 1, 0),
                (2**31, 1, 1, 0, 0, 0, 0, 1, 0), (-2**31 - 1, 1, 1, 0, 0, 0, 0, 1, 0), (2**63, 1, 1, 0, 0, 0, 0, 1, 0), (-2**63 - 1, 1, 1, 0, 0, 0, 0, 1, 0), (2000, 2**31, 1, 0, 0, 0, 0, 1, 0), (2000, 1, 1, 0, 0, 0, 0, 1, 2**31),
                (Idx(2000), Idx(1), Idx(1), Idx(0), Idx(0), Idx(0), Idx(0), Idx(1), Idx(0)), ('a', 'b', 1), ('a',) * 9, (2000, 13, 'a', 0, 0, 0, 0, 1, 0), (2000, 13, 32, 25, 0, 0, 0, 1, 0), (2000, 1, 32, 25, 0, 0, 0, 1, 0), (2000, 1, 1, 25, 61, 0, 0, 1, 0), (2000, 1, 1, 0, 61, 62, 0, 1, 0),
                (2000, 1, 1, 0, 0, 62, -2, 1, 0), (2000, 1, 1, 0, 0, 0, -2, 400, 0)):
        show(name, *pre, arg)
show('asctime')
show('asctime', (2000, 1, 1, 0, 0, 0, 0, 1, 0), 1)
show('asctime', t=1)
show('asctime', time_tuple=(2000, 1, 1, 0, 0, 0, 0, 1, 0))
show('mktime')
show('mktime', 1, 2)
show('mktime', t=1)
show('strftime')
show('strftime', '%Y')
show('strftime', 5)
show('strftime', None)
show('strftime', b'%Y')
show('strftime', 5, 5)
show('strftime', '%Y', (2000, 1, 1, 0, 0, 0, 0, 1, 0), 1)
show('strftime', format='%Y')
show('strftime', '%Y', t=1)

for args in ((), (1,), ('a',), (None,), (b'time',), ('time',), ('monotonic',), ('perf_counter',), ('process_time',), ('thread_time',), ('clock',), ('',), ('Time',), ('time\0',), ('\0',), ('time', 1), ('é',)):
    show('get_clock_info', *args)
show('get_clock_info', name='time')

for args in ((), ('a',), (None,), (-1,), (-0.5,), (-1e-10,), (float('nan'),), (float('inf'),), (float('-inf'),), (1e30,), (10**30,), (-10**30,), (2**63,), (9223372037,), (9223372036.9,), ([],), (1j,), (0, 0), (0,), (0.0,), (-0.0,), (False,), (Idx(0),), (Fl(0.0),), (Idx(-1),), (Fl(-1.0),), (Fl(float('nan')),), (1e-10,), (1e-9,)):
    show('sleep', *args)
show('sleep', seconds=0)
show('sleep', secs=0)

for name in ('clock_gettime', 'clock_gettime_ns', 'clock_getres'):
    for args in ((), (0,), (1,), (0, 1), ('a',), (None,), (1.0,), (1.5,), (9999,), (-1,), (-9999,), (2**31,), (-2**31 - 1,), (2**31 - 1,), (2**63,), (2**70,), (True,), (Idx(0),), (Idx(2**40),), ([],)):
        show(name, *args)
    show(name, clk_id=0)
    show(name, x=0)
for name in ('clock_settime', 'clock_settime_ns'):
    for args in ((), (0,), (0, 1, 2), ('a', 1), (1.5, 1), (None, None), (2**31, 1), (2**70, 1), (9999, 0), (9999, 'a'), (9999, None), (9999, 1.5), (9999, 2**63), (9999, 2**70), (9999, -2**70), (9999, float('nan')), (9999, float('inf')), (9999, 1e30), (9999, -1), (9999, Idx(1)), (9999, Fl(1.0)), ('a', 'b'), (9999, 10**10), (9999, True)):
        show(name, *args)
    show(name, clk_id=0, time=0)
for args in ((), ('a',), (1.5,), (None,), (0,), (1, 2), ([],)):
    show('pthread_getcpuclockid', *args)
show('pthread_getcpuclockid', thread_id=0)
show('strptime', x=1)
