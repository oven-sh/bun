# Errors in programs that are files: the line that is shown is read from the file, in its encoding; how the interpreter prints them; options.
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

tmp = os.path.realpath(tempfile.mkdtemp())
environment = {name: value for name, value in os.environ.items() if not name.startswith("PYTHON")}
environment["PYTHONDONTWRITEBYTECODE"] = "1"
environment["PYTHONIOENCODING"] = "utf-8"


def shown(data):
    return data.decode("utf-8", "backslashreplace").replace(tmp, "<tmp>").replace(sys._stdlib_dir, "<lib>").rstrip()


# Four at a time; what they print is shown at the end, in the order in which they were asked for.
pool = ThreadPoolExecutor(4)
pending = []


def run(title, arguments, **options):
    options.setdefault("env", environment)
    pending.append((title, pool.submit(subprocess.run, [sys.executable, *arguments], cwd=tmp, capture_output=True, **options)))


def show_results():
    for title, future in pending:
        result = future.result()
        print("==", title, result.returncode)
        for name, data in (("out", result.stdout), ("err", result.stderr)):
            if data:
                print(name + ":", shown(data))


def script(name, content):
    with open(os.path.join(tmp, name), "wb") as f:
        f.write(content if isinstance(content, bytes) else content.encode())
    return name


HOOK = """
import sys
def hook(t, e, tb):
    print(t.__name__, e.args[0], e.args[1][1:] if len(e.args) > 1 else None, e._metadata)
sys.excepthook = hook
"""
script("sitecustomize.py", HOOK)
with_hook = dict(environment, PYTHONPATH=tmp)

# What the parser finds, and what the compiler finds after it
CASES = {
    "parser.py": "x = 1\ny = (2 3)\n",
    "compiler.py": "x = 1\ndef f():\n    return 1\n    yield\n    nonlocal zzz\n",
    "symtable.py": "def f(a, a): pass\n",
    "return.py": "x = 1\n   \nreturn 3  # here\n",
    "await.py": "def f():\n    await x\n",
    "break.py": "if 1:\n\tbreak\n",
    "future.py": "x = 1\nfrom __future__ import annotations\n",
    "future2.py": "from __future__ import nothing_like_it\n",
    "star.py": "def f():\n    from os import *\n",
    "global.py": "def f():\n    x = 1\n    global x\n",
    "latin1.py": "# coding: latin-1\nx = '\xe9\xe8' ; return\n".encode("latin-1"),
    "latin1_parser.py": "# coding: latin-1\nx = '\xe9\xe8' 3\n".encode("latin-1"),
    "utf8.py": "x = '\xe9\u20ac\U0001f600' ; return\n",
    "utf8_parser.py": "x = '\xe9\u20ac\U0001f600' 3\n",
    "bom.py": b"\xef\xbb\xbfreturn 1\n",
}
for name, content in CASES.items():
    script(name, content)
    run(name, [name], env=with_hook)
show_results()
