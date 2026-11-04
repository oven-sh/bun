# preexec_fn that is os.setsid or os.setpgrp itself.
import os, subprocess, sys
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
show = 'import os; print(os.getsid(0) == os.getpid(), os.getpgrp() == os.getpid(), os.getsid(0) == %d, os.getpgrp() == %d)' % (os.getsid(0), os.getpgrp())
def run(**kw): return subprocess.run([sys.executable, '-c', show], stdout=subprocess.PIPE, text=True, **kw).stdout.strip()
print('plain     ', run())
print('setsid    ', run(preexec_fn=os.setsid))
print('setpgrp   ', run(preexec_fn=os.setpgrp))
print('session   ', run(start_new_session=True))
print('group 0   ', run(process_group=0))
# A process that leads a session cannot start another one, nor a group: whatever preexec_fn raises is reported in one way.
t(lambda: run(preexec_fn=os.setsid, start_new_session=True))
t(lambda: run(preexec_fn=os.setpgrp, start_new_session=True))
t(lambda: run(preexec_fn=os.setsid, process_group=0))
print('pgrp twice', run(preexec_fn=os.setpgrp, process_group=0))
# The rest of what Popen does is done as ever.
r, w = os.pipe()
p = subprocess.Popen(['/bin/sh', '-c', 'echo out; echo err >&2; echo kept >&%d; pwd; exit 3' % w], preexec_fn=os.setsid, pass_fds=(w,), cwd='/', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
os.close(w); print(p.communicate(), p.returncode, os.read(r, 100)); os.close(r)
t(lambda: subprocess.run(['/nonexistent/program'], preexec_fn=os.setsid))
t(lambda: subprocess.run(['/bin/true'], preexec_fn=os.setsid, cwd='/nonexistent'))
# The whole group can be signalled, which is what it is used for.
import signal
p = subprocess.Popen(['/bin/sh', '-c', 'sleep 30 & echo ready; wait'], preexec_fn=os.setsid, stdout=subprocess.PIPE)
print(p.stdout.readline(), os.getpgid(p.pid) == p.pid); os.killpg(p.pid, signal.SIGTERM); print(p.wait()); p.stdout.close()
import posix
print(run(preexec_fn=posix.setsid), os.setsid is posix.setsid)
