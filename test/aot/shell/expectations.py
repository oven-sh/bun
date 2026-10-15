#!/usr/bin/env python3
"""Checks what the compiler generates for a program, not only what the program prints.

These are the positive and negative tests of the optimizations. A program under ../programs states its expectations in comment
lines; this script reads them and checks them with the `jsc` shell, without building Bun.

    JSC=<jsc> SEMA=<bun-sema> test/aot/shell/expectations.py [-j <jobs>] <program>... | all

See quick.py for how to build the two tools and how a program is named. PROGRAMS and WORK mean the same as there.

Checked against JavaScriptCore's optimized IR (`dump.js -- <IR> optimized`), on every platform:
    // IR+ <regex>                     some line matches
    // IR- <regex>                     no line matches
    // IR= <n> <function> <regex>      exactly n lines match in the function of that name (not in copies inlined elsewhere)
    // IRT= <n> <function> <regex>     the same, only in its typed body (the one whose first line says `annotated`)
    // IRM= <n> <regex>                the same, in the top-level code of the program's own module
Checked against the remarks of the string-building pass (`dump.js -- <IR> string-builders`), on every platform:
    // REMARK+ <function> <regex>      a line about the function matches
    // REMARK- <function> <regex>      no line about the function matches
Checked against the machine code, found through the map file (--aotMapFilePath); ARM64 only, counted as skipped elsewhere:
    // CALLS+ <function> <regex>       the summary line of the function's machine code matches (see calls() below)
    // CALLS- <function> <regex>       it does not match
    // SIZE< <function> <bytes>        the typed function's code is smaller than that
Checked against the regular expressions compiled into the image (the X lines of the map file), on every platform:
    // KNOWN <word> <source>           the source is known at build time, so its code is in the image
    // PARTLY <word> <source>          the same, for the flags that were predicted
    // UNKNOWN <source>                its code is not in the image
Checked against the thunks of the image (the T lines of the map file), on every platform:
    // THUNKS< <n>                     fewer than n thunks that name an operation for a stub are in the image
Checked against the size of the data that describes the program to the run time (the Z line of the map file), on every platform:
    // DATA< <bytes>                   it is smaller than that
    // MESSAGE-DATA< <n>               fewer than n layouts carry what only the text of a type error reads
Not read here: // CODE (a disassembly) and // JSCALLS (CALLS for the same program without type annotations).

Prints one line per program, `ok <program>: <n> expectations` or `FAIL <program>: <what is not met>`, then a summary line.
Exits with 1 if anything failed. known-failures.txt lists the expectations that are known to fail today: they are reported but
do not fail the run, while a listed one that passes again does, so that the list only shrinks. --write-known rewrites the list.
"""
import concurrent.futures, os, platform, re, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAMS = os.path.realpath(os.environ.get('PROGRAMS', HERE + '/../programs'))
JSC, SEMA = os.environ['JSC'], os.environ['SEMA']
WORK = os.environ.get('WORK') or tempfile.mkdtemp(prefix='aot-expectations-')
os.makedirs(WORK, exist_ok=True)
os.environ.setdefault('BUN_SEMA_TS_LIB', os.path.realpath(HERE + '/../../../node_modules/typescript/lib'))
os.environ.update(NO_COLOR='1', BUN_ENABLE_CRASH_REPORTING='0')
LINE = re.compile(r'^// (IR\+|IR-|IR=|IRT=|IRM=|REMARK\+|REMARK-|CALLS\+|CALLS-|SIZE<|KNOWN|PARTLY|UNKNOWN|THUNKS<|DATA<|MESSAGE-DATA<) (.*)$', re.M)
ARM64 = platform.machine() in ('arm64', 'aarch64')


def source(name):
    found = None
    for stem in ('%s', '%s/main', '%s/program'):
        for ext in ('ts', 'tsx', 'js'):
            path = '%s/%s.%s' % (PROGRAMS, stem % name, ext)
            if os.path.isfile(path): found = path
    return found


def everything():
    names = set()
    for folder, _, files in os.walk(PROGRAMS):
        for file in files:
            if re.search(r'\.(ts|tsx|js)$', file) and LINE.search(open(os.path.join(folder, file), errors='replace').read()):
                rel = os.path.relpath(os.path.join(folder, file), PROGRAMS).split('/')
                names.add('/'.join(rel[:2]) if len(rel) > 2 else re.sub(r'\.\w+$', '', '/'.join(rel)))
    return sorted(names)


