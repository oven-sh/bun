#!/usr/bin/env python3
# Drives `bun --hot <fixture>` inside a pseudo-terminal so readline runs in
# terminal mode (emitKeypressEvents + raw mode), types a line, rewrites the
# fixture to trigger a hot reload, then types another line. The test asserts
# on the child's stdout, which this script forwards verbatim.
import os
import pty
import re
import select
import signal
import sys
import time

command = sys.argv[1:]
fixture = sys.argv[-1]

master_fd, slave_fd = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master_fd)
    os.setsid()
    os.dup2(slave_fd, 0)
    os.dup2(slave_fd, 1)
    os.dup2(slave_fd, 2)
    if slave_fd > 2:
        os.close(slave_fd)
    os.execvp(command[0], command)

os.close(slave_fd)
buffer = b""


def wait_for(pattern, timeout=10):
    global buffer
    rx = re.compile(pattern.encode())
    deadline = time.time() + timeout
    while time.time() < deadline:
        if rx.search(buffer):
            return True
        ready = select.select([master_fd], [], [], 0.1)[0]
        if ready:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                # Linux raises EIO once the child side of the PTY is closed.
                break
            if not data:
                # macOS/BSD report EOF as an empty read instead; bail out so
                # we don't spin on a closed fd until the deadline.
                break
            buffer += data
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
    return rx.search(buffer) is not None


def terminate_handler(signum, frame):
    # The hand-rolled fork above does not give the child a controlling TTY,
    # so closing the PTY master won't SIGHUP it. If we're torn down early
    # (test-runner timeout sends SIGTERM, Ctrl+C sends SIGINT, or our own
    # SIGALRM fires), kill the `bun --hot` child explicitly so it doesn't
    # outlive the test.
    print("PYTHON: terminated by signal %d" % signum, flush=True)
    try:
        os.kill(pid, 9)
    except Exception:
        pass
    sys.exit(1)


signal.signal(signal.SIGALRM, terminate_handler)
signal.signal(signal.SIGTERM, terminate_handler)
signal.signal(signal.SIGINT, terminate_handler)
signal.alarm(30)

ok = wait_for(r"READY 1 ")
os.write(master_fd, b"hello\r")
ok = wait_for(r"ECHO 1 hello") and ok

# Trigger a hot reload by rewriting the fixture in place.
with open(fixture) as f:
    source = f.read()
with open(fixture, "w") as f:
    f.write(source)

# READY 2 is printed after createInterface() has synchronously re-wired the
# data→keypress bridge, so it is safe to type immediately once it appears.
ok = wait_for(r"READY 2 ") and ok
os.write(master_fd, b"world\r")
# Wait for any ECHO of "world" (from whichever load) or time out.
wait_for(r"ECHO \d+ world", timeout=5)
# Drain a little longer so a duplicate echo (the pre-fix bug) is captured too.
wait_for(r"\x00nevermatches\x00", timeout=1)

print("PYTHON: done", flush=True)
try:
    os.kill(pid, 9)
except Exception:
    pass
os.waitpid(pid, 0)
sys.exit(0 if ok else 1)
