# The module resource.
import resource, posix, warnings

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

print(resource.getpagesize(), resource.getpagesize() == posix.sysconf('SC_PAGESIZE'), resource.RLIM_INFINITY)
u = resource.getrusage(resource.RUSAGE_SELF)
print(type(u), len(u), [type(x).__name__ for x in u])
print(u.ru_utime >= 0, u.ru_maxrss > 0, u[0] == u.ru_utime, u.ru_minflt > 0)
print(type(resource.getrusage(resource.RUSAGE_CHILDREN)).__name__, type(resource.getrusage(resource.RUSAGE_THREAD)).__name__)
show(resource.getrusage, 99)
show(resource.getrusage, 'a')
show(resource.getrusage)
show(resource.getrusage, who=0)

for name in sorted(n for n in dir(resource) if n.startswith('RLIMIT_')):
    limits = resource.getrlimit(getattr(resource, name))
    print(name, type(limits).__name__, len(limits), [type(x).__name__ for x in limits], limits[0] <= limits[1])
show(resource.getrlimit, -1)
show(resource.getrlimit, 99)
show(resource.getrlimit, 'a')
show(resource.getrlimit, 2**40)
show(resource.getrlimit)

soft, hard = resource.getrlimit(resource.RLIMIT_CORE)
show(resource.setrlimit, resource.RLIMIT_CORE, (0, hard))
print(resource.getrlimit(resource.RLIMIT_CORE) == (0, hard))
show(resource.setrlimit, resource.RLIMIT_CORE, [0, hard])
show(resource.setrlimit, resource.RLIMIT_CORE, iter((0, hard)))
soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
show(resource.setrlimit, resource.RLIMIT_NOFILE, (200, hard))
print(resource.getrlimit(resource.RLIMIT_NOFILE) == (200, hard), posix.sysconf('SC_OPEN_MAX'))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (hard + 1, hard)) if hard != resource.RLIM_INFINITY else print('ValueError current limit exceeds maximum limit')
show(resource.setrlimit, resource.RLIMIT_NOFILE, (soft, hard))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (1,))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (1, 2, 3))
show(resource.setrlimit, resource.RLIMIT_NOFILE, 5)
show(resource.setrlimit, resource.RLIMIT_NOFILE, ('a', 1))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (1, 1.5))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (-2, hard))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (2**64, hard))
show(resource.setrlimit, resource.RLIMIT_NOFILE, (-2**70, hard))
show(resource.setrlimit, 99, (1, 1))
show(resource.setrlimit, -1, (1, 1))
show(resource.setrlimit, resource.RLIMIT_NOFILE)
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    stack = resource.getrlimit(resource.RLIMIT_CORE)
    show(resource.setrlimit, resource.RLIMIT_CORE, (0, -1) if stack[1] == resource.RLIM_INFINITY else (0, stack[1]))
    print(len(caught) == (stack[1] == resource.RLIM_INFINITY), {(w.category.__name__, str(w.message)) for w in caught} <= {('DeprecationWarning', 'Use RLIM_INFINITY instead of negative limit value.')})
with warnings.catch_warnings():
    warnings.simplefilter('error')
    show(resource.setrlimit, resource.RLIMIT_CORE, (-1, -1))

print(resource.prlimit(0, resource.RLIMIT_NOFILE) == (soft, hard), resource.prlimit(posix.getpid(), resource.RLIMIT_NOFILE, None) == (soft, hard))
print(resource.prlimit(0, resource.RLIMIT_NOFILE, (150, hard)) == (soft, hard), resource.getrlimit(resource.RLIMIT_NOFILE) == (150, hard))
print(resource.prlimit(0, resource.RLIMIT_NOFILE, (soft, hard)) == (150, hard))
show(resource.prlimit, 2**30, resource.RLIMIT_NOFILE)
show(resource.prlimit, 0, 99)
show(resource.prlimit, 0, resource.RLIMIT_NOFILE, 5)
show(resource.prlimit, 0, resource.RLIMIT_NOFILE, (1,))
show(resource.prlimit, 'a', 0)
show(resource.prlimit, 0)
