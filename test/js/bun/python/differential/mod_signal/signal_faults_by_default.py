# The signals that tell of a fault do what they do by default until the program says otherwise, and what signal() returns can be given back.
import os, signal, subprocess, sys

names = ["SIGILL", "SIGTRAP", "SIGABRT", "SIGBUS", "SIGFPE", "SIGSEGV", "SIGSYS"]
for name in names:
    number = getattr(signal, name)
    print(name, signal.getsignal(number) is signal.SIG_DFL)
    got = []
    previous = signal.signal(number, lambda n, frame: got.append(n))
    print(previous is signal.SIG_DFL, callable(signal.getsignal(number)))
    os.kill(os.getpid(), number)
    print(got == [number])
    mine = signal.signal(number, previous)
    print(callable(mine), signal.getsignal(number) is signal.SIG_DFL)

# Put back, it kills. (Sent twice: a handler that an engine has for faults in its own code returns from one that is not, for the
# instruction to fault again with nobody handling it, which a signal that was sent does not do.)
program = "import os, signal\nold = signal.signal(signal.{0}, lambda *a: None)\nsignal.signal(signal.{0}, old)\nos.kill(os.getpid(), signal.{0})\nos.kill(os.getpid(), signal.{0})\nprint('alive')"
# (A build with a sanitizer would have that handle some of them, and exit in its own way.)
options = ":".join(filter(None, [os.environ.get("ASAN_OPTIONS"), "handle_segv=0:handle_sigbus=0:handle_sigfpe=0:handle_sigill=0:handle_abort=0"]))
for name in names:
    done = subprocess.run([sys.executable, "-c", program.format(name)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=dict(os.environ, ASAN_OPTIONS=options))
    print(name, done.returncode == -getattr(signal, name), done.stdout)
