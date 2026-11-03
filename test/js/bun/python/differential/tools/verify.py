#!/usr/bin/env python3
"""Checks the tests themselves against the oracle: status 0 (unless the name says otherwise), the same output twice,
no addresses in the output, no imports but sys (a test about the import statement itself says "# verify: fake imports").
The same checks are made on the split version (see split.py), in which no guard may fire.
usage: verify.py [--runs N] [files...]      (N runs of each test must agree; 2 by default; CPython is $PYTHON_ORACLE, or python3.15)"""
import glob, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORACLE = [os.environ.get('PYTHON_ORACLE', 'python3.15'), '-I', '-X', 'utf8']
SCRATCH = tempfile.TemporaryDirectory(prefix='python-verify-')
RUNS = 2
if sys.argv[1:2] == ['--runs']:
    RUNS = int(sys.argv[2])
    del sys.argv[1:3]
files = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, 'lang', '*.py')))
def one(f):
    out = check(f)
    if os.path.dirname(os.path.abspath(f)) not in (os.path.join(HERE, 'lang'), os.path.join(HERE, 'slow')):
        return out
    split = os.path.join(SCRATCH.name, os.path.basename(f))
    p = subprocess.run([ORACLE[0], '-I', os.path.join(HERE, 'tools', 'split.py'), f, split], stdin=subprocess.DEVNULL, capture_output=True)
    if p.returncode != 0:
        return out + ['split.py failed: %r' % p.stderr.splitlines()[-1:]]
    return out + ['(split) ' + x for x in check(split, True)]
def check(f, is_split=False):
    out = []
    runs = []
    for _ in range(RUNS):
        env = {k: v for k, v in os.environ.items() if not k.startswith('PYTHON')}
        try:
            p = subprocess.run(ORACLE + [os.path.basename(f)], cwd=os.path.dirname(os.path.abspath(f)), stdin=subprocess.DEVNULL, capture_output=True, timeout=20, env=env)
        except subprocess.TimeoutExpired:
            return ['timeout']
        runs.append((p.returncode, p.stdout, p.stderr.splitlines()[-1:] ))
    other = next((r for r in runs if r != runs[0]), None)
    if other is not None:
        a, b = runs[0][1].splitlines(), other[1].splitlines()
        d = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
        out.append('not deterministic at line %d: %r' % (d + 1, a[d][:100] if d < len(a) else None))
    rc, so, se = runs[0]
    expect_failure = '_exit' in os.path.basename(f) or '_uncaught' in os.path.basename(f)
    if rc != 0 and not expect_failure:
        out.append('status %d: %s' % (rc, se))
    if rc == 0 and expect_failure:
        out.append('status 0 but the name says it fails')
    if re.search(rb'at 0x[0-9a-f]{6,}', so):
        m = re.search(rb'.*at 0x[0-9a-f]{6,}.*', so)
        out.append('address in output: %r' % m.group(0)[:100])
    if is_split and b'<!' in so and any(l.startswith(b'<!') or b' <!' in l for l in so.splitlines() if b'> in: ' in l):
        out.append('a guard fired: %r' % next(l for l in so.splitlines() if b'<!' in l and b'> in: ' in l)[:120])
    src = open(f, encoding='utf-8').read()
    for m in re.finditer(r'^\s*(?:import|from)\s+(\w+)', src, re.M):
        if m.group(1) not in ('sys', '__future__') and '# verify: fake imports' not in src:
            out.append('imports %s' % m.group(1))
    n = src.count('\n')
    if not so.strip() and not expect_failure:
        out.append('prints nothing')
    return out
bad = 0
with ThreadPoolExecutor(16) as ex:
    for f, problems in zip(files, ex.map(one, files)):
        for p in problems:
            bad += 1
            print(os.path.basename(f), p)
print('%d files, %d problems' % (len(files), bad))
