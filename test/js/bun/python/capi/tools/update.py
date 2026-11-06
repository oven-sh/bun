#!/usr/bin/env python3
"""update.py --oracle PYTHON3.15 [NAME...]: asks CPython again, and writes NAME.expected.

Each NAME.c is compiled against the headers of that CPython, for abi3t, and NAME.py is run by it. With --ours BUN it is compiled against include/
instead and run by Bun, nothing is written, and the differences are shown."""
import argparse, difflib, os, subprocess, sys, sysconfig, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

parser = argparse.ArgumentParser()
parser.add_argument("--oracle", default=os.environ.get("PYTHON_ORACLE"))
parser.add_argument("--ours", default=None)
parser.add_argument("names", nargs="*")
args = parser.parse_args()
names = args.names or sorted(f[:-3] for f in os.listdir(HERE) if f.endswith(".py"))
compiler = os.environ.get("CC", "cc")
status = 0

with tempfile.TemporaryDirectory() as directory:
    for name in names:
        library = f"{directory}/lib{name}.so"
        if args.ours:
            flags = ["-I", f"{HERE}/include"]
            command = [args.ours, f"{HERE}/{name}.py", library]
        else:
            include = subprocess.run([args.oracle, "-c", "import sysconfig; print(sysconfig.get_path('include'))"], capture_output=True, text=True, check=True).stdout.strip()
            flags = ["-DPy_TARGET_ABI3T=0x030f0000", "-I", include]
            command = [args.oracle, "-I", "-X", "utf8", f"{HERE}/{name}.py", library]
        subprocess.run([compiler, "-O1", "-g", "-fPIC", "-shared", "-Wall", "-Wextra", "-Werror", *flags, f"{HERE}/{name}.c", "-o", library], check=True)
        run = subprocess.run(command, capture_output=True, text=True, cwd=directory)
        if run.returncode or run.stderr:
            print(f"{name}: status {run.returncode}\n{run.stderr}", file=sys.stderr)
            status = 1
        if not args.ours:
            if not run.returncode:
                open(f"{HERE}/{name}.expected", "w").write(run.stdout)
            continue
        expected = open(f"{HERE}/{name}.expected").read()
        if run.stdout != expected:
            status = 1
            sys.stdout.writelines(difflib.unified_diff(expected.splitlines(True), run.stdout.splitlines(True), "CPython", "Bun", n=1))
sys.exit(status)
