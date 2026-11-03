#!/usr/bin/env python3
"""Differential tests: what CPython prints against what `bun script.py` prints.

    run.py [options] [tests...]        tests: directories, files, globs, or the number or name of a test in lang/ (default: all)

Without --update no CPython is needed: what it printed is in NAME.expected beside each script, and Bun's output is compared
with that, which is also what ../*.test.ts do.

    --ours CMD      the command that runs a script (default: $BUN_EXE, or `bun`)
    --update        run the scripts under CPython and write the .expected files (and lang/generated, see split.py)
    --oracle CMD    CPython 3.15 (default: $PYTHON_ORACLE, or `python3.15`)
    --live          compare with CPython now, not with the .expected files; writes nothing
    --raw           lang/ and slow/ as they are written, not their split versions (implies --live)
    -j N            how many at a time (default 8)        --timeout S   seconds for one script under Bun (default 120)
    --oracle-timeout S   the same for CPython (default 120)
    -v              show the differences                  --passed      also list what passes
    --all           also what not-in-ci.json leaves out (much of it prints something else on each machine: --update leaves it alone too)
    --times         at the end, how long each script took under Bun, and each directory

Compared: stdout (exactly), the exit status and, when CPython's status is not 0, the last line of stderr that is not empty.
Every script runs in a copy of its directory, in the same small environment on both sides; the path of that copy is shown
as <dir>. A failure that expected-failures.json lists does not count, and a listed test that passes does.
"""
import argparse, difflib, fnmatch, hashlib, json, os, re, shlex, shutil, signal, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
SPLITTER = os.path.join(TOOLS, 'split.py')
SPLIT_DIRECTORIES = ('lang', 'slow')
# Directories that hold no tests of this kind.
NOT_TESTS = ('tools', 'crashers', 'command-line', '__pycache__')


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


# ---- The .expected files ----
#
#   status: 1
#   stderr: ValueError: the last line of stderr (only if the status is not 0)
#   script: the first 16 digits of the SHA-256 of the file that ran
#   source: the same for the file in lang/ that it was made from (only for lang/generated)
#   oracle: none (only if a person wrote the expectation: there is no CPython to ask about a program that uses JavaScript)
#   mask: addresses (only if 0x7f... is to be read as 0xADDR)
#   ---
#   stdout, byte for byte

def read_expected(path):
    with open(path, 'rb') as f:
        data = f.read()
    head, separator, stdout = data.partition(b'\n---\n')
    if not separator:
        raise ValueError('%s: no --- line' % path)
    fields = {}
    for line in head.decode('utf-8').splitlines():
        key, _, value = line.partition(': ')
        fields[key] = value
    fields['status'] = int(fields['status'])
    fields['stdout'] = stdout
    return fields


def write_expected(path, fields):
    head = ['status: %d' % fields['status']]
    for key in ('stderr', 'script', 'source', 'oracle', 'mask'):
        if fields.get(key) is not None:
            head.append('%s: %s' % (key, fields[key]))
    data = ('\n'.join(head) + '\n---\n').encode('utf-8') + fields['stdout']
    try:
        with open(path, 'rb') as f:
            if f.read() == data:
                return False
    except OSError:
        pass
    with open(path, 'wb') as f:
        f.write(data)
    return True


# ---- The tests ----

class Test:
    """name: 'lang/001_x', 'mod_io/io_misc'. program: the file that runs, relative to ROOT."""
    def __init__(self, name, raw=False):
        self.name = name
        directory, base = os.path.split(name)
        self.source = None
        self.program = next((name + e for e in ('.js', '.py') if os.path.exists(os.path.join(ROOT, name + e))), name + '.py')
        if directory in SPLIT_DIRECTORIES and not raw:
            self.source = self.program
            self.program = os.path.join(directory, 'generated', base + '.py')
        self.expected = os.path.join(ROOT, self.program[:-3] + '.expected')


def helper_modules():
    """Files that tests import, and so are no tests themselves: those that have no .expected file and are named in helpers.txt."""
    with open(os.path.join(ROOT, 'helpers.txt')) as f:
        return {line.strip() for line in f if line.strip() and not line.startswith('#')}


def all_tests():
    helpers = helper_modules()
    names = []
    for base, directories, files in os.walk(ROOT):
        directories[:] = sorted(d for d in directories if d not in NOT_TESTS and d != 'generated')
        relative = os.path.relpath(base, ROOT)
        if relative == '.':
            continue
        stems = {f[:-3] for f in files if f.endswith(('.py', '.js'))}
        for stem in sorted(stems):
            name = os.path.join(relative, stem)
            if not any(name == h or name.startswith(h + os.sep) for h in helpers):
                names.append(name)
    return names


