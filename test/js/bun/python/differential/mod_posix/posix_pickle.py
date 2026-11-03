# Copying and pickling the results; what they inherit from tuple.
import posix, copy
e = next(posix.scandir('/'))
for f in (copy.copy, copy.deepcopy):
    try: print(f(e))
    except Exception as x: print(type(x).__name__, x)
try:
    import pickle
    print(pickle.loads(pickle.dumps(posix.stat_result(range(10)))))
    import os
    s = os.stat('/')
    print(pickle.loads(pickle.dumps(s)) == s, pickle.loads(pickle.dumps(s)).st_mtime_ns == s.st_mtime_ns)
    print(pickle.loads(pickle.dumps(os.statvfs('/'))).f_fsid == os.statvfs('/').f_fsid)
    print(pickle.loads(pickle.dumps(posix.sched_param(3))), pickle.loads(pickle.dumps(os.terminal_size((1,2)))))
    pickle.dumps(e)
except Exception as x: print(type(x).__name__, x)
print(hash(e) == hash(e), e.__class__.__hash__ is object.__hash__)
it = posix.scandir('/')
try: copy.copy(it)
except Exception as x: print(type(x).__name__, x)
print(bool(posix.stat_result(range(10))), posix.stat_result(range(10)) + (1,), posix.stat_result(range(10)) * 1 == tuple(range(10)))
print(sorted(posix.stat_result(range(10)), reverse=True)[:2], 5 in posix.stat_result(range(10)), posix.stat_result(range(10)).index(5), posix.stat_result(range(10)).count(5))
print(posix.stat_result(range(10)) < posix.stat_result(range(1, 11)), posix.stat_result(range(10)) == posix.stat_result(range(10), {'st_blocks': 1}))
