#!/usr/bin/env python3
"""Runs each test in a thread that is not the main one, under CPython and under Bun, and compares: what is the host's may only be
touched on the main thread, and a native function that forgets that crashes only there.

    in_a_thread.py --oracle python3.15 --ours build/release/bun [-j N] [tests...]        tests: as for run.py (default: all)

Compared: stdout and the exit status. A crash and a hang count whatever CPython does. Nothing is written: there are no expectations,
for much differs here for good reasons (signal handlers can only be set on the main thread, the stack is another, at exit the order is
another), and does so under CPython too. What differs between the two is listed, to be read by a person.
"""
import argparse, os, shlex, shutil, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run

WRAPPER = '''\
import os, runpy, sys, threading
path = sys.argv[1]
sys.argv = [path]
sys.path[0] = os.path.dirname(os.path.abspath(path))
status = [0]
def main():
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        status[0] = e.code if isinstance(e.code, int) else 0 if e.code is None else 1
    except BaseException:
        import traceback
        traceback.print_exc()
        status[0] = 1
# Some tests go as deep as the main thread's stack lets them.
threading.stack_size(512 * 1024 * 1024)
thread = threading.Thread(target=main)
thread.start()
thread.join()
sys.stdout.flush()
sys.exit(status[0])
'''


def main():
    parser = argparse.ArgumentParser(usage=__doc__)
    parser.add_argument('-j', type=int, default=8)
    parser.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun'))
    parser.add_argument('--oracle', default=os.environ.get('PYTHON_ORACLE', 'python3.15'))
    parser.add_argument('--timeout', type=int, default=120)
    parser.add_argument('tests', nargs='*')
    options = parser.parse_args()
    tests = [run.Test(name) for name in run.select(options.tests, run.all_tests())]
    tests = [test for test in tests if test.program.endswith('.py')]
    copy = run.make_copy()
    wrapper = os.path.join(copy, 'in_a_thread_wrapper.py')
    with open(wrapper, 'w') as f:
        f.write(WRAPPER)

    def one(test):
        want = run.run(shlex.split(options.oracle) + ['-X', 'utf8', wrapper], copy, test.program, options.timeout, False)
        if want['timeout']:
            return test, 'the oracle takes too long', ''
        have = run.run(shlex.split(options.ours) + [wrapper], copy, test.program, options.timeout, True)
        if have['timeout']:
            return test, 'HANG', run.tail(have['stderr'])
        status = have['status']
        if status != want['status'] and (status < 0 or status >= 128 or run.CRASH.search(run.text(have['stderr']))):
            return test, 'CRASH (status %s)' % status, run.crash_line(have['stderr']) or run.tail(have['stderr'])
        if (want['status'], want['stdout']) != (status, have['stdout']):
            return test, 'differs (status %s, %s)' % (want['status'], status), ''
        return test, '', ''

    counts = {}
    try:
        with ThreadPoolExecutor(options.j) as pool:
            for test, outcome, detail in pool.map(one, tests):
                kind = outcome.split(' (')[0] or 'the same'
                counts[kind] = counts.get(kind, 0) + 1
                if outcome:
                    print(outcome, test.name, flush=True)
                    if detail:
                        print('   ', detail, flush=True)
    finally:
        shutil.rmtree(copy, ignore_errors=True)
    print(', '.join('%s: %d' % item for item in sorted(counts.items())))
    return 1 if counts.get('CRASH') or counts.get('HANG') else 0


if __name__ == '__main__':
    sys.exit(main())
