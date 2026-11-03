# Tracebacks of programs run from files, -c, -m and stdin; options that change them.
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
# The same when imported, and compiled with the name of a file that says something else
script("importer.py", "import compiler\n")
run("imported", ["-S", "importer.py"])
script("other.py", "first line\nsecond line\nthird line\n")
run("compile() with the name of a file", ["-S", "-c", """
for source in ("x = 1\\nreturn\\n", "x = 1\\ny z\\n", "\\n\\n\\n\\n\\nreturn\\n"):
    for name in ("other.py", "missing.py", "<other.py>", ""):
        try:
            compile(source, name, "exec")
        except SyntaxError as e:
            print(repr(name), e.args)
"""])

# Tracebacks: -X no_debug_ranges, PYTHONNODEBUGRANGES, a file that has changed or gone
script("raises.py", "def f(a, b):\n    return (a +\n            b / 0)\nf(1,\n  2)\n")
run("carets", ["-S", "raises.py"])
run("-X no_debug_ranges", ["-S", "-X", "no_debug_ranges", "raises.py"])
run("PYTHONNODEBUGRANGES", ["-S", "raises.py"], env=dict(environment, PYTHONNODEBUGRANGES="1"))
run("co_positions", ["-S", "-X", "no_debug_ranges", "-c", "def f(): return 1 + 2\nprint(sorted(set(f.__code__.co_positions()), key=str))"])
script("vanishes.py", "import os\ndef f():\n    os.unlink(__file__)\n    1 / 0\nf()\n")
run("the file is gone", ["-S", "vanishes.py"])
script("changes.py", "def f():\n    open(__file__, 'w').write('# nothing\\n# here\\n# now\\n# at all\\n# really\\n')\n    1 / 0\nf()\n")
run("the file has changed", ["-S", "changes.py"])
run("-c", ["-S", "-c", "def f():\n    1 / 0\nf()"])
run("-c: syntax", ["-S", "-c", "x = 1\ny z"])
run("stdin", ["-S", "-"], input=b"def f():\n    1 / 0\nf()\n")
run("stdin: syntax", ["-S"], input=b"x = 1\ny z\n")
run("-m", ["-S", "-m", "raises"])
run("-m: syntax", ["-S", "-m", "parser"])
show_results()
