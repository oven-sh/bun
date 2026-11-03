#!/usr/bin/env python3
"""fuzz_drive.py [-j N] [--ours CMD] [--seeds A-B] [--trials N] [--timeout S] [modules...]: runs fuzz_api.py; reports the last call of every process that died or hung."""
import argparse, os, subprocess, sys, tempfile, collections
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('-j', type=int, default=12); ap.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun')); ap.add_argument('--seeds', default='1-3'); ap.add_argument('--trials', type=int, default=6)
ap.add_argument('--timeout', type=int, default=300); ap.add_argument('modules', nargs='*')
a = ap.parse_args()
env = {k: v for k, v in os.environ.items() if not k.startswith('PYTHON')}
lo, hi = (a.seeds.split('-') + [a.seeds])[:2]
mods = a.modules or subprocess.run([os.environ.get('PYTHON_ORACLE', 'python3.15'), '-I', HERE + '/fuzz_api.py', '--list'], capture_output=True, text=True).stdout.split()
jobs = [(m, s) for m in mods for s in range(int(lo), int(hi) + 1)]
def one(job):
    m, s = job
    d = tempfile.mkdtemp(prefix='fuzz')
    try:
        p = subprocess.run(a.ours.split() + [HERE + '/fuzz_api.py', m, str(s), str(a.trials)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=a.timeout, env=dict(env, FUZZ_DIR=d))
        return job, p.returncode, p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired as e:
        return job, 'timeout', (e.stdout or b'').decode('utf-8', 'replace'), (e.stderr or b'').decode('utf-8', 'replace')
bad = collections.OrderedDict()
with ThreadPoolExecutor(a.j) as pool:
    for (m, s), status, out, err in pool.map(one, jobs):
        if status == 0 and ('done ' + m in out or 'cannot import' in out):
            continue
        lines = [l for l in err.splitlines() if l.strip()]
        # The last line that fuzz_api.py wrote comes before what the crash handler prints.
        calls = [l for l in lines if (l.startswith(m + '.') or l.startswith('    timed out'))]
        key = calls[-1] if calls else '?'
        print('DIED %s seed %s status %s: %s' % (m, s, status, key[:220]))
        for l in lines[-400:]:
            if 'panic' in l or 'ASSERT' in l or 'Segmentation' in l or 'runtime error' in l or 'AddressSanitizer' in l or 'RELEASE_ASSERT' in l:
                print('       ' + l[:200])
        bad[key] = (m, s)
print('%d runs, %d died' % (len(jobs), len(bad)))
