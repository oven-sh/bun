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
    "nul.py": b"x = '\0' nothing\n",
    "nul2.py": b"# c\n'''\ntext\0\n'''\n",
    "nul3.py": b"a = 1\n  \0x = 2\n",
    "eof.py": "x = (1,\n",
    "eof_string.py": "x = '''abc\n",
    "backslash.py": "x = 1 + \\\n",
    "backslash2.py": "x = 1 + \\ \n    2\n",
    "backslash3.py": "x = 1 + \\\n    2 + \\ \n    3\n",
    "indent.py": "if 1:\n    x\n  y\n",
    "indent2.py": "x\n    y\n",
    "tabspace.py": "if 1:\n        x\n\ty\n",
    "empty_block.py": "def f():\nx = 1\n",
    "warning_as_error.py": "x = 1\ny = 1 is 1\n",
    "escape.py": "x = 1\ny = '\\q'\n",
}
for name, content in CASES.items():
    script(name, content)
    run(name, [name], env=with_hook)
show_results()
