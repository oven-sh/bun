# test_pdb.PdbTestCase.test_breakpoint (and 12 more): `python3 -m pdb script.py` never stops (sys.monitoring's events never fire) and then restarts the program for ever
import os, subprocess, sys, tempfile
script = os.path.join(tempfile.mkdtemp(), "main.py")
open(script, "w").write("x = 1\nprint(x)\n")
p = subprocess.run([sys.executable, "-m", "pdb", script], input="n\nq\n", capture_output=True, text=True, timeout=120)
print(p.stdout[-200:].replace(os.path.dirname(script), "TMP"), p.returncode)
