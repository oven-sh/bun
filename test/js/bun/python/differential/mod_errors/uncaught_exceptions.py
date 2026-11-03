# What happens to an exception nobody catches, when the means to print it are missing or fail.
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


CASES = {
    "parser.py": "x = 1\ny = (2 3)\n",
    "compiler.py": "x = 1\ndef f():\n    return 1\n    yield\n    nonlocal zzz\n",
}
for name, content in CASES.items():
    script(name, content)
script("raises.py", "def f(a, b):\n    return (a +\n            b / 0)\nf(1,\n  2)\n")
run("SystemExit with a message", ["-S", "-c", "raise SystemExit('bye')"])
run("SystemExit in a chain", ["-S", "-c", "try:\n    1 / 0\nexcept ZeroDivisionError:\n    raise SystemExit(3)"])
run("KeyboardInterrupt", ["-S", "-c", "raise KeyboardInterrupt"])
run("excepthook raises", ["-S", "-c", "import sys\ndef h(*a): raise ValueError('in hook')\nsys.excepthook = h\n1 / 0"])
run("excepthook is gone", ["-S", "-c", "import sys\ndel sys.excepthook\n1 / 0"])
run("stderr is None", ["-S", "-c", "import sys\nsys.stderr = None\n1 / 0"])
script("no_traceback.py", "import sys\nsys.modules['traceback'] = None\ndef f():\n    1 / 0\ndef g():\n    try:\n        f()\n    except ZeroDivisionError as e:\n        raise ValueError('second') from e\ng()\n")
run("traceback cannot be imported", ["-S", "no_traceback.py"])
run("tracebacklimit", ["-S", "-c", "import sys\nsys.tracebacklimit = 1\ndef f():\n    1 / 0\ndef g(): f()\ng()"])
run("tracebacklimit 0", ["-S", "-c", "import sys\nsys.tracebacklimit = 0\ndef f():\n    1 / 0\nf()"])
run("at exit", ["-S", "-c", "import traceback\nclass P:\n    def __init__(self):\n        try:\n            1 / 0\n        except Exception as e:\n            self.e = e\n            self = None\n    def __del__(self):\n        traceback.print_exception(self.e)\no = P()"])
run("colours", ["-S", "raises.py"], env=dict(environment, FORCE_COLOR="1"))
run("colours: syntax", ["-S", "parser.py"], env=dict(environment, FORCE_COLOR="1"))
show_results()
