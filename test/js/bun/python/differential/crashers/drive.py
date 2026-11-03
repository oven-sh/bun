#!/usr/bin/env python3
"""drive.py [-j N] [--ours CMD] [--timeout S] [-v] test.py...: runs each group of each test (test.py --list names them; a test without groups is one
group) under CPython and under ours, each in a process of its own. Ours must never crash or hang. Where CPython survives, the output is compared."""
import argparse, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
ORACLE = [os.environ.get('PYTHON_ORACLE', 'python3.15'), '-I', '-X', 'utf8']
ap = argparse.ArgumentParser()
ap.add_argument('-j', type=int, default=16); ap.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun')); ap.add_argument('--timeout', type=int, default=300)
ap.add_argument('-v', action='store_true'); ap.add_argument('tests', nargs='+')
a = ap.parse_args()
env = {k: v for k, v in os.environ.items() if not k.startswith('PYTHON')}
def run(cmd, timeout):
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, env=env)
        return p.returncode, re.sub(r'0x[0-9a-f]{6,}', '0xADDR', p.stdout.decode('utf-8', 'backslashreplace'))
    except subprocess.TimeoutExpired as e:
        return 'timeout', (e.stdout or b'').decode('utf-8', 'backslashreplace')
jobs = []
for t in a.tests:
    listed = '--list' in open(t).read()
    groups = run(ORACLE + [t, '--list'], 60)[1].splitlines() if listed else [None]
    seen = set()
    for g in groups:
        if g not in seen:
            seen.add(g); jobs.append((t, g))
def one(job):
    t, g = job
    args = [t] + ([g] if g is not None else [])
    return job, run(ORACLE + args, 120), run(a.ours.split() + args, a.timeout)
bad = different = same = oracle_bad = lines_different = 0
with ThreadPoolExecutor(a.j) as pool:
    for (t, g), (es, eo), (os_, oo) in pool.map(one, jobs):
        label = '%s %s' % (os.path.basename(t), g or '')
        if os_ == 'timeout' or (isinstance(os_, int) and (os_ < 0 or os_ >= 128)) or 'panic' in oo or 'AddressSanitizer' in oo or 'ASSERTION FAILED' in oo or 'runtime error:' in oo:
            # What takes for ever, or all the memory there is, in CPython too is the program's doing.
            if os_ in ('timeout', -9, 137) and es in ('timeout', -9, 137):
                oracle_bad += 1
                print('both die    ', label, 'ours', os_, 'cpython', es)
                continue
            bad += 1
            print('CRASH/HANG', label, 'status', os_, '(cpython: %s)' % es)
            print('\n'.join('      ' + l[:200] for l in oo.splitlines()[-14:]))
            continue
        if es == 'timeout' or es < 0 or es >= 128:
            oracle_bad += 1
            print('oracle dies ', label, es)
            continue
        if eo == oo and es == os_:
            same += 1
            continue
        different += 1
        el, ol = eo.splitlines(), oo.splitlines()
        d = [(x, y) for x, y in zip(el, ol) if x != y]
        lines_different += len(d) + abs(len(el) - len(ol))
        print('different   ', label, '(%d of %d lines)' % (len(d) + abs(len(el) - len(ol)), len(el)))
        for x, y in d[:(6 if a.v else 1)]:
            print('      cpython: ' + x[:190]); print('      ours:    ' + y[:190])
print('groups: %d same, %d different (%d lines), %d where CPython itself dies, %d CRASH/HANG' % (same, different, lines_different, oracle_bad, bad))
