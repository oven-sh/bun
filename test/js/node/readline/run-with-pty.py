#!/usr/bin/env python3
import pty
import os
import sys
import time
import select
import signal

def timeout_handler(signum, frame):
    try:
        os.kill(pid, 9)
    except:
        pass
    sys.exit(0)

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
    signal.alarm(1)  # 1 second timeout
    time.sleep(0.005)

    # Read initial output
    while select.select([master_fd], [], [], 0.05)[0]:
        data = os.read(master_fd, 1024)
        if data:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()

    # Send Enter
    os.write(master_fd, b'\r\n')
    time.sleep(0.005)

    # Read more
    while select.select([master_fd], [], [], 0.05)[0]:
        data = os.read(master_fd, 1024)
        if data:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()

    # Send test keys
    os.write(master_fd, b'A')
    time.sleep(0.005)
    os.write(master_fd, b'B')
    time.sleep(0.005)
    os.write(master_fd, b'C')

    # Read until exit
    no_output_count = 0
    while True:
        ready = select.select([master_fd], [], [], 0.05)[0]
        if ready:
            try:
                data = os.read(master_fd, 1024)
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                    no_output_count = 0
            except OSError:
                break
        else:
            no_output_count += 1
            if no_output_count > 10:  # 1 second of no output
                # Kill child and exit
                try:
                    os.kill(pid, 9)
                    os.waitpid(pid, 0)
                except:
                    pass
                os.close(master_fd)
                sys.exit(0)

        pid_result, status = os.waitpid(pid, os.WNOHANG)
        if pid_result != 0:
            time.sleep(0.005)
            try:
                while select.select([master_fd], [], [], 0.05)[0]:
                    data = os.read(master_fd, 1024)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
            except OSError:
                pass
            os.close(master_fd)
            sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
