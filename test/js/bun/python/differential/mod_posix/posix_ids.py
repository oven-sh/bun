# Setting the ids of the process to what they are already, process groups and sessions.
import posix

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

uid, gid = posix.getuid(), posix.getgid()
show(posix.setuid, uid)
show(posix.seteuid, uid)
show(posix.setgid, gid)
show(posix.setegid, gid)
show(posix.setreuid, uid, uid)
show(posix.setreuid, -1, -1)
show(posix.setregid, gid, gid)
show(posix.setregid, -1, -1)
show(posix.setresuid, uid, uid, uid)
show(posix.setresuid, -1, -1, -1)
show(posix.setresgid, gid, gid, gid)
show(posix.setresgid, -1, -1, -1)
print(posix.getresuid() == (uid, uid, uid), posix.getresgid() == (gid, gid, gid))
show(posix.chroot, 'surely/not/there')
show(posix.chroot, b'surely/not/there')
show(posix.getlogin)
print(posix.access('/etc/passwd', posix.R_OK), posix.access('/bin/sh', posix.X_OK), posix.access('/etc/passwd', posix.X_OK))

print('-- groups and sessions')
print(posix.getpgrp() == posix.getpid(), posix.getsid(0) == posix.getpid())
show(posix.setpgid, 0, 0)
print(posix.getpgrp() == posix.getpid(), posix.getpgid(0) == posix.getpid())
show(posix.setpgrp)
show(posix.setsid)
show(posix.tcgetpgrp, 0)
