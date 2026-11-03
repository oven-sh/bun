# _remote_debugging: what asyncio.tools imports from it. (Reading another process is another matter.)
import _remote_debugging as r
for name, fields in (("FrameInfo", 4), ("LocationInfo", 4), ("CoroInfo", 2), ("TaskInfo", 4), ("ThreadInfo", 3), ("InterpreterInfo", 2), ("AwaitedInfo", 2), ("GCStatsInfo", 10)):
    cls = getattr(r, name)
    value = cls(range(fields))
    print(cls.__module__, cls.__name__, cls.n_fields, cls.__match_args__, value, tuple(value))
print([(n, getattr(r, n)) for n in sorted(dir(r)) if n.startswith("THREAD_STATUS")])
print(r.FrameInfo(("f.py", r.LocationInfo((1, 1, 0, 5)), "f", None)).location.lineno)
import os, subprocess, sys
child = subprocess.Popen([sys.executable, "-c", "input()"], stdin=subprocess.PIPE)
print(child.pid in r.get_child_pids(os.getpid()), child.pid in r.get_child_pids(os.getpid(), recursive=False), r.get_child_pids(child.pid))
child.communicate(b"\n")
for bad in ("x", None):
    try:
        r.get_child_pids(bad)
    except TypeError as e:
        print(type(e).__name__)
import asyncio.tools
print(asyncio.tools.FrameInfo is r.FrameInfo)
