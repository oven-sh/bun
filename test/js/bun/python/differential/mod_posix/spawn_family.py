# os.spawnv() and its kin, which os.py writes with fork() and the module posix has here.
import os, sys
print(os.P_WAIT, os.P_NOWAIT, os.P_NOWAITO)
print([n for n in dir(os) if n.startswith("spawn")])
print(os.spawnv(os.P_WAIT, "/bin/sh", ["sh", "-c", "exit 7"]))
print(os.spawnve(os.P_WAIT, "/bin/sh", ["sh", "-c", "exit $X"], {"X": "9"}))
print(os.spawnvp(os.P_WAIT, "sh", ["sh", "-c", "exit 3"]))
print(os.spawnvpe(os.P_WAIT, "sh", ["sh", "-c", "exit $X"], {"X": "4", "PATH": "/bin"}))
print(os.spawnvpe(os.P_WAIT, "sh", ["sh", "-c", "exit $X"], {"X": "4", "PATH": "/nowhere"}))
print(os.spawnl(os.P_WAIT, "/bin/sh", "sh", "-c", "exit 5"), os.spawnle(os.P_WAIT, "/bin/sh", "sh", "-c", "exit $Y", {"Y": "6"}))
print(os.spawnlp(os.P_WAIT, "sh", "sh", "-c", "exit 8"), os.spawnlpe(os.P_WAIT, "sh", "sh", "-c", "exit $Y", {"Y": "2", "PATH": "/bin"}))
print(os.spawnv(os.P_WAIT, "/nonexistent", ["x"]))
print(os.spawnv(os.P_WAIT, "/bin/sh", ["sh", "-c", "kill -9 $$"]))
pid = os.spawnv(os.P_NOWAIT, "/bin/sh", ["sh", "-c", "exit 11"])
print(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
pid = os.spawnv(os.P_NOWAIT, "/nonexistent", ["x"])
print(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
for args in ((os.P_WAIT, "/bin/sh", ()), (os.P_WAIT, "/bin/sh", []), (os.P_WAIT, "/bin/sh", ("",)), (os.P_WAIT, "/bin/sh", [""]), (os.P_WAIT, "/bin/sh", "sh"), (os.P_WAIT, "/bin/sh", None)):
    try:
        print(os.spawnv(*args))
    except (ValueError, TypeError) as e:
        print(type(e).__name__, e)
for env in ({"A\0B": "c"}, {"A": "b\0c"}, {"A=B": "c"}):
    try:
        print(os.spawnve(os.P_WAIT, "/bin/true", ["true"], env))
    except ValueError as e:
        print("ValueError", e)