def select(patterns, names):
    if not patterns:
        return names
    chosen = []
    for pattern in patterns:
        p = os.path.relpath(os.path.abspath(pattern), ROOT) if os.path.exists(pattern) else pattern
        p = re.sub(r'\.(py|js|expected)$', '', p.rstrip('/')).replace(os.sep + 'generated' + os.sep, os.sep)
        found = [n for n in names if n.startswith(p + os.sep) or fnmatch.fnmatch(n, p + '*') or fnmatch.fnmatch(n, 'lang/' + p + '*')]
        if not found:
            sys.exit('no test matches %s' % pattern)
        chosen.extend(n for n in found if n not in chosen)
    return chosen


# ---- Running ----

def environment(home, ours):
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': home, 'TMPDIR': os.path.join(home, 'tmp'), 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC0', 'NO_COLOR': '1'}
    if ours:
        for key, value in os.environ.items():
            if key.startswith(('BUN_', 'ASAN_', 'LSAN_', 'UBSAN_')) and key != 'BUN_OPTIONS':
                env[key] = value
        env.setdefault('ASAN_OPTIONS', 'detect_leaks=0:allow_user_segv_handler=1')
        env.setdefault('BUN_DEBUG_QUIET_LOGS', '1')
        env.setdefault('BUN_ENABLE_CRASH_REPORTING', '0')
    return env


def run(command, copy, program, timeout, ours):
    """The program, in the copy of the tests at `copy`. Bytes, with the directory of the program shown as <dir>."""
    path = os.path.join(copy, 'tests', program)
    directory = os.path.dirname(path)
    try:
        p = subprocess.run(command + [os.path.basename(path)], cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, env=environment(os.path.join(copy, 'home'), ours))
        result = {'timeout': False, 'status': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
    except subprocess.TimeoutExpired as e:
        result = {'timeout': True, 'status': None, 'stdout': e.stdout or b'', 'stderr': e.stderr or b''}
    except OSError as e:
        sys.exit('cannot run %s: %s' % (command[0], e))
    for key in ('stdout', 'stderr'):
        result[key] = result[key].replace(directory.encode(), b'<dir>')
    return result


def text(data):
    return data.decode('utf-8', 'backslashreplace')


def last_line(data):
    lines = [l for l in text(data).splitlines() if l.strip()]
    return lines[-1] if lines else ''


def mask(fields, data):
    return re.sub(rb'0x[0-9a-f]{6,}', b'0xADDR', data) if fields.get('mask') == 'addresses' else data


def make_copy():
    copy = os.path.realpath(tempfile.mkdtemp(prefix='python-differential-'))
    shutil.copytree(ROOT, os.path.join(copy, 'tests'), ignore=shutil.ignore_patterns('__pycache__', '*.expected', '*.ts', '*.md', '*.json'))
    os.makedirs(os.path.join(copy, 'home', 'tmp'))
    return copy


# ---- Showing differences ----

def clip(s, n=150):
    s = s.replace('\n', '\\n')
    return s if len(s) <= n else s[:n - 3] + '...'


def tail(data, n=2):
    lines = [l for l in text(data).splitlines() if l.strip()]
    return ' / '.join(clip(l, 110) for l in lines[-n:])


CRASH = re.compile(r'AddressSanitizer|ASSERTION FAILED|SHOULD NEVER BE REACHED|RELEASE_ASSERT|UndefinedBehavior|runtime error:|Segmentation|panic')


def crash_line(data):
    lines = text(data).splitlines()
    for i, l in enumerate(lines):
        if CRASH.search(l):
            extra = ''
            if 'ASSERTION FAILED' in l or 'SHOULD NEVER' in l:
                extra = ' / ' + ' / '.join(clip(x, 100) for x in lines[i + 1:i + 3])
            return clip(l, 160) + extra
    return tail(data)


def window(a, b, width=110, lead=30):
    """Clips two lines to the same window around the first column where they differ."""
    k = 0
    while k < len(a) and k < len(b) and a[k] == b[k]:
        k += 1
    start = max(0, k - lead) if max(len(a), len(b)) > width else 0
    cut = lambda x: ('...' if start else '') + clip(x[start:], width)
    return k, cut(a), cut(b)


def first_difference(expected, got):
    e, g = expected.split('\n'), got.split('\n')
    for i in range(max(len(e), len(g))):
        a = e[i] if i < len(e) else None
        b = g[i] if i < len(g) else None
        if a != b:
            # A final '' stands for the newline that ends the output.
            if a == '' and i == len(e) - 1:
                a = None
            if b == '' and i == len(g) - 1:
                b = None
            if a is None or b is None:
                show = lambda x: '<end of output>' if x is None else clip(x)
                return 'line %d: expected %s | got %s' % (i + 1, show(a), show(b))
            column, a, b = window(a, b)
            return 'line %d col %d: expected %s | got %s' % (i + 1, column + 1, a, b)
    return 'outputs differ'


def differing(expected, got):
    """How many lines of the expected output are not matched, and how many there are."""
    e, g = expected.splitlines(), got.splitlines()
    if len(e) == len(g):
        return sum(a != b for a, b in zip(e, g)), len(e)
    same = sum(i2 - i1 for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, e, g, autojunk=False).get_opcodes() if tag == 'equal')
    return len(e) - same, len(e)


