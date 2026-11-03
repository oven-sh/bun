# The command line where it meets the system: bytes that are not UTF-8, streams that are closed, where sys.path comes from.
import os
import subprocess
import sys
import tempfile

tmp = os.path.realpath(tempfile.mkdtemp())
environment = {name: value for name, value in os.environ.items() if not name.startswith("PYTHON")}
environment["PYTHONDONTWRITEBYTECODE"] = "1"
library = sys._stdlib_dir


def shown(data):
    text = data.decode("utf-8", "backslashreplace")
    return text.replace(sys.executable, "<python>").replace(tmp, "<tmp>").replace(os.path.dirname(tmp), "<above>").replace(library, "<lib>").rstrip()


def run(title, arguments, program=None, **options):
    options.setdefault("env", environment)
    result = subprocess.run([program or sys.executable, *arguments], cwd=tmp, capture_output=True, **options)
    print("==", title, result.returncode)
    for name, data in (("out", result.stdout), ("err", result.stderr)):
        if data:
            print(name + ":", shown(data))


SHOW = "import sys, os; print(ascii(sys.argv[1:]), [os.fsencode(a) for a in sys.argv[1:]])"
odd = b"\xff\xc3\xff\xc3\xa9\xed\xa0\x80\xfd\xbf\xbf\xbb\xba\xba"
run("arguments", ["-c", SHOW, "e:\xe9, euro:\u20ac, non-bmp:\U0010ffff".encode(), odd, b"", b"\x80"])
run("orig_argv", ["-c", "import sys; print(ascii(sys.orig_argv[1:]))", odd])
run("-c", [b"-c", b'print(ascii("' + b"\xff" + b'"))'])
run("-c with a valid character", [b"-c", 'print(ascii("\xe9\u20ac"))'.encode()])
run("-m", [b"-m", b"nothing\xff"])
run("-W", [b"-W", b"error::\xff", "-c", "import sys; print(ascii(sys.warnoptions))"])
run("-X", [b"-X", b"a=\xff", "-c", "import sys; print(ascii(sys._xoptions))"])

name = os.fsencode(tmp) + b"/s\xe7w\xf0.py"
with open(name, "w") as f:
    f.write("import sys, os\nprint(ascii(os.path.basename(__file__)), ascii(os.path.basename(sys.argv[0])), ascii(os.path.basename(__spec__.origin) if __spec__ else None))\n1/0\n")
run("a script", [name])
run("a script that is not there", [os.fsencode(tmp) + b"/no\xff.py"])
directory = os.fsencode(tmp) + b"/d\xff"
os.mkdir(directory)
with open(directory + b"/__main__.py", "w") as f:
    f.write("import sys, os; print(ascii(os.path.basename(sys.path[0])), ascii(os.path.basename(sys.argv[0])))\nimport other\n")
with open(directory + b"/other.py", "w") as f:
    f.write("import os; print(ascii(__file__[-12:]))\n")
run("a directory", [directory])
result = subprocess.run([sys.executable, "-c", "import sys, os, other; print(ascii(os.path.basename(os.getcwd())), repr(sys.path[0]))"], cwd=directory, env=environment, capture_output=True)
print("== in such a directory", result.returncode, shown(result.stdout), shown(result.stderr))
result = subprocess.run([sys.executable, "-m", "other"], cwd=directory, env=environment, capture_output=True)
print("== -m in such a directory", result.returncode, shown(result.stdout), shown(result.stderr))
run("PYTHONPATH", ["-c", "import sys; print(ascii(sys.path[:6]))"], env={**environment, "PYTHONPATH": os.fsdecode(b"/a:rel:../up::/b\xff")})

