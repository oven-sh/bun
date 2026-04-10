#!/usr/bin/env python3
import pty
import os
import sys
import select
import signal

def waitForReady():
    buffer = b""
    while b"%ready%" not in buffer:
        ready = select.select([master_fd], [], [], 0.1)[0]
        if ready:
            data = os.read(master_fd, 1024)
            if data:
                buffer += data
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()

def waitAndWrite(b):
    waitForReady()
    os.write(master_fd, b)

def timeout_handler(signum, frame):
    try:
        os.kill(pid, 9)
    except:
        pass
    sys.exit(1)

command = sys.argv[1:]
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
else:
    os.close(slave_fd)
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(5)

    # Parent: trigger first 'readable' (parent drains '1', then removes listener)
    waitAndWrite(b'1')
    # Child spawned and wrote %ready%. The parent may buffer at most one chunk
    # before backpressure releases fd 0, so the first byte sent here may be
    # swallowed silently. Don't wait for an echo between bytes.
    waitForReady()
    for b in (b'A', b'B', b'C', b'D', b'E'):
        os.write(master_fd, b)
        # Drain any output but don't require %ready% (the first byte may be
        # buffered in the parent with no echo).
        deadline = 0.1
        while deadline > 0:
            ready = select.select([master_fd], [], [], 0.05)[0]
            deadline -= 0.05
            if ready:
                data = os.read(master_fd, 1024)
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
    os.write(master_fd, b'\x03')
    waitForReady()

    _, status = os.waitpid(pid, 0)
    os.close(master_fd)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