def diff_lines(expected, got, limit=40):
    """A unified diff in which long lines are clipped around the place where they differ."""
    e, g = expected.splitlines(), got.splitlines()
    out = []
    for group in difflib.SequenceMatcher(None, e, g, autojunk=False).get_grouped_opcodes(1):
        out.append('@@ -%d +%d @@' % (group[0][1] + 1, group[0][3] + 1))
        for tag, i1, i2, j1, j2 in group:
            if tag == 'equal':
                out.extend('  ' + clip(l, 160) for l in e[i1:i2])
            elif tag == 'replace' and i2 - i1 == j2 - j1:
                for a, b in zip(e[i1:i2], g[j1:j2]):
                    _, a, b = window(a, b, 190, 60)
                    out.extend(('- ' + a, '+ ' + b))
            else:
                out.extend('- ' + clip(l, 190) for l in e[i1:i2])
                out.extend('+ ' + clip(l, 190) for l in g[j1:j2])
        if len(out) > limit:
            break
    if len(out) > limit:
        out = out[:limit] + ['... (more)']
    return out


def compare(want, have):
    """None, or what is wrong. `want`: the fields of a .expected file."""
    wanted, got = text(want['stdout']), text(mask(want, have['stdout']))
    if have['timeout']:
        reason = 'timeout'
        if got != wanted[:len(got)]:
            reason += '; ' + first_difference(wanted, got)
        return reason
    if have['status'] < 0 and have['status'] != want['status']:
        try:
            name = signal.Signals(-have['status']).name
        except ValueError:
            name = str(-have['status'])
        return 'crash (signal %s) %s' % (name, crash_line(have['stderr']))
    if CRASH.search(text(have['stderr'])) and have['status'] != want['status']:
        return 'crash (status %s) %s' % (have['status'], crash_line(have['stderr']))
    if mask(want, have['stdout']) != want['stdout']:
        reason = first_difference(wanted, got)
        if have['status'] != want['status']:
            reason += ' [status %s != %s: %s]' % (have['status'], want['status'], tail(have['stderr'], 1))
        return reason
    if have['status'] != want['status']:
        return 'status %s != %s: %s' % (have['status'], want['status'], tail(have['stderr']))
    if want['status'] != 0 and last_line(mask(want, have['stderr'])) != want.get('stderr', ''):
        return 'stderr: expected %s | got %s' % (clip(want.get('stderr', '')), clip(last_line(have['stderr'])))
    return None


# ---- --update ----

