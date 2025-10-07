#!/usr/bin/env python3
import pty
import os
import sys
import time
import select
import signal

def waitForReady():
    # Wait for "%ready%" in stdout
    buffer = b""
    print("PYTHON: waiting for ready", flush=True)
    while b"%ready%" not in buffer:
        ready = select.select([master_fd], [], [], 0.1)[0]
        if ready:
            data = os.read(master_fd, 1024)
            if data:
                buffer += data
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()

def waitAndWrite(bytes):
    waitForReady()
    print("PYTHON: sending", flush=True)

    # Write and flush
    os.write(master_fd, bytes)

def timeout_handler(signum, frame):
    print("PYTHON: timeout", flush=True)
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
    signal.alarm(3)  # 3 second timeout

    # Send to parent
    waitAndWrite(b'1')
    waitAndWrite(b'2')
    waitAndWrite(b'3')
    # Send Enter to pause parent and spawn child
    waitAndWrite(b'\r\n')
    # Send to child
    waitAndWrite(b'A')
    waitAndWrite(b'B')
    waitAndWrite(b'C')
    waitAndWrite(b'D')
    waitAndWrite(b'E')
    waitAndWrite(b'F')
    waitAndWrite(b'G')
    # Kill child; return to parent
    waitAndWrite(b'\r\n')
    # Send to parent
    waitAndWrite(b'4')
    waitAndWrite(b'5')
    waitAndWrite(b'6')
    # Pause parent and spawn child
    waitAndWrite(b'\r\n')
    # Send to child
    waitAndWrite(b'H')
    waitAndWrite(b'I')
    waitAndWrite(b'J')
    waitAndWrite(b'K')
    waitAndWrite(b'L')
    waitAndWrite(b'M')
    waitAndWrite(b'N')
    waitAndWrite(b'O')
    waitAndWrite(b'P')
    # Kill child; return to parent
    waitAndWrite(b'\r\n')
    # Kill parent
    waitAndWrite(b'\x03')
    # Read remaining output
    waitForReady()

    # Wait for process to exit
    print("PYTHON: waiting for exit", flush=True)
    _, status = os.waitpid(pid, 0)
    print("PYTHON: process exited", flush=True)
    os.close(master_fd)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