result = subprocess.run([sys.executable, "-X", "importtime=2", "-c", "import sys, types\nname = 'mod\\ud800'\nsys.modules[name] = types.ModuleType(name)\n__import__(name)\ntry:\n    __import__('nonexistent\\ud800')\nexcept ModuleNotFoundError as e:\n    print(ascii(e.name))"], cwd=tmp, env=environment, capture_output=True)
print("== importtime", result.returncode, shown(result.stdout), [line.split(b"|")[-1].strip() for line in result.stderr.splitlines() if b"ud800" in line])

run("displayhook", ["-i", "-q"], input=b"'a=\\xe9 b=\\udc80 c=\\U00010000 d=\\U0010ffff'\n", env={**environment, "PYTHONIOENCODING": "latin-1", "PYTHON_BASIC_REPL": "1"})
run("displayhook ascii", ["-i", "-q"], input=b"'a=\\xe9'\n[_]\n", env={**environment, "PYTHONIOENCODING": "ascii", "PYTHON_BASIC_REPL": "1"})

# Streams that are closed when the program starts.
report = os.path.join(tmp, "report")
STREAMS = "import sys; open(%r, 'w').write(repr([s and (s.name, s.mode) for s in (sys.stdin, sys.stdout, sys.stderr, sys.__stdin__, sys.__stdout__, sys.__stderr__)])); print('x'); print('y', file=sys.stderr)" % report
for closed in ("0", "1", "2", "0 1", "1 2", "0 1 2"):
    redirections = " ".join(("%s<&-" if n == "0" else "%s>&-") % n for n in closed.split())
    result = subprocess.run(["/bin/sh", "-c", 'exec "$0" -c "$1" ' + redirections, sys.executable, STREAMS], cwd=tmp, env=environment, capture_output=True, stdin=subprocess.DEVNULL)
    print("== closed:", closed, result.returncode, shown(result.stdout), shown(result.stderr), open(report).read())
result = subprocess.run(["/bin/sh", "-c", 'exec "$0" -c "1/0" 2>&-', sys.executable], cwd=tmp, env=environment, capture_output=True)
print("== an exception and no stderr", result.returncode)
result = subprocess.run(["/bin/sh", "-c", 'exec "$0" -c "input()" <&-', sys.executable], cwd=tmp, env=environment, capture_output=True)
print("== input() and no stdin", result.returncode, shown(result.stderr).splitlines()[-1])

# python3._pth
for title, lines in (("plain", ["#.", "# ..", library, ".", "..", "sub/dir  # comment", "", "/abs"]), ("with site", [library, "import site", "x"]), ("another import", [library, "import os"])):
    where = os.path.join(tmp, "pth-" + title.replace(" ", "-"))
    os.mkdir(where)
    program = os.path.join(where, "python3")
    os.symlink(sys.executable, program)
    with open(program + "._pth", "w") as f:
        f.write("\n".join(lines) + "\n")
    run("._pth " + title, ["-c", "import sys; f = sys.flags; print([p for p in sys.path if 'site-packages' not in p], f.isolated, f.ignore_environment, f.no_site, f.no_user_site, f.safe_path, 'site' in sys.modules, sys.prefix, sys.exec_prefix, sys.base_prefix)"],
        program=program, env={**environment, "PYTHONPATH": "from-env", "PYTHONHOME": "/nowhere"})

# No standard library.
result = subprocess.run([sys.executable, "-X", "frozen_modules=off", "-c", "pass"], cwd=tmp, env={**environment, "PYTHONHOME": "/nonexistent-python-path", "PYTHONPATH": "/p"}, capture_output=True)
wanted = ("WARN", "Python path", "  PYTHONHOME", "  PYTHONPATH", "  isolated", "  environment", "  user site", "  safe_path", "  import site", "  is in build", "  stdlib dir", "  sys.path[0]", "  sys.base_prefix", "  sys.prefix", "  sys.platlibdir", "Fatal", "Python runtime", "ModuleNotFound")
print("== no library", result.returncode)
print("\n".join(line for line in shown(result.stderr).splitlines() if line.startswith(wanted)))

import shutil
shutil.rmtree(os.fsencode(tmp))
