#!/usr/bin/env python3
"""Checks what the compiler generates for a program, not only what the program prints.

These are the positive and negative tests of the optimizations. A program under ../parallel states its expectations in comment
lines; this script reads them and checks them with `testaot`, without building Bun.

    TESTAOT=<testaot> FRONT_END=<bun> test/aot/shell/expectations.py [-j <jobs>] [--write-known] <program>... | all

See toolchain.py for how to build the two tools and quick.py for how a program is named. PROGRAMS, WORK and WORDS mean the same as in quick.py.

Checked against the dump of the program, on every platform. The dump is the records that `testaot print` prints, without the bodies of the functions and without the text of the
modules, which holds these very lines, and behind them the Code that `testaot walk` prints for the Body and the CoroutineBody of every function:
    // IR+ <regex>                     some line matches
    // IR- <regex>                     no line matches
    // IR= <n> <function> <regex>      exactly n lines match in the Code of the function of that name (not in copies inlined elsewhere)
    // IR@= <n> <function> <regex>     the lines that match in it come from exactly n places of the source: what the compiler has copied (a turn of a short loop) counts once
    // IRT= <n> <function> <regex>     the same as IR=; n lines match in each function of that name
    // IRM= <n> <regex>                the same, in the Code of the top level of the program's own module, also where it awaits
A line that can tell nothing fails its program, as one that is not met does:
    a line that begins like one of these and is none: capitals, then `+`, `-`, `=`, `@=`, `<` or `:`. Nothing reads it. `// STATISTIC:` is read by ../run-parallel.ts, `// TODO:` by people
    `// IR-UNTIL ..`, `// KNOWN ..`, `// PARTLY ..`, `// UNKNOWN ..`, and a comment `//! ..` behind a statement: nothing reads them
    a line of these kinds in a file of the program's folder that is not the file compiled here: only that file is read
    `// IR- <a declaration>[\\s\\S]*<a use of it>` where nothing in the dump matches the declaration
    with `all`, a line that says what must not be there and names what no program has: an operation that the compiler no longer has is absent from whatever it makes. Somewhere a program has
                                       to show that it would be seen. Of IR- and a count of 0: each word that the pattern spells stands in some dump

Prints `ok <program>: <n> expectations` for a program that meets them all, one line `FAIL <program> TAB <expectation line> TAB <what is not met>`
for every expectation that is not met, then a summary line. Exits with 1 if anything failed. known-failures.txt lists the expectations that are known to fail today: they are reported but
do not fail the run, while a listed one that passes again does, so that the list only shrinks. --write-known rewrites the list.
"""
import concurrent.futures, os, re, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); import toolchain
PROGRAMS = os.path.realpath(os.environ.get('PROGRAMS', HERE + '/../parallel'))
WORK = os.environ.get('WORK') or tempfile.mkdtemp(prefix='aot-expectations-')
os.makedirs(WORK, exist_ok=True)
LINE = re.compile(r'^// (IR\+|IR-|IR=|IR@=|IRT=|IRM=) (.*)$', re.M)
BEGINS_LIKE_A_LINE = re.compile(r'^[ \t]*//[ \t]*((?:[A-Z]+-)*[A-Z]{2,}(?:@=|[+=<:-]))(?=[ \t]|$).*$', re.M)
READ_ELSEWHERE = {'STATISTIC:', 'TODO:'}
READ_BY_NOTHING = re.compile(r'^// (?:IR-UNTIL|KNOWN|PARTLY|UNKNOWN) .*$|^.*//! .+$', re.M)
WORD = re.compile(r'[A-Za-z_][A-Za-z0-9_]{2,}')
NO_WORD_OF_A_PATTERN = re.compile(r'\\(.)|\[\^?\]?(?:\\.|[^\]\\])*\]|\{\d*,?\d*\}|\(\?P?<\w+>')
FUNCTION_SOURCE_FIELD = re.compile(r' functionSource="(?:[^"\\\n]|\\.)*"')
ANYTHING_BETWEEN = r'[\s\S]*'
# The position may be followed by the origin's other words (tail, constructs), then by ` # ` and the sweep's marks.
PLACE_IN_SOURCE = re.compile(r' @\d+(?::\d+)?(?= tail\b| constructs\b| # |$)|$')
# The Code of a unit starts with `code f3:Body .. {`. A unit that the compiler does not make has the bare line `code f3:CoroutineBody` and one sentence under it.
HEADING_OF_A_UNIT = re.compile(r'code f(\d+):(\w+)( .*)?')
# The units that the compiler makes of the body of a function. The Body of an async function or a generator only creates the promise or the generator: its CoroutineBody holds the source.
ROLES = ('Body', 'CoroutineBody')


