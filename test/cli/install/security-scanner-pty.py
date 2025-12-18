#!/usr/bin/env python3
"""
PTY wrapper for security scanner TTY tests.

This script creates a pseudo-terminal and runs bun install with security scanner
configured. It allows testing the interactive prompt behavior when warnings are found.

Usage: python3 security-scanner-pty.py <bun_executable> <cwd> <response>

Where:
  - bun_executable: Path to the bun executable
  - cwd: Working directory for the install command
  - response: One of 'y', 'n', 'Y', 'N', 'enter', 'timeout', 'other'
"""
import pty
import os
import sys
import select
import signal
import time

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 security-scanner-pty.py <bun_exe> <cwd> <response>", file=sys.stderr)
        sys.exit(1)

    bun_exe = sys.argv[1]
    cwd = sys.argv[2]
    response = sys.argv[3]

    # Open a pseudo-terminal
    master_fd, slave_fd = pty.openpty()

    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)
        os.setsid()

        # Redirect stdin/stdout/stderr to the slave PTY
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        if slave_fd > 2:
            os.close(slave_fd)

        os.chdir(cwd)
        os.execvp(bun_exe, [bun_exe, "install"])
    else:
        # Parent process
        os.close(slave_fd)

        # Set up timeout handler
        def timeout_handler(signum, frame):
            print("PTY_TIMEOUT", flush=True)
            try:
                os.kill(pid, signal.SIGKILL)
            except:
                pass
            sys.exit(1)

        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(30)  # 30 second timeout

        output = b""
        prompt_found = False

        try:
            while True:
                # Wait for data from the child process
                ready = select.select([master_fd], [], [], 0.1)[0]

                if ready:
                    try:
                        data = os.read(master_fd, 4096)
                        if data:
                            output += data
                            # Print output for debugging
                            sys.stdout.buffer.write(data)
                            sys.stdout.buffer.flush()

                            # Check if we see the prompt
                            if b"Continue anyway? [y/N]" in output and not prompt_found:
                                prompt_found = True
                                print("\nPTY_PROMPT_DETECTED", flush=True)

                                # Small delay to ensure the prompt is fully displayed
                                time.sleep(0.1)

                                # Send the response based on the argument
                                if response == "y":
                                    os.write(master_fd, b"y\n")
                                elif response == "Y":
                                    os.write(master_fd, b"Y\n")
                                elif response == "n":
                                    os.write(master_fd, b"n\n")
                                elif response == "N":
                                    os.write(master_fd, b"N\n")
                                elif response == "enter":
                                    os.write(master_fd, b"\n")
                                elif response == "other":
                                    os.write(master_fd, b"x\n")
                                elif response == "timeout":
                                    # Don't send anything, let it hang
                                    pass
                                else:
                                    os.write(master_fd, response.encode() + b"\n")

                                print(f"PTY_SENT_RESPONSE: {response}", flush=True)
                        else:
                            # EOF from child
                            break
                    except OSError:
                        break

                # Check if child has exited
                result = os.waitpid(pid, os.WNOHANG)
                if result[0] != 0:
                    # Read any remaining output
                    try:
                        while True:
                            ready = select.select([master_fd], [], [], 0.1)[0]
                            if ready:
                                data = os.read(master_fd, 4096)
                                if data:
                                    output += data
                                    sys.stdout.buffer.write(data)
                                    sys.stdout.buffer.flush()
                                else:
                                    break
                            else:
                                break
                    except:
                        pass
                    break

        except Exception as e:
            print(f"PTY_ERROR: {e}", file=sys.stderr, flush=True)

        finally:
            signal.alarm(0)  # Cancel timeout
            os.close(master_fd)

        # Wait for child to fully exit and get exit code
        try:
            _, status = os.waitpid(pid, 0)
            exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
        except ChildProcessError:
            # Already reaped
            exit_code = 0

        print(f"\nPTY_EXIT_CODE: {exit_code}", flush=True)

        if not prompt_found:
            print("PTY_NO_PROMPT_FOUND", flush=True)

        sys.exit(exit_code)

if __name__ == "__main__":
    main()
