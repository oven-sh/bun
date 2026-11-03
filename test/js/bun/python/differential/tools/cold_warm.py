#!/usr/bin/env python3
"""Runs each test of ../lang (or the files given) as a module, twice: the first run compiles it and writes the .pyc file, the
second loads that. Both must print the same. usage: cold_warm.py [-j N] [--ours cmd] [files...]"""
import argparse, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
here = os.path.dirname(os.path.abspath(__file__))
p = argparse.ArgumentParser()
p.add_argument("-j", type=int, default=8)
p.add_argument("--ours", default=os.environ.get("BUN_EXE", "bun"))
p.add_argument("--timeout", type=int, default=300)
p.add_argument("files", nargs="*")
a = p.parse_args()
files = a.files or sorted(os.path.join(here, "..", "lang", f) for f in os.listdir(os.path.join(here, "..", "lang")) if f.endswith(".py"))
env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
def normalize(text):
    text = re.sub(r"0x[0-9a-f]{6,}", "0xADDR", text)
    # What the compiler has to say about the module it says when it compiles it, as in CPython.
    return re.sub(r"^/tmp/coldwarm-[^\n]*: SyntaxWarning: [^\n]*\n(  [^\n]*\n)?", "", text, flags=re.M)
def one(path):
    name = "t_" + re.sub(r"\W", "_", os.path.basename(path)[:-3])
    with tempfile.TemporaryDirectory(prefix="coldwarm-") as d:
        shutil.copy(path, os.path.join(d, name + ".py"))
        for extra in os.listdir(os.path.dirname(path)):
            if extra.startswith(os.path.basename(path)[:-3] + ".") and not extra.endswith(".py"):
                shutil.copy(os.path.join(os.path.dirname(path), extra), d)
        open(os.path.join(d, "main.py"), "w").write(f"import {name}\n")
        runs = []
        for i in range(2):
            try:
                r = subprocess.run([a.ours, "main.py"], cwd=d, env=env, capture_output=True, text=True, errors="replace", timeout=a.timeout)
                runs.append((r.returncode, normalize(r.stdout), normalize(r.stderr)))
            except subprocess.TimeoutExpired:
                runs.append(("timeout", "", ""))
            if i == 0:
                cache = os.path.join(d, "__pycache__")
                written = os.path.isdir(cache) and any(f.startswith(name + ".") for f in os.listdir(cache))
        return os.path.basename(path), runs, written
bad = 0
with ThreadPoolExecutor(a.j) as ex:
    for name, (cold, warm), written in ex.map(one, files):
        if cold == warm and (written or "Error: " in cold[2].splitlines()[-1:][0] if cold[2] else written):
            continue
        bad += 1
        if not written:
            print(f"FAIL {name}: no .pyc file was written (status {cold[0]}) {cold[2][-200:]!r}")
            continue
        for what, x, y in zip(("status", "stdout", "stderr"), cold, warm):
            if x != y:
                xs, ys = str(x).splitlines(), str(y).splitlines()
                for i, (l, m) in enumerate(zip(xs + [""] * len(ys), ys + [""] * len(xs))):
                    if l != m:
                        print(f"FAIL {name}: {what} line {i + 1}: cold {l[:110]!r} | warm {m[:110]!r}")
                        break
                break
print(f"same cold and warm: {len(files) - bad}/{len(files)}")
