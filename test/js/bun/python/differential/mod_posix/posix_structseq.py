# The result types that are tuples with names.
import posix, pwd, grp, resource

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

TYPES = [posix.stat_result, posix.statvfs_result, posix.terminal_size, posix.times_result, posix.uname_result,
         posix.waitid_result, posix.sched_param, pwd.struct_passwd, grp.struct_group, resource.struct_rusage]
for t in TYPES:
    print(t, t.__name__, t.__qualname__, t.__module__, t.__mro__)
    print(t.n_fields, t.n_sequence_fields, t.n_unnamed_fields, t.__match_args__)
    print(sorted(n for n in vars(t) if not n.startswith('_')))

S = posix.stat_result
show(S)
show(S, 5)
show(S, range(9))
show(S, range(10))
show(S, range(13))
show(S, range(19))
show(S, range(20))
show(S, range(10), 5)
show(S, range(10), None)
show(S, range(10), {})
show(S, range(10), {'st_atime': 1.5, 'st_rdev': 7})
show(S, range(10), {'nope': 1})
show(S, range(11), {'st_atime': 1.5})
show(S, sequence=range(10))
show(S, sequence=range(10), dict={'st_blocks': 3})
s = S(range(10))
print(s.st_mode, s.st_size, s.st_atime, s.st_mtime, s.st_ctime, s.st_atime_ns, s.st_blksize, s.st_rdev)
print(len(s), s[7], s[-1], s[2:5], tuple(s), list(s) == list(range(10)))
print(s == tuple(range(10)), hash(s) == hash(tuple(range(10))), isinstance(s, tuple))
print(s.__reduce__())
s = S(range(10), {'st_atime': 1.5, 'st_blocks': 3})
print(s.st_atime, s.st_mtime, s.st_blocks, s.st_blksize)
print(s.__reduce__())
s = S(range(100, 119))
print(s, s.st_atime, s.st_ctime_ns, s.st_rdev)
show(setattr, s, 'st_mode', 1)
show(delattr, s, 'st_mode')
show(setattr, s, 'other', 1)
show(s.__replace__)
show(s.__replace__, st_mode=1)
import copy
c = copy.copy(s)
print(c == s, type(c), c.st_rdev)

show(type, 'Sub', (S,), {})

match S(range(10)):
    case posix.stat_result(mode, ino, dev):
        print('matched', mode, ino, dev)

T = posix.terminal_size
show(T, (80, 24))
show(T, (80,))
show(T, (80, 24, 1))
t = T((80, 24))
print(t.columns, t.lines, t.__reduce__(), t.__replace__(lines=50), t == (80, 24))
show(t.__replace__, rows=1)
show(t.__replace__, 1)

P = posix.sched_param
show(P)
show(P, 5)
show(P, sched_priority=7)
show(P, (5,))
show(P, 1, 2)
p = P(5)
print(p.sched_priority, p[0], len(p), p.__reduce__(), p.__replace__(sched_priority=9))

U = posix.uname_result
show(U, 'abcde')
show(U, 'abcd')
u = U('abcde')
print(u.sysname, u.nodename, u.release, u.version, u.machine)
show(posix.times_result, range(5))
show(posix.waitid_result, range(5))
show(posix.statvfs_result, range(10))
show(posix.statvfs_result, range(11))
v = posix.statvfs_result(range(11))
print(v.f_bsize, v.f_namemax, v.f_fsid, len(v))
print(posix.statvfs_result(range(10)).f_fsid)
show(pwd.struct_passwd, range(7))
show(grp.struct_group, range(4))
show(resource.struct_rusage, range(16))