def source(name):
    """The file that quick.py compiles: program.<ext> of a folder, else its main.<ext>, the first by name, else <name>.<ext>."""
    for stem, extensions in (('%s/program', ('js', 'tsx', 'ts')), ('%s/main', ('cjs', 'cts', 'js', 'mjs', 'mts', 'ts', 'tsx')), ('%s', ('cjs', 'cts', 'js', 'mjs', 'mts', 'ts', 'tsx'))):
        for ext in extensions:
            path = '%s/%s.%s' % (PROGRAMS, stem % name, ext)
            if os.path.isfile(path): return path
    return None


def expectation_lines(text):
    # Two were written for BSD's grep, whose end of a word is spelled so.
    return [(kind, rest.replace('[[:>:]]', r'\b').replace('[[:<:]]', r'\b')) for kind, rest in LINE.findall(text)]


def lines_that_nothing_reads(text):
    begun = [found.group(0) for found in BEGINS_LIKE_A_LINE.finditer(text) if found.group(1) not in READ_ELSEWHERE and not LINE.fullmatch(found.group(0))]
    return begun + [found.group(0) for found in READ_BY_NOTHING.finditer(text)]


def other_files(name, path):
    """The files of the program's folder that are not compiled here as its entry point."""
    top = '%s/%s' % (PROGRAMS, name)
    return sorted(os.path.join(folder, file) for folder, _, files in os.walk(top) for file in files if re.search(r'\.([cm]?[jt]s|tsx)$', file) and os.path.join(folder, file) != path)


def spelled_words(pattern):
    """The words that a pattern spells out: what stands outside its classes, its escapes and its counts."""
    return set(WORD.findall(NO_WORD_OF_A_PATTERN.sub(lambda found: found.group(1) if found.group(1) and not found.group(1).isalnum() else ' ', pattern)))


def kind_and_rest(line):
    """Of `// <kind> <rest>`."""
    kind, _, rest = line[3:].partition(' ')
    return kind, rest


def is_met_by_nothing(kind, rest):
    return kind == 'IR-' or kind in ('IR=', 'IR@=', 'IRT=', 'IRM=') and rest.startswith('0 ')


def names_what_nothing_has(kind, rest, words_of_dumps):
    """What a line that is met where nothing matches names in vain, or None. `words_of_dumps`: one word a line."""
    if not is_met_by_nothing(kind, rest): return None
    # A word of a pattern may be a part of a word that is held.
    unseen = sorted(word for word in spelled_words(rest if kind == 'IR-' else rest.split(' ', 1 if kind == 'IRM=' else 2)[-1]) if word not in words_of_dumps)
    return 'the dump of no program holds %s' % ', '.join(unseen) if unseen else None


def programs_with_expectations():
    names = set()
    for folder, _, files in os.walk(PROGRAMS):
        for file in files:
            if not re.search(r'\.([cm]?[jt]s|tsx)$', file): continue
            text = open(os.path.join(folder, file), errors='replace').read()
            if LINE.search(text) or lines_that_nothing_reads(text):
                rel = os.path.relpath(os.path.join(folder, file), PROGRAMS).split('/')
                names.add('/'.join(rel[:2]) if len(rel) > 2 else re.sub(r'\.\w+$', '', '/'.join(rel)))
    return sorted(names)


def option_words(name):
    """(flags for the front end, option words for testaot), by the comment lines `// Flags:` of the program: see ../run-parallel.ts."""
    text = open(source(name), errors='replace').read()
    front_flags, words = toolchain.split_flags([flag for line in re.findall(r'^// Flags:[ \t]+(.*)$', text, re.M) for flag in line.split()])
    return front_flags, [*words, *os.environ.get('WORDS', '').split()]