def refresh_split(test, oracle):
    """Makes lang/generated/NAME.py from lang/NAME.py."""
    destination = os.path.join(ROOT, test.program)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    temporary = destination + '.tmp'
    p = subprocess.run(oracle[:1] + ['-I', SPLITTER, os.path.join(ROOT, test.source), temporary], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode != 0:
        sys.exit('split.py failed on %s: %s' % (test.source, text(p.stdout)))
    os.replace(temporary, destination)


def ask_oracle(test, oracle, copy, timeout):
    result = run(oracle, copy, test.program, timeout, False)
    if result['timeout']:
        return None
    fields = {'status': result['status'], 'stdout': result['stdout'], 'script': digest(os.path.join(ROOT, test.program))}
    if result['status'] != 0:
        fields['stderr'] = last_line(result['stderr'])
    if test.source:
        fields['source'] = digest(os.path.join(ROOT, test.source))
    return fields


def is_hand_written(test):
    try:
        return read_expected(test.expected).get('oracle') == 'none'
    except OSError:
        return test.program.endswith('.js')


def stale(test, want):
    if want.get('oracle') == 'none':
        return None
    if want.get('script') != digest(os.path.join(ROOT, test.program)):
        return '%s has changed since its .expected file was written: run.py --update' % test.program
    if test.source and want.get('source') != digest(os.path.join(ROOT, test.source)):
        return '%s has changed since %s was made from it: run.py --update' % (test.source, test.program)
    return None


def load(name):
    with open(os.path.join(ROOT, name)) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(usage=__doc__)
    ap.add_argument('-j', type=int, default=8)
    ap.add_argument('-v', action='store_true')
    ap.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun'))
    ap.add_argument('--oracle', default=os.environ.get('PYTHON_ORACLE', 'python3.15'))
    ap.add_argument('--update', action='store_true')
    ap.add_argument('--live', action='store_true')
    ap.add_argument('--raw', action='store_true')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--passed', action='store_true')
    ap.add_argument('--times', action='store_true')
    ap.add_argument('--timeout', type=int, default=120)
    ap.add_argument('--oracle-timeout', type=int, default=120)
    ap.add_argument('tests', nargs='*')
    args = ap.parse_args()
    args.live = args.live or args.raw
    ours = shlex.split(args.ours)
    oracle = shlex.split(args.oracle) + ['-I', '-X', 'utf8']
    expected_failures, not_in_ci = load('expected-failures.json'), load('not-in-ci.json')

    names = select(args.tests, all_tests())
    if not args.all and not args.tests:
        names = [n for n in names if n not in not_in_ci]
    tests = [Test(n, args.raw) for n in names]

    if args.update:
        tests = [t for t in tests if not is_hand_written(t)]
        with ThreadPoolExecutor(args.j) as pool:
            list(pool.map(lambda t: refresh_split(t, oracle), [t for t in tests if t.source]))
        copy = make_copy()
        try:
            written = 0
            with ThreadPoolExecutor(args.j) as pool:
                for test, fields in zip(tests, pool.map(lambda t: ask_oracle(t, oracle, copy, args.oracle_timeout), tests)):
                    if fields is None:
                        print('CPython took more than %d s: %s' % (args.oracle_timeout, test.name))
                    elif write_expected(test.expected, fields):
                        written += 1
                        print('wrote', os.path.relpath(test.expected, ROOT))
            print('%d tests, %d expectations written' % (len(tests), written))
        finally:
            shutil.rmtree(copy, ignore_errors=True)
        return 0

    copy = make_copy()
    seconds = {}

    def check(test):
        if args.live and not is_hand_written(test):
            want = ask_oracle(test, oracle, copy, args.oracle_timeout)
            if want is None:
                return 'CPython timed out', None, None
        else:
            try:
                want = read_expected(test.expected)
            except OSError:
                return 'there is no .expected file: run.py --update, or --live', None, None
            problem = stale(test, want)
            if problem:
                return problem, None, None
        begun = time.monotonic()
        have = run(ours, copy, test.program, args.timeout, True)
        seconds[test.name] = time.monotonic() - begun
        return compare(want, have), want, have

    passed = failed = known = good_lines = all_lines = 0
    try:
        with ThreadPoolExecutor(args.j) as pool:
            for test, (reason, want, have) in zip(tests, pool.map(check, tests)):
                bad, total = differing(text(want['stdout']), text(mask(want, have['stdout']))) if have is not None else (0, 0)
                good_lines += total - bad
                all_lines += total
                listed = expected_failures.get(test.name)
                if reason is None:
                    if listed is not None:
                        failed += 1
                        print('PASS %s, which expected-failures.json says fails: %s' % (test.name, listed))
                        continue
                    passed += 1
                    if args.passed:
                        print('ok   %s' % test.name)
                    continue
                if listed is not None:
                    known += 1
                else:
                    failed += 1
                print('%s %s: %s%s' % ('fail' if listed is not None else 'FAIL', test.name, reason, ' (%d of %d lines differ)' % (bad, total) if bad else ''))
                if listed is not None:
                    print('     expected: %s' % listed)
                if args.v and have is not None:
                    for line in diff_lines(text(want['stdout']), text(mask(want, have['stdout']))):
                        print('    ' + line)
                    errors = [l for l in text(have['stderr']).splitlines() if l.strip()] if have['status'] != want['status'] else []
                    for line in errors[-8:]:
                        print('    stderr: ' + clip(line, 200))
    finally:
        shutil.rmtree(copy, ignore_errors=True)
    if args.times:
        for name in sorted(seconds, key=seconds.get):
            print('%7.1f s  %s' % (seconds[name], name))
        directories = {}
        for name in seconds:
            directory = name.split(os.sep)[0]
            directories[directory] = directories.get(directory, 0) + seconds[name]
        for directory in sorted(directories):
            print('%7.1f s  %s/' % (directories[directory], directory))
    print('passed %d, failed as expected %d, FAILED %d, of %d   (lines of output that match: %d/%d)' % (passed, known, failed, len(tests), good_lines, all_lines))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
