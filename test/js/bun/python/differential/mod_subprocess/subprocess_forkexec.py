import _posixsubprocess as P, os, sys, errno
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
print([n for n in dir(P) if not n.startswith('__')], type(P.fork_exec).__name__)
def run(args, exe=None, close_fds=True, pass_fds=(), cwd=None, env=None, stdin=-1, stdout=True, restore=True, setsid=False, pgid=-1, gid=None, groups=None, uid=None, umask=-1, preexec=None):
    c2pr, c2pw = os.pipe() if stdout else (-1, -1)
    er, ew = os.pipe()
    while ew < 3: ew = os.dup(ew)
    try:
        pid = P.fork_exec(args, exe or [os.fsencode(args[0])], close_fds, tuple(sorted(set(pass_fds) | {ew})), cwd, env, stdin, -1, c2pr, c2pw, -1, -1, er, ew, restore, setsid, pgid, gid, groups, uid, umask, preexec)
    finally:
        os.close(ew)
        if stdout: os.close(c2pw)
    err = b''
    while True:
        d = os.read(er, 1000)
        if not d: break
        err += d
    os.close(er)
    out = b''
    if stdout:
        while True:
            d = os.read(c2pr, 100000)
            if not d: break
            out += d
        os.close(c2pr)
    _, st = os.waitpid(pid, 0)
    return out, err, os.waitstatus_to_exitcode(st)
print(run(['/bin/echo', 'hello', 'world']))
print(run(['/bin/sh', '-c', 'exit 7']))
print(run(['/bin/sh', '-c', 'kill -TERM $$']))
print(run(['/nonexistent/program']))
print(run(['prog'], exe=[b'/nonexistent/a', b'/bin/nonexistent-b']))
print(run(['echo', 'found'], exe=[b'/nonexistent/echo', b'/bin/echo']))
print(run(['/etc/passwd']))
print(run(['x'], exe=[b'/etc/passwd', b'/nonexistent']))
print(run(['/bin/pwd'], cwd='/tmp'))
print(run(['/bin/pwd'], cwd=b'/usr'))
print(run(['/bin/pwd'], cwd='/nonexistent-dir'))
print(run(['/usr/bin/env'], env=[b'A=1', b'B=two words']))
print(run(['/usr/bin/env'], env=[]))
os.environ['FORKEXEC_TEST'] = 'inherited'; print(b'FORKEXEC_TEST=inherited' in run(['/usr/bin/env'])[0])
print(run(['/bin/sh', '-c', 'umask'], umask=0o27))
print(run([b'/bin/echo', 'mixed', b'types']))
class PL:
    def __fspath__(self): return '/bin/echo'
print(run([PL(), 'pathlike'], exe=[b'/bin/echo']))
print(run(('/bin/echo', 'tuple')))
print(run(iter(['/bin/echo', 'iterator']), exe=[b'/bin/echo']))
# descriptors
r, w = os.pipe(); os.set_inheritable(w, True)
ls = 'for f in /proc/self/fd/*; do echo -n "${f##*/} "; done'
kept = run(['/bin/sh', '-c', 'echo hi 2>/dev/null >&%d' % w], pass_fds=(w,)); print(kept, os.read(r, 10))
print(run(['/bin/sh', '-c', 'echo hi 2>/dev/null >&%d' % w])[2] != 0)
print(run(['/bin/sh', '-c', 'echo hi 2>/dev/null >&%d' % w], close_fds=False)[2], os.read(r, 10))
os.set_inheritable(w, False); print(run(['/bin/sh', '-c', 'echo hi 2>/dev/null >&%d' % w], close_fds=False)[2] != 0)
print(run(['/bin/sh', '-c', 'echo hi 2>/dev/null >&%d' % w], pass_fds=(w,))[2], os.read(r, 10), os.get_inheritable(w))
many = [os.open('/dev/null', os.O_RDONLY) for _ in range(20)]
for f in many: os.set_inheritable(f, True)
out = run(['/bin/sh', '-c', 'ls /proc/self/fd | wc -l'], pass_fds=many[::4])[0]; base = run(['/bin/sh', '-c', 'ls /proc/self/fd | wc -l'])[0]; print(int(out) - int(base))
for f in many: os.close(f)
os.close(r); os.close(w)
# stdin
r, w = os.pipe(); os.write(w, b'from stdin'); os.close(w); print(run(['/bin/cat'], stdin=r)); os.close(r)
# sessions and groups
print(run(['/bin/sh', '-c', 'ps -o sid= -p $$ | tr -d " "; echo $$'], setsid=True)[0].split()[0:2].__len__())
o = run(['/bin/sh', '-c', 'echo $$; ps -o pgid= -p $$'], pgid=0)[0].split(); print(o[0] == o[1])
o = run(['/bin/sh', '-c', 'echo $$; ps -o sid= -p $$'], setsid=True)[0].split(); print(o[0] == o[1])
# signals
import signal
print(run(['/bin/sh', '-c', 'trap'], restore=True)[2])
# identity: the same one is allowed
print(run(['/usr/bin/id', '-u'], uid=os.getuid())[0].strip() == str(os.getuid()).encode(), run(['/usr/bin/id', '-g'], gid=os.getgid())[0].strip() == str(os.getgid()).encode())
# errors in the parent
ok = lambda **k: None
base = [['/bin/true'], [b'/bin/true'], True, (), None, None, -1, -1, -1, -1, -1, -1, 3, 4, True, False, -1, None, None, None, -1, None]
def call(i=None, v=None, n=None):
    a = list(base)
    if i is not None: a[i] = v
    if n is not None: a = a[:n]
    return P.fork_exec(*a)
t(lambda: P.fork_exec()); t(lambda: call(n=21)); t(lambda: P.fork_exec(*base, 1)); t(lambda: P.fork_exec(*base[:21], preexec_fn=None))
t(lambda: call(3, [])); t(lambda: call(3, None)); t(lambda: call(3, (1, 1))); t(lambda: call(3, (2, 1))); t(lambda: call(3, (-1,))); t(lambda: call(3, ('a',))); t(lambda: call(3, (2**40,))); t(lambda: call(3, (1.0,)))
t(lambda: call(13, 2)); t(lambda: call(13, 'x')); t(lambda: call(6, 'x')); t(lambda: call(6, 2**40)); t(lambda: call(6, 1.5)); t(lambda: call(20, 'x')); t(lambda: call(16, 'x')); t(lambda: call(16, 2**40))
t(lambda: call(1, 5)); t(lambda: call(1, ['str'])); t(lambda: call(1, [b'a\0b'])); t(lambda: call(1, [5]))
t(lambda: call(0, 5)); t(lambda: call(0, [5])); t(lambda: call(0, ['a\0b'])); t(lambda: call(0, [None]))
t(lambda: call(5, 5)); t(lambda: call(5, ['A=1'])); t(lambda: call(5, [b'A\0=1'])); t(lambda: call(4, 5)); t(lambda: call(4, 'a\0b'))
t(lambda: call(18, ())); t(lambda: call(18, ['x'])); t(lambda: call(18, [-5])); t(lambda: call(18, [2**40])); t(lambda: call(17, 'x')); t(lambda: call(17, -5)); t(lambda: call(19, 'x')); t(lambda: call(19, 2**40))
class B:
    def __bool__(self): raise KeyError('bool')
t(lambda: call(2, B())); t(lambda: call(14, B())); t(lambda: call(15, B()))