def describe(failed):
    return 'testaot %s: %s' % ('ran out of its time' if failed.code is None else 'dies by signal %d' % -failed.code if failed.code < 0 else 'exits with %d' % failed.code, ' ~ '.join((failed.said or '').strip().split('\n')[-2:])[:300])


def dump_of(program, words):
    """(the records of the program, a line each, and (the number of a function, a role) -> the lines of the Code of that unit, for each unit that has Code). Raises toolchain.ToolFailed."""
    # The records hold the function source of each module, and with it these very lines: a pattern would find itself there.
    text = FUNCTION_SOURCE_FIELD.sub('', toolchain.print_program(program, words))
    records = [line for line in text.split('\n') if line and not line.startswith((' ', '}'))]
    numbers = [head.split(' ')[1][1:] for head in records if head.startswith('function ') and head.endswith(' {')]
    units, lines = {}, None
    for line in toolchain.print_code(program, ['f%s:%s' % (number, role) for number in numbers for role in ROLES], words).split('\n'):
        heading = HEADING_OF_A_UNIT.fullmatch(line)
        if heading: lines = units.setdefault(heading.group(1, 2), []) if heading.group(3) else None
        elif lines is not None: lines.append(line)
    return records, units


def code_of(units, numbers):
    """The number of a function -> the lines of its Code, for each of these functions that has Code."""
    found = {number: [line for role in ROLES for line in units.get((number, role), [])] for number in numbers}
    return {number: lines for number, lines in found.items() if lines}


class Failures:
    """Pairs each appended text with the expectation line it is about."""
    def __init__(self, into, line): self.into, self.line = into, line
    def append(self, text): self.into.append((self.line, text))


def entry_module(ir):
    """The id of the program's own module, or None. The front end gets one entry point."""
    found = re.search(r'^entry module=(m\d+)\b', ir, re.M)
    return found.group(1) if found else None


def check_program(name):
    path = source(name)
    if not path: return name, [('', 'no source')], 0, set()
    text = open(path, errors='replace').read()
    lines = expectation_lines(text)
    unread = [(line, 'nothing reads a line of this kind') for line in lines_that_nothing_reads(text)]
    for other in other_files(name, path):
        there = open(other, errors='replace').read()
        unread += [(line, 'only %s is read, and this stands in %s' % (os.path.basename(path), os.path.relpath(other, os.path.dirname(path)))) for line in [found.group(0) for found in LINE.finditer(there)] + lines_that_nothing_reads(there)]
    total = len(lines) + len(unread)
    work = '%s/%s' % (WORK, name.replace('/', '.'))
    front_flags, words = option_words(name)
    if os.path.exists(work + '.bin'): os.remove(work + '.bin')
    try: toolchain.front_end(path, work + '.bin', front_flags, cwd=os.path.dirname(path))
    except toolchain.ToolFailed: return name, [('', 'no IR')], total, set()
    failures = unread
    records, units = [], {}
    if lines:
        try:
            records, units = dump_of(work + '.bin', words)
            # An expectation of nothing is met by no Code at all.
            if not units: failures.append(('', 'THE DUMP HAS NO CODE'))
        except toolchain.ToolFailed as failed: failures.append(('', 'no dump: ' + describe(failed)))
    ir = '\n'.join(records + [line for unit in units.values() for line in unit])
    heads = [record.split(' ') for record in records if record.startswith('function ')]
    for kind, rest in lines:
        bad = Failures(failures, '// %s %s' % (kind, rest))
        if kind in ('IR+', 'IR-'):
            if bool(re.search(rest, ir, re.M)) != (kind == 'IR+'): bad.append('%s /%s/' % ('no line matches' if kind == 'IR+' else 'a line matches', rest))
            # `IR- <a declaration>[\s\S]*<a use of it>`: without the declaration there is no use to find.
            elif kind == 'IR-' and ANYTHING_BETWEEN in rest and not re.search(rest.split(ANYTHING_BETWEEN)[0], ir, re.M): bad.append('it cannot fail: nothing matches what it begins with, /%s/' % rest.split(ANYTHING_BETWEEN)[0])
        else:
            if kind == 'IRM=':
                count, pattern = rest.split(' ', 1); fn = 'the module'
                module = entry_module(ir)
                found = module and re.search(r'^module %s .*?\bbody=f(\d+)\b' % module, ir, re.M)
                numbers = [found.group(1)] if found else []
            else:
                count, fn, pattern = rest.split(' ', 2)
                numbers = [head[1][1:] for head in heads if head[2:3] == ['name="%s"' % fn]]
            code = code_of(units, numbers)
            # Nothing is found in a function without Code, whatever is looked for.
            if not code: bad.append('the function %s has no Code in the dump' % fn); continue
            functions = len(code) if kind == 'IRT=' else 1
            matching = [line for lines_of_function in code.values() for line in lines_of_function if re.search(pattern, line)]
            got = len({PLACE_IN_SOURCE.search(line).group(0) or line for line in matching}) if kind == 'IR@=' else len(matching)
            if got != int(count) * functions: bad.append('%s has %d %sof /%s/, not %s%s' % (fn, got, 'places ' if kind == 'IR@=' else '', pattern, count, ' in each of the %d functions of that name' % functions if functions > 1 else ''))
    if not failures and os.path.exists(work + '.bin'): os.remove(work + '.bin')
    return name, failures, total, set(WORD.findall(ir))


