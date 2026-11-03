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
    "bom_parser.py": b"\xef\xbb\xbfx y\n",
    "bom2.py": b"\xef\xbb\xbfx = 1\nreturn 1\n",
    "long.py": "x = " + "1 + " * 400 + "1; return\n",
    "long_parser.py": "x = " + "1 + " * 400 + "1 1\n",
    "crlf.py": b"x = 1\r\nreturn 2\r\ny = 3\r\n",
    "crlf_parser.py": b"x = 1\r\ny z\r\n",
    "cr.py": b"x = 1\rreturn 2\ry = 3\r",
    "noeol.py": "x = 1\nreturn 2",
    "noeol_parser.py": "x = 1\ny z",
    "tabs.py": "if 1:\n\t\treturn 2\n",
    "formfeed.py": "\x0creturn 2\n",
    "badutf8.py": b"# c\ny = '\xff'\n",
    "badutf8_comment.py": b"x = 1\ny = 2\n# \xff\n",
    "badcoding.py": b"# coding: no-such-codec\nx = 1\n",
    "badlatin.py": b"# coding: ascii\nx = '\xe9'\n",
}
for name, content in CASES.items():
    script(name, content)
    run(name, [name], env=with_hook)
show_results()
