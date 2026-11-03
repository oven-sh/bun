import _lsprof, _tracemalloc, _sysconfig
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(_sysconfig.config_vars(), sorted(n for n in dir(_sysconfig) if not n.startswith('__')))
t(_sysconfig.config_vars, 1)
print(sorted(n for n in dir(_tracemalloc) if not n.startswith('__')))
print(_tracemalloc.is_tracing(), _tracemalloc.get_traceback_limit(), _tracemalloc.get_traced_memory(), _tracemalloc.get_tracemalloc_memory(), _tracemalloc._get_traces(), _tracemalloc._get_object_traceback(1), _tracemalloc.reset_peak(), _tracemalloc.clear_traces(), _tracemalloc.stop())
t(_tracemalloc.start, 0); t(_tracemalloc.start, -1); t(_tracemalloc.start, 10**6); t(_tracemalloc.start, 'x'); t(_tracemalloc.start, 1, 2); t(_tracemalloc._get_object_traceback)
import tracemalloc
print(tracemalloc.is_tracing(), tracemalloc.get_object_traceback([]), tracemalloc.get_traced_memory(), tracemalloc.get_tracemalloc_memory())
t(tracemalloc.take_snapshot)
print(sorted(n for n in dir(_lsprof) if not n.startswith('__')))
P = _lsprof.Profiler
print(P.__mro__, P.__module__, P.__name__, _lsprof.profiler_entry.__match_args__, _lsprof.profiler_subentry.__match_args__, _lsprof.profiler_entry.n_fields, _lsprof.profiler_subentry.n_fields)
p = P(); print(p.getstats(), p.clear(), p.disable())
t(P, 1, 2, 3, 4, 5); t(P, timeunit='x'); t(P, nope=1); print(type(P(None, 0.5, False, False)).__name__, type(P(timer=None, timeunit=1, subcalls=0, builtins=0)).__name__)
t(p.enable, 1, 2, 3); t(p.enable, nope=1); t(p.getstats, 1)
class Q(P): pass
print(type(Q()).__mro__)
e = _lsprof.profiler_entry(('c', 1, 0, 0.5, 0.25, None)); print(e.code, e.callcount, e.reccallcount, e.totaltime, e.inlinetime, e.calls, e)
import cProfile, pstats, profile
print(cProfile.Profile.__mro__[1] is P)
