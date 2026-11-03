# How a process ends: run as children, so that the way they die can be looked at.
import sys, signal, os, time, tempfile
directory = tempfile.mkdtemp()
executable = sys.executable or '/proc/self/exe'
def read_all(fd):
    data = b''
    while True:
        c = os.read(fd, 65536)
        if not c: return data
        data += c
def run(source, send=None, after=b'ready'):
    path = os.path.join(directory, 'child.py')
    with open(path, 'w') as f: f.write(source)
    out_r, out_w = os.pipe(); err_r, err_w = os.pipe()
    argv = [executable, '-I', path] if sys.implementation.name == 'cpython' and sys.executable else ['bun', path]
    pid = os.posix_spawn(executable, argv, os.environ, file_actions=[(os.POSIX_SPAWN_DUP2, out_w, 1), (os.POSIX_SPAWN_DUP2, err_w, 2), (os.POSIX_SPAWN_CLOSE, out_r), (os.POSIX_SPAWN_CLOSE, err_r)])
    os.close(out_w); os.close(err_w)
    out = b''
    if send is not None:
        while after not in out:
            c = os.read(out_r, 1)
            if not c: break
            out += c
        os.kill(pid, send)
    out += read_all(out_r); err = read_all(err_r); os.close(out_r); os.close(err_r)
    status = os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1])
    lines = err.decode().strip().splitlines()
    print(status, out.decode().split(), lines[-1] if lines else None)

run('import time\nprint("ready", flush=True)\ntime.sleep(10)\nprint("no")', signal.SIGINT)
run('print("ready", flush=True)\nwhile True: pass', signal.SIGINT)
run('import time\ntry:\n    print("ready", flush=True)\n    time.sleep(10)\nexcept KeyboardInterrupt:\n    print("caught")', signal.SIGINT)
run('import time\nprint("ready", flush=True)\ntime.sleep(10)', signal.SIGTERM)
run('import time\nprint("ready", flush=True)\ntime.sleep(10)', signal.SIGUSR1)
run('import time, signal, sys\nsignal.signal(signal.SIGTERM, lambda n, f: sys.exit(7))\nprint("ready", flush=True)\ntime.sleep(10)', signal.SIGTERM)
run('import time, signal\nsignal.signal(signal.SIGINT, signal.SIG_IGN)\nprint("ready", flush=True)\ntime.sleep(0.2)\nprint("done")', signal.SIGINT)
os.unlink(os.path.join(directory, 'child.py')); os.rmdir(directory)
