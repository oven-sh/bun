#!/usr/bin/env python3
"""check_header.py --oracle PYTHON3.15: include/declarations.h and include/numbers.h against CPython's headers for abi3t.

They are compiled after CPython's Python.h: the assertions of numbers.h have to hold there too, and C accepts a second declaration only if it agrees with the first. (Where CPython also has a macro of the name of a
function, the macro is taken away first.) Then every name that it declares is looked up in what CPython's header declares, so that nothing is in ours that
abi3t does not have."""
import argparse, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
parser = argparse.ArgumentParser()
parser.add_argument("--oracle", default=os.environ.get("PYTHON_ORACLE"))
args = parser.parse_args()
include = subprocess.run([args.oracle, "-c", "import sysconfig; print(sysconfig.get_path('include'))"], capture_output=True, text=True, check=True).stdout.strip()
compiler = os.environ.get("CC", "cc")

text = re.sub(r"/\*.*?\*/", "", open(f"{HERE}/include/declarations.h").read(), flags=re.S)
ours = set(re.findall(r"\b_?Py\w+", text)) - {"PyObject", "PyTypeObject", "Py_ssize_t", "PyType_Spec"}

with tempfile.TemporaryDirectory() as directory:
    first = "#define Py_TARGET_ABI3T 0x030f0000\n#include <Python.h>\n"
    open(f"{directory}/probe.c", "w").write(first + f'#include "{HERE}/include/numbers.h"\n' + "".join(f"#undef {name}\n" for name in sorted(ours)) + f'#include "{HERE}/include/declarations.h"\n')
    subprocess.run([compiler, "-c", "-Wall", "-Wextra", "-Werror", "-I", include, f"{directory}/probe.c", "-o", f"{directory}/probe.o"], check=True)
    open(f"{directory}/theirs.c", "w").write(first)
    theirs = set(re.findall(r"\w+", subprocess.run([compiler, "-E", "-P", "-I", include, f"{directory}/theirs.c"], capture_output=True, text=True, check=True).stdout))

unknown = sorted(ours - theirs)
print(f"{len(ours)} names declared; not in CPython's header for abi3t: {unknown or 'none'}")
sys.exit(bool(unknown))