flags = [a for a in sys.argv[1:] if a.startswith('--')]
arguments = [a for a in sys.argv[1:] if not a.startswith('--')]
jobs = 8
if arguments[:1] == ['-j']: jobs = int(arguments[1]); arguments = arguments[2:]
for name in ('TESTAOT', 'FRONT_END'): toolchain.tool(name)
names = programs_with_expectations() if arguments == ['all'] else arguments
# known-failures.txt: see the top of this file.
KNOWN = HERE + '/known-failures.txt'
known = {tuple(line.split('\t', 1)) for line in open(KNOWN).read().split('\n') if line and not line.startswith('#')} if os.path.isfile(KNOWN) else set()
failed = total = old = 0
seen = set()
with concurrent.futures.ThreadPoolExecutor(jobs) as pool: checked = list(pool.map(check_program, names))
if arguments == ['all']:
    words_of_dumps = '\n'.join(sorted(set().union(*(words for *_, words in checked))))
    for name, bad, *_ in checked:
        for kind, rest in expectation_lines(open(source(name), errors='replace').read()) if source(name) else []:
            in_vain = names_what_nothing_has(kind, rest, words_of_dumps)
            if in_vain and '// %s %s' % (kind, rest) not in [line for line, _ in bad]: bad.append(('// %s %s' % (kind, rest), 'it cannot fail: ' + in_vain))
for name, bad, count, _ in checked:
    total += count
    seen |= {(name, line) for line, _ in bad}
    new = [text for line, text in bad if (name, line) not in known]
    old += len(bad) - len(new)
    if new:
        failed += 1
        for line, text in bad:
            if (name, line) not in known: print('FAIL %s\t%s\t%s' % (name, line, text))
    else: print('ok   %s: %d expectations%s' % (name, count - len(bad), ', %d known failures' % len(bad) if bad else ''))
if '--write-known' in flags: open(KNOWN, 'w').write('# <program> TAB <expectation line>: expectations that are known to fail today. See expectations.py.\n' + ''.join('%s\t%s\n' % pair for pair in sorted(seen)))
# Whether a line names what no program has, only a run over all of them can tell.
fixed = sorted(pair for pair in known - seen if pair[0] in names and (pair[0], '') not in seen and (arguments == ['all'] or not is_met_by_nothing(*kind_and_rest(pair[1]))))
for pair in fixed: print('PASSES AGAIN, remove it from known-failures.txt: %s: %s' % pair)
print('%d programs, %d expectation lines: %d programs fail; %d lines are known failures' % (len(names), total, failed, old))
sys.exit(1 if failed or fixed else 0)
