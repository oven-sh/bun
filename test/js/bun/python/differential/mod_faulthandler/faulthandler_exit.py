import sys, signal, os, time, tempfile, re
directory = tempfile.mkdtemp()
executable = sys.executable or '/proc/self/exe'
def read_all(fd):
    data = b''
    while True:
        c = os.read(fd, 65536)
        if not c: return data
        data += c
def run(source):
    path = os.path.join(directory, 'child.py')
    with open(path, 'w') as f: f.write(source)
    out_r, out_w = os.pipe(); err_r, err_w = os.pipe()
    argv = [executable, '-I', path] if sys.implementation.name == 'cpython' and sys.executable else ['bun', path]
    pid = os.posix_spawn(executable, argv, os.environ, file_actions=[(os.POSIX_SPAWN_DUP2, out_w, 1), (os.POSIX_SPAWN_DUP2, err_w, 2), (os.POSIX_SPAWN_CLOSE, out_r), (os.POSIX_SPAWN_CLOSE, err_r)])
    os.close(out_w); os.close(err_w)
    out = read_all(out_r); err = read_all(err_r); os.close(out_r); os.close(err_r)
    status = os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1])
    s = err.decode(); s = re.sub(r'0x[0-9a-f]{16}', '0xT', s); s = re.sub(r' \[[^\]]*\]', ' [name]', s); s = re.sub(r'File ".*?([^/"]*)"', r'File "\1"', s)
    print(status, out.decode().split()); print(s)
# Collected first: what the import system leaves behind has callbacks, which would run in a collection while the thread waits.
run('import faulthandler, gc, time\ngc.collect()\nfaulthandler.dump_traceback_later(0.1, exit=True)\ndef f():\n    time.sleep(10)\nf()\nprint("no")')
run('import faulthandler, time\nfaulthandler.dump_traceback_later(0.1, exit=True)\ndef f():\n    while True: pass\nf()\nprint("no")')
run('import faulthandler, time\nfaulthandler.dump_traceback_later(1.5)\nprint("done")')
run('import faulthandler, signal, os\nfaulthandler.register(signal.SIGUSR1, chain=True)\ndef f():\n    os.kill(os.getpid(), signal.SIGUSR1)\nf()\nprint("no")')
run('import faulthandler\nfaulthandler.dump_traceback()')
run('import faulthandler, sys\nfaulthandler.enable()\nprint(faulthandler.is_enabled())')
os.unlink(os.path.join(directory, 'child.py')); os.rmdir(directory)
