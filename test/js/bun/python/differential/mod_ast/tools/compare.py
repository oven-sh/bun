#!/usr/bin/env python3
"""compare.py SCRIPT [-j N] [--arg X] files...: runs SCRIPT on each file with the oracle and with jsc, and compares what they print."""
import os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ORACLE = [os.environ.get('PYTHON_ORACLE', 'python3.15'), '-I', '-X', 'utf8']
OURS = [os.environ.get('BUN_EXE', 'bun')]

def main():
    args = sys.argv[1:]
    script = args.pop(0)
    jobs = 8
    extra = []
    while args and args[0].startswith('-'):
        if args[0] == '-j':
            jobs = int(args[1]); del args[:2]
        elif args[0] == '--arg':
            extra.append(args[1]); del args[:2]
        else:
            raise SystemExit('bad option ' + args[0])
    env = dict(os.environ, ASAN_OPTIONS='detect_leaks=0', BUN_DEBUG_QUIET_LOGS='1')

    def one(path):
        a = subprocess.run(ORACLE + [script] + extra + [path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
        try:
            b = subprocess.run(OURS + [script] + extra + [path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, env=env, timeout=600)
        except subprocess.TimeoutExpired:
            return path, 'timeout'
        if a.stdout == b.stdout and a.returncode == b.returncode:
            return path, None
        x, y = a.stdout.decode('utf-8', 'replace'), b.stdout.decode('utf-8', 'replace')
        i = 0
        while i < len(x) and i < len(y) and x[i] == y[i]:
            i += 1
        err = b.stderr.decode('utf-8', 'replace').strip().splitlines()
        return path, 'status %s/%s at %d\n    oracle: %r\n    ours:   %r\n    stderr: %s' % (a.returncode, b.returncode, i, x[max(0, i - 100):i + 100], y[max(0, i - 100):i + 100], ' | '.join(err[-3:])[:400])

    bad = 0
    with ThreadPoolExecutor(jobs) as pool:
        for path, problem in pool.map(one, args):
            if problem:
                bad += 1
                print('FAIL', path, problem)
    print('%d of %d the same' % (len(args) - bad, len(args)))

main()
