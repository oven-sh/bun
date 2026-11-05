# The key that hash(str) depends on belongs to the process: threads share it, and a new process has another unless PYTHONHASHSEED says which.
import os, subprocess, sys, threading

TEXTS = "['abc', 'é', '€', '\\U0001f600', 'x' * 100, b'abc', ('a', b'b'), frozenset('ab')]"
SHOW = "print([hash(v) for v in %s])" % TEXTS
NESTED = "import subprocess, sys\n%s\nsys.stdout.flush()\nsubprocess.run([sys.executable, '-c', %r])" % (SHOW, SHOW)

def run(code, seed, *options):
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONHASHSEED'}
    if seed is not None: env['PYTHONHASHSEED'] = seed
    return subprocess.run([sys.executable, *options, '-c', code], env=env, capture_output=True, text=True).stdout.splitlines()

for seed in ('0', '7', '4294967295'):
    lines = run(NESTED, seed)
    print(seed, len(lines), lines[0] == lines[1], lines[0] == run(SHOW, seed)[0], lines[0])
lines = run(NESTED, None)
print('no seed', len(lines), lines[0] == lines[1], lines[0] == run(SHOW, None)[0])
lines = run(NESTED, 'random')
print('random', len(lines), lines[0] == lines[1])
# The child does not hear of -R, -E or -I, but it has the environment.
for options in (('-R',), ('-E',), ('-I',)):
    lines = run(NESTED, '7', *options)
    print(options, len(lines), lines[0] == lines[1], lines[1] == run(SHOW, '7')[0])

mine = [hash(v) for v in eval(TEXTS)]
seen = []
threads = [threading.Thread(target=lambda: seen.append([hash(v) for v in eval(TEXTS)])) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print(len(seen), all(s == mine for s in seen))
