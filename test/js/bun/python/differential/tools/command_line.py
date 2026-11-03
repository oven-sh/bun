#!/usr/bin/env python3
"""Command lines of `python3`: what CPython does with them against what Bun does under that name.

    command_line.py [options] [part of a name]

The command lines are in ../command-line/cases.json, what CPython 3.15 did with them in ../command-line/expected.json. Each runs
in a new directory with the files that cases.json describes. Compared: stdout, stderr and the exit status, with the
directory, the path of the interpreter, the version banner and addresses masked.

    --ours PATH     Bun (default: $BUN_EXE, or `bun`); it is run through a link named python3
    --update        run them under CPython and write expected.json
    --oracle PATH   CPython 3.15 (default: $PYTHON_ORACLE, or `python3.15`)
    -j N            how many at a time (default 8)        -v    also list what is the same
"""
import argparse, base64, concurrent.futures, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'command-line')


def prepare(directory, data):
    for name, text in data['files'].items():
        path = os.path.join(directory, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(text)
    for name, target in data['links'].items():
        os.symlink(target, os.path.join(directory, name))
    for name, text in data['base64'].items():
        with open(os.path.join(directory, name), 'wb') as f:
            f.write(base64.b64decode(text))


def clean(text, directory):
    text = text.replace(directory, '<dir>')
    text = re.sub(r'/\S*/python3(\.15)?\b(?!/)', '<python>', text)
    text = re.sub(r'3\.15\.\d+ \(.*\) \[.*\]', '<version>', text)
    text = re.sub(r' at 0x[0-9a-f]+', ' at 0x', text)
    # FIXME: The carets under the source line of a traceback are not done yet.
    return '\n'.join(l for l in text.split('\n') if not re.fullmatch(r'\s*[~^]+\s*', l))


def run(command, case, data, ours):
    with tempfile.TemporaryDirectory(prefix='python-command-line-') as directory:
        directory = os.path.realpath(directory)
        prepare(directory, data)
        env = {'PATH': '/usr/bin:/bin', 'HOME': directory, 'LANG': 'C.UTF-8'}
        if ours:
            env.update((k, v) for k, v in os.environ.items() if k.startswith(('BUN_', 'ASAN_')) and k != 'BUN_OPTIONS')
            env.setdefault('ASAN_OPTIONS', 'detect_leaks=0:allow_user_segv_handler=1')
            env.setdefault('BUN_DEBUG_QUIET_LOGS', '1')
            env.setdefault('BUN_ENABLE_CRASH_REPORTING', '0')
        env.update(case.get('env', {}))
        stdin = case.get('stdin')
        stdout = open('/dev/full', 'w') if case.get('stdoutIsFull') else subprocess.PIPE
        try:
            p = subprocess.run([command] + case['args'], cwd=directory, env=env, input=stdin, stdin=subprocess.DEVNULL if stdin is None else None,
                               stdout=stdout, stderr=subprocess.PIPE, text=True, errors='backslashreplace', timeout=300, start_new_session=True)
        except subprocess.TimeoutExpired:
            return {'stdout': 'TIMEOUT', 'stderr': '', 'status': None}
        return {'stdout': None if p.stdout is None else clean(p.stdout, directory),
                'stderr': None if case.get('ignoreStderr') else clean(p.stderr, directory), 'status': p.returncode}


def main():
    ap = argparse.ArgumentParser(usage=__doc__)
    ap.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun'))
    ap.add_argument('--oracle', default=os.environ.get('PYTHON_ORACLE', 'python3.15'))
    ap.add_argument('--update', action='store_true')
    ap.add_argument('-j', type=int, default=8)
    ap.add_argument('-v', action='store_true')
    ap.add_argument('pattern', nargs='?')
    args = ap.parse_args()
    with open(os.path.join(HERE, 'cases.json')) as f:
        data = json.load(f)
    cases = [c for c in data['cases'] if not args.pattern or args.pattern in c['name']]

    if args.update:
        oracle = shutil.which(args.oracle) or sys.exit('cannot find %s' % args.oracle)
        with concurrent.futures.ThreadPoolExecutor(args.j) as pool:
            results = dict(zip((c['name'] for c in cases), pool.map(lambda c: run(oracle, c, data, False), cases)))
        path = os.path.join(HERE, 'expected.json')
        if args.pattern:
            with open(path) as f:
                results = {**json.load(f), **results}
        with open(path, 'w') as f:
            json.dump(results, f, indent=1, ensure_ascii=False)
            f.write('\n')
        print('%d command lines' % len(cases))
        return 0

    with open(os.path.join(HERE, 'expected.json')) as f:
        expected = json.load(f)
    with open(os.path.join(os.path.dirname(HERE), 'expected-failures.json')) as f:
        expected_failures = json.load(f)
    bun = shutil.which(args.ours) or sys.exit('cannot find %s' % args.ours)
    failed = known = 0
    with tempfile.TemporaryDirectory(prefix='python-command-line-bin-') as bin_directory:
        python = os.path.join(os.path.realpath(bin_directory), 'python3')
        os.symlink(os.path.realpath(bun), python)
        with concurrent.futures.ThreadPoolExecutor(args.j) as pool:
            for case, got in zip(cases, pool.map(lambda c: run(python, c, data, True), cases)):
                name, want = case['name'], expected[case['name']]
                listed = expected_failures.get('command-line/' + name)
                if want == got:
                    if listed is not None:
                        failed += 1
                        print('PASS %s, which expected-failures.json says fails: %s' % (name, listed))
                    elif args.v:
                        print('ok  ', name)
                    continue
                if listed is not None:
                    known += 1
                    print('fail', name, '(expected: %s)' % listed)
                    continue
                failed += 1
                print('FAIL', name)
                for label in ('stdout', 'stderr', 'status'):
                    if want[label] != got[label]:
                        show = lambda x: repr(x if not isinstance(x, str) else x[-700:])
                        print('   %s expected: %s' % (label, show(want[label])))
                        print('   %s got:      %s' % (label, show(got[label])))
    print('%d the same, %d failed as expected, %d FAILED, of %d' % (len(cases) - failed - known, known, failed, len(cases)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