def run(*command):
    return subprocess.run(command, capture_output=True, text=True, errors='replace', timeout=300)


def bodies(ir, wanted):
    """The lines of the functions whose head `wanted` accepts."""
    out, on = [], False
    for line in ir.split('\n'):
        if line.startswith('function '): on = wanted(line)
        if on: out.append(line)
    return out


def calls(image, map_file):
    """function -> a line about its machine code: `<function>: <n> instructions; <what it calls or jumps to, by name, sorted; another function as f:<name>>; uses <the kinds of floating-point
    instructions it has: ucvtf scvtf fcvtzs fcmp>; tables <number of br>; tests for equality with <the immediates of cmp xN | wN, #imm; b.eq | b.ne> .` A function that is split at its calls is one function here.
    Of the bodies that have one name the typed one is described, not the ones for untyped callers. A function without a name is a body that call sites of a built-in share: what it calls counts for its callers."""
    data = open(image, 'rb').read()
    offset, _ = struct.unpack_from('<QQ', data, 24)
    thunks, functions, first, waiting, sizes, typed = {}, [], {}, {}, {}, []
    for line in open(map_file, errors='replace'):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'T': thunks[int(f[1])] = f[2]
        elif f[0] == 'F' and len(f) > 7:
            kind, part = f[8] if len(f) > 8 else '', (int(f[2]), int(f[3]))
            if kind == 'typed': sizes.setdefault(f[7], int(f[3]))
            if kind == 'continuation' and f[7] in first: functions[first[f[7]]][1].append(part)
            elif kind == 'continuation': waiting.setdefault(f[7], []).append(part)
            elif kind.startswith('generic'): functions.append((f[7] + ' [general entry]', [part])); typed.append(False)
            else:
                first[f[7]] = len(functions); functions.append((f[7], [part] + waiting.pop(f[7], []))); typed.append(kind == 'typed')
    starts = {start: (name, i) for i, (name, parts) in enumerate(functions) for start, _ in parts}
    result, found = {}, []
    for number, (name, parts) in enumerate(functions):
        called, kinds, tested, tables, shared = set(), set(), set(), 0, set()
        for start, length in parts:
            words = struct.unpack_from('<%dI' % (length // 4), data, offset + start)
            for k, word in enumerate(words):
                if word & 0x7fc0001f == 0x7100001f and k + 1 < len(words) and words[k + 1] & 0xff00001e == 0x54000000: tested.add((word >> 10) & 0xfff)  # cmp xN | wN, #imm; b.eq | b.ne
                if word & 0xfffffc1f == 0xd61f0000: tables += 1  # br xN
                if word & 0x7f3ffc00 == 0x1e230000: kinds.add('ucvtf')
                if word & 0x7f3ffc00 == 0x1e220000: kinds.add('scvtf')
                if word & 0x7f3ffc00 == 0x1e380000: kinds.add('fcvtzs')
                if word & 0xff20fc07 == 0x1e202000: kinds.add('fcmp')
                if word >> 26 in (0x25, 0x05):  # bl, b
                    distance = word & 0x3ffffff
                    if distance & 0x2000000: distance -= 0x4000000
                    target = start + 4 * k + 4 * distance
                    if target in thunks: called.add(thunks[target])
                    elif target in starts and starts[target][1] != number:
                        called.add('f:' + starts[target][0])
                        if not starts[target][0]: shared.add(starts[target][1])
        found.append((called, kinds, tested, tables, shared))

    def reached(number, seen):
        called = set(found[number][0])
        for other in found[number][4] - seen: called |= reached(other, seen | {number, other})
        return called

    for wanted in (True, False):
        for number, (name, parts) in enumerate(functions):
            if typed[number] != wanted: continue
            _, kinds, tested, tables, _ = found[number]
            result.setdefault(name, '%s: %d instructions; %s; uses %s; tables %d; tests for equality with %s .' % (name, sum(length for _, length in parts) // 4, '; '.join(sorted(reached(number, {number}))), ' '.join(sorted(kinds)), tables, ' '.join(map(str, sorted(tested)))))
    return result, sizes


class Failures:
    """What is appended is kept with the expectation line that it is about."""
    def __init__(self, into, line): self.into, self.line = into, line
    def append(self, text): self.into.append((self.line, text))


def one(name):
    path = source(name)
    if not path: return name, [('', 'no source')], 0, 0
    text = open(path, errors='replace').read()
    # Two were written for BSD's grep, whose end of a word is spelled so.
    lines = [(kind, rest.replace('[[:>:]]', r'\b').replace('[[:<:]]', r'\b')) for kind, rest in LINE.findall(text)]
    room = '%s/%s' % (WORK, name.replace('/', '.'))
    options = []
    config = os.path.dirname(path) + '/tsconfig.json'
    if path.count('/') > PROGRAMS.count('/') + 2 and os.path.isfile(config):
        if '"strict": true' in open(config).read(): options.append('--strict')
    for suffix in ('.bin', '.img', '.map'):
        if os.path.exists(room + suffix): os.remove(room + suffix)
    subprocess.run([SEMA, 'cli', path, '--allowJs', '--resolveJsonModule', *options, '--no-builtin-modules', '--aot', '--aot-out=' + room + '.bin'], capture_output=True, cwd=os.path.dirname(path), timeout=120)
    if not os.path.isfile(room + '.bin'): return name, [('', 'no IR')], len(lines), 0
    bad, skipped = [], 0
    kinds = {kind for kind, _ in lines}
    ir = run(JSC, '--useDollarVM=1', HERE + '/dump.js', '--', room + '.bin', 'optimized').stdout if kinds & {'IR+', 'IR-', 'IR=', 'IRT=', 'IRM='} else ''
    # An expectation of nothing is met by no dump at all.
    if kinds & {'IR+', 'IR-', 'IR=', 'IRT=', 'IRM='} and not re.search(r'^function ', ir, re.M): bad.append(('', 'THE DUMP HAS NO FUNCTION'))
    remarks = run(JSC, '--useDollarVM=1', HERE + '/dump.js', '--', room + '.bin', 'string-builders').stdout if kinds & {'REMARK+', 'REMARK-'} else ''
    called, sizes = {}, {}
    expressions = set()
    thunks = None
    if kinds & {'CALLS+', 'CALLS-', 'SIZE<'} and ARM64 or kinds & {'KNOWN', 'PARTLY', 'UNKNOWN', 'THUNKS<', 'DATA<', 'MESSAGE-DATA<'}:
        run(JSC, '--useDollarVM=1', '--aotMapFilePath=' + room + '.map', HERE + '/image.js', '--', room + '.bin', room + '.img', HERE + '/stub.js')
        if not os.path.isfile(room + '.img'): bad.append(('', 'not compiled'))
        else:
            if ARM64: called, sizes = calls(room + '.img', room + '.map')
            # The map writes a backslash twice.
            expressions = {line.rstrip('\n').split('\t')[5].replace('\\\\', '\\') for line in open(room + '.map', errors='replace') if line.startswith('X') and line.count('\t') >= 5}
            thunks = sum(1 for line in open(room + '.map', errors='replace') if line.startswith('T\t') and ' to operation' in line and not line.endswith(' with arguments\n'))
    whole = bad
    for kind, rest in lines:
        bad = Failures(whole, '// %s %s' % (kind, rest))
        if kind in ('IR+', 'IR-'):
            if bool(re.search(rest, ir, re.M)) != (kind == 'IR+'): bad.append('%s /%s/' % ('lacks' if kind == 'IR+' else 'has', rest))
        elif kind in ('IR=', 'IRT=', 'IRM='):
            if kind == 'IRM=':
                count, pattern = rest.split(' ', 1); fn = 'the module'
                body = bodies(ir, lambda head: head.split(' ')[2] == '"module' and head.split(' ')[3] == os.path.basename(path) + '"')
            else:
                count, fn, pattern = rest.split(' ', 2)
                body = bodies(ir, lambda head: head.split(' ')[2] == '"%s"' % fn and (kind == 'IR=' or ' annotated' in head))
            # A function all of whose calls were copied has no body any more: nothing is found in it, whatever is looked for.
            if not any(' = ' in line for line in body): bad.append('the function %s has no body in the dump' % fn); continue
            got = sum(1 for line in body if re.search(pattern, line))
            if got != int(count): bad.append('%s has %d of /%s/, not %s' % (fn, got, pattern, count))
        elif kind in ('REMARK+', 'REMARK-'):
            fn, pattern = rest.split(' ', 1)
            found = any(re.search(pattern, line) for line in remarks.split('\n') if re.search(r'(^|\W)%s(\W|$)' % re.escape(fn), line))
            if found != (kind == 'REMARK+'): bad.append('%s: %s remark /%s/' % (fn, 'no' if kind == 'REMARK+' else 'a', pattern))
        elif kind in ('KNOWN', 'PARTLY'):
            if rest.split(' ', 1)[1] not in expressions: bad.append('not in the image: %s' % rest[:70])
        elif kind == 'UNKNOWN':
            if rest in expressions: bad.append('in the image, and not known: %s' % rest[:70])
        elif kind == 'MESSAGE-DATA<':
            counts = [int(line.split('\t')[2]) for line in open(room + '.map', errors='replace') if line.startswith('Z\t') and line.count('\t') > 1] if os.path.isfile(room + '.map') else []
            if not (counts and counts[0] < int(rest)): bad.append('%s layouts carry what only a message reads, not under %s' % (counts[0] if counts else '?', rest))
        elif kind == 'DATA<':
            sizes_of_data = [int(line.split('\t')[1]) for line in open(room + '.map', errors='replace') if line.startswith('Z\t')] if os.path.isfile(room + '.map') else []
            if not (sizes_of_data and 0 < sizes_of_data[0] < int(rest)): bad.append('the data is %s bytes, not under %s' % (sizes_of_data[0] if sizes_of_data else '?', rest))
        elif kind == 'THUNKS<':
            if thunks is None or not 0 < thunks < int(rest): bad.append('%s thunks name an operation, not between 1 and %s' % (thunks, rest))
        elif not ARM64: skipped += 1
        elif kind == 'SIZE<':
            fn, limit = rest.split()
            if not (fn in sizes and sizes[fn] < int(limit)): bad.append('%s is %s bytes, not under %s' % (fn, sizes.get(fn, '?'), limit))
        else:
            fn, pattern = rest.split(' ', 1)
            if fn not in called: bad.append('no function %s in the image' % fn); continue
            if bool(re.search(pattern, called[fn])) != (kind == 'CALLS+'): bad.append('%s %s /%s/' % (fn, 'does not call' if kind == 'CALLS+' else 'calls', pattern))
    bad = whole
    if not bad:
        for suffix in ('.bin', '.img', '.map'):
            if os.path.exists(room + suffix): os.remove(room + suffix)
    return name, bad, len(lines), skipped


flags = [a for a in sys.argv[1:] if a.startswith('--')]
arguments = [a for a in sys.argv[1:] if not a.startswith('--')]
jobs = 8
if arguments[:1] == ['-j']: jobs = int(arguments[1]); arguments = arguments[2:]
names = everything() if arguments == ['all'] else arguments
# known-failures.txt: see the top of this file.
KNOWN = HERE + '/known-failures.txt'
known = {tuple(line.split('\t', 1)) for line in open(KNOWN).read().split('\n') if line and not line.startswith('#')} if os.path.isfile(KNOWN) else set()
failed = total = untried = old = 0
seen = set()
with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
    for name, bad, count, skipped in pool.map(one, names):
        total += count; untried += skipped
        seen |= {(name, line) for line, _ in bad}
        new = [text for line, text in bad if (name, line) not in known]
        old += len(bad) - len(new)
        if new: failed += 1; print('FAIL %s: %d of %d: %s' % (name, len(new), count, '; '.join(new)[:400]))
        else: print('ok   %s: %d expectations%s%s' % (name, count - skipped - len(bad), ', %d skipped on this platform' % skipped if skipped else '', ', %d known failures' % len(bad) if bad else ''))
if '--write-known' in flags: open(KNOWN, 'w').write('# <program> TAB <expectation line>: expectations that are known to fail today. See expectations.py.\n' + ''.join('%s\t%s\n' % pair for pair in sorted(seen)))
again = sorted(pair for pair in known - seen if pair[0] in names and (ARM64 or not re.match(r'// (CALLS|SIZE)', pair[1])))
for pair in again: print('PASSES AGAIN, remove it from known-failures.txt: %s: %s' % pair)
print('%d programs, %d expectation lines: %d programs fail; %d lines are known failures%s' % (len(names), total, failed, old, '; %d lines are for ARM64 only and were skipped' % untried if untried else ''))
sys.exit(1 if failed or again else 0)
