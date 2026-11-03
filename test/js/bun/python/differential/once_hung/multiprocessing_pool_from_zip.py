# test_multiprocessing_main_handling.SpawnCmdLineTest.test_zipfile: a Pool (spawn) in the __main__.py of an archive never delivers
import os, subprocess, sys, tempfile, zipfile
d = tempfile.mkdtemp()
with zipfile.ZipFile(d + "/app.zip", "w") as z:
    z.writestr("__main__.py", """
import multiprocessing
multiprocessing.set_start_method("spawn")
with multiprocessing.Pool(2) as pool:
    print(pool.map(int, [1, 2, 3]))
""")
p = subprocess.run([sys.executable, d + "/app.zip"], capture_output=True, text=True, timeout=300)
print(p.stdout, p.stderr[-600:], p.returncode)
