#!/usr/bin/env python3
"""Checks what the compiler generates for a program, not only what the program prints.

These are the positive and negative tests of the optimizations. A program under ../parallel states its expectations in comment
lines; this script reads them and checks them with `testaot` and the `jsc` shell, without building Bun.
../generated-code-is-what-the-programs-say.test.ts runs it over all of them.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> test/aot/shell/expectations.py [-j <jobs>] [--write-known] <program>... | all

See toolchain.py for how to build the three tools and quick.py for how a program is named. PROGRAMS, WORK and WORDS mean the same as in quick.py.
A program is compiled as most of a large program is: no function is among the hottest (`heat=nothing-is-hottest`), unless WORDS or an
`--aot-heat=` flag in its `// Flags:` line says otherwise.

Checked against the IR that `testaot print --until=<PassID>` prints, without the text of the modules, which it quotes and which holds these very lines, on every platform:
    // IR+ <regex>                     some line matches
    // IR- <regex>                     no line matches
    // IR= <n> <function> <regex>      exactly n lines match in the function of that name (not in copies inlined elsewhere)
    // IR@= <n> <function> <regex>     the lines that match in it come from exactly n places of the source: what a pass has copied (the first turn of a loop, a loop in two
                                       versions, a path that has left a loop) counts once
    // IRT= <n> <function> <regex>     the same as IR=, only in its typed bodies: those entered with proven arguments (role Source, AllocatedThisVersion or
                                       ResultWorker), not its GenericVersion; n lines match in each
    // IRM= <n> <regex>                the same, in the top-level code of the program's own module, also where it awaits
    // IR-UNTIL <PassID>               at most one in a program: its IR lines are read after the first run of that pass. Default: NumberLiteralStrings, the end
                                       of form Prepared. A line about a slot access or a grouped operation needs a pass of form Selected or later.
                                       RemoveRedundantBarriers runs after placement and is the last that changes a body
Checked against the allocation remarks (the test command `allocation-remarks` of `testaot run`), on every platform:
    <code> //! <remark> { ; <remark> } the allocations in this source line, in order of position. A remark is the start of what the compiler reports:
                                       removed | frame | heap [: <operation>] | allocated at <n> sites [: <operation>]. A line without the comment is not judged
Checked against the machine code, found through the map file (--aotMapFilePath), on ARM64 and x86-64:
    // CALLS+ <function> <regex>       the summary line of the function's machine code matches (see calls() below)
    // CALLS- <function> <regex>       it does not match
    // JSCALLS+ | JSCALLS- <function> <regex>    the same, of the program compiled without its type annotations (--aot-erase-types)
On ARM64 only, counted as skipped elsewhere: a CALLS or JSCALLS line that asks for more than what the function calls, and
    // SIZE< <function> <bytes>        the typed function's code is smaller than that
On ARM64 and x86-64, each with a limit of its own:
    // ENTRY-SIZE< <function> <bytes on ARM64> <bytes on x86-64>    the function's generic entrypoint is smaller than that; a function that needs none has 0 bytes
Checked against the regular expressions compiled into the image (the X lines of the map file), on every platform:
    // KNOWN <word> <source>           the source is known at build time, so its code is in the image
    // PARTLY <word> <source>          the same, for the flags that were predicted
    // UNKNOWN <source>                its code is not in the image
Checked against the stubs of the image (the T lines of the map file), on every platform:
    // THUNKS< <n>                     fewer than n stubs with a bound immediate (an operation, a count, a name: `#<immediate>`, or ` to <operation>` for an operation, ends the stub's name) are in the image
Checked against the size of the data that describes the program to the run time (the Z line of the map file), on every platform:
    // DATA< <bytes>                   it is smaller than that
    // MESSAGE-DATA< <n>               fewer than n layouts carry what only the text of a type error reads
    // TYPES< <n>                      fewer than n types are described to the run time
Checked against the counts that the shell writes when it exits (JSC_aotCountsPath), as an executable does, on every platform:
    // COUNTER: <RuntimeCounter | LimitID | operationAOT..> (= | >= | <=) <n>    the counter's value, how often the limit was met at run time, or how often compiled code called the operation of the run time. A counter that the shell does not write fails the line
                                       ../run-parallel.ts asks the same line of the executable that Bun builds. ` Todo: <why>` at its end is for that driver: here known-failures.txt says what is not met
Checked by quick.py, which runs the program in the shell and compares what it prints with what plain Bun prints (`$PLAIN`, or else the front end), on every platform:
    aotOperationCount | aotRuntimeCounters | aotBuiltinEntries    anywhere in its text: the program asks the shell itself what compiled code did, and says what it makes of the answer. It is one
                                       expectation, `asks <the functions>`. `all` takes a program for its comment lines alone: ../counts-pinned-by-programs.test.ts runs all that ask
Checked by compiling the program once more with the word `validate`, which tests every value against the type the engine trusts, on every platform:
    // VALIDATED compiles              the compiler finishes and writes an image
A line that can tell nothing fails its program, as one that is not met does:
    a line that begins like one of these and is none: capitals, then `+`, `-`, `=`, `@=`, `<` or `:`. Nothing reads it. `// STATISTIC:` and `// COUNT:` are read by ../run-parallel.ts, `// TODO:` by people
    a line of these kinds in a file of the program's folder that is not the file compiled here: only that file is read
    `// IR- <a declaration>[\\s\\S]*<a use of it>` where nothing in the dump matches the declaration
    with `all`, a line that says what must not be there and names what no program has: an operation or a stub that the compiler no longer has is absent from whatever it makes. Somewhere a program has
                                       to show that it would be seen. Of IR- and a count of 0: each word that the pattern spells stands in some dump. Of CALLS- and JSCALLS-: each of the
                                       pattern's alternatives matches the summary of some function

Prints `ok <program>: <n> expectations` for a program that meets them all, one line `FAIL <program> TAB <expectation line> TAB <what is not met>`
for every expectation that is not met, then a summary line. Exits with 1 if anything failed. known-failures.txt lists the expectations that are known to fail today: they are reported but
do not fail the run, while a listed one that passes again does, so that the list only shrinks. --write-known rewrites the list.
"""
import concurrent.futures, json, os, platform, re, struct, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); import quick, toolchain
PROGRAMS = os.path.realpath(os.environ.get('PROGRAMS', HERE + '/../parallel'))
WORK = os.environ.get('WORK') or tempfile.mkdtemp(prefix='aot-expectations-')
os.makedirs(WORK, exist_ok=True)
LINE = re.compile(r'^// (IR\+|IR-|IR=|IR@=|IRT=|IRM=|IR-UNTIL|CALLS\+|CALLS-|JSCALLS\+|JSCALLS-|SIZE<|ENTRY-SIZE<|KNOWN|PARTLY|UNKNOWN|THUNKS<|DATA<|MESSAGE-DATA<|TYPES<|COUNTER:|VALIDATED) (.*)$', re.M)
ALLOCATION = re.compile(r'//! (.+)$', re.M)
BEGINS_LIKE_A_LINE = re.compile(r'^[ \t]*//[ \t]*((?:[A-Z]+-)*[A-Z]{2,}(?:@=|[+=<:-]))(?=[ \t]|$).*$', re.M)
READ_ELSEWHERE = {'STATISTIC:', 'COUNT:', 'TODO:'}
WORD = re.compile(r'[A-Za-z_][A-Za-z0-9_]{2,}')
NO_WORD_OF_A_PATTERN = re.compile(r'\\(.)|\[\^?\]?(?:\\.|[^\]\\])*\]|\{\d*,?\d*\}|\(\?P?<\w+>')
TEXT_OF_A_MODULE = re.compile(r' (?:functionText|typesCutFromFunctionText)="(?:[^"\\\n]|\\.)*"')
ANYTHING_BETWEEN = r'[\s\S]*'
IR_KINDS = {'IR+', 'IR-', 'IR=', 'IR@=', 'IRT=', 'IRM='}
PLACE_IN_SOURCE = re.compile(r' @\d+(:\d+)?$|$')
SUFFIXES = ('.bin', '.img', '.validated.img', '.map', '.remarks.ir', '.counts', '.erased.bin', '.erased.img', '.erased.map')
ARM64 = platform.machine() in ('arm64', 'aarch64')
X86_64 = platform.machine() in ('x86_64', 'AMD64')
MORE_THAN_CALLS = re.compile(r'instructions|uses|tables|equality|ucvtf|scvtf|fcvtzs|fcmp')
# What IRT= and SIZE< mean by "typed body": a body entered with proven arguments. GenericVersion is the body for the others.
TYPED_BODY_ROLES = ('Source', 'AllocatedThisVersion', 'ResultWorker')
# The body that holds the source of an async function or a generator. Its CoroutineRamp only creates the promise or the generator.
COROUTINE_BODY_ROLES = ('CoroutineBody', 'AsyncWorker')
ROLE_CLASSES = {'Continuation': 'continuation', 'GenericEntrypoint': 'generic entrypoint', 'EntryChecks': 'entry', 'TableEntrypoint': 'entry', 'TableLookup': 'entry'}
BODY_ROLES = ('Source', 'Library', 'Model', 'GenericVersion', 'AllocatedThisVersion', 'CoroutineRamp', 'CoroutineBody', 'BoundFunction', 'ResultWrapper', 'ResultWorker', 'ParameterWrapper', 'OutlinedBody', 'Serializer', 'Parser',
              'ChainStep', 'StubBody', 'CalleeVersion', 'CallSiteVersion', 'ConstructBody', 'AsyncWorker')
# The role column of an F line of the map (describeFunctions) -> FunctionRole. `generic-<word of its target>` is a GenericEntrypoint.
# `entry` and `module` are the words of every function that holds top-level code of a module, whatever its role. None of them has a name.
MAP_ROLES = {'entry': 'Source', 'module': 'Source', 'typed': 'Source', 'untyped': 'Source', 'library': 'Library', 'model': 'Model', 'version': 'GenericVersion',
             'allocated this version': 'AllocatedThisVersion', 'ramp': 'CoroutineRamp', 'coroutine body': 'CoroutineBody', 'bound': 'BoundFunction', 'result-wrapper': 'ResultWrapper', 'result-worker': 'ResultWorker',
             'parameter-wrapper': 'ParameterWrapper', 'outlined': 'OutlinedBody', 'continuation': 'Continuation', 'serializer': 'Serializer', 'parser': 'Parser',
             'chain step': 'ChainStep', 'stub body': 'StubBody', 'callee version': 'CalleeVersion', 'call site version': 'CallSiteVersion', 'construct body': 'ConstructBody',
             'async worker': 'AsyncWorker', 'entry checks': 'EntryChecks', 'table entrypoint': 'TableEntrypoint', 'table lookup': 'TableLookup'}
# offsetof(ImageHeader, codeOffset) in AOTImageFormat.h: magic 8, stamp 8, identity 16, size 8. codeSize follows.
CODE_RANGE_IN_HEADER = 40


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
    return [found.group(0) for found in BEGINS_LIKE_A_LINE.finditer(text) if found.group(1) not in READ_ELSEWHERE and not LINE.fullmatch(found.group(0))]


def other_files(name, path):
    """The files of the program's folder that are not compiled here as its entry point."""
    top = '%s/%s' % (PROGRAMS, name)
    return sorted(os.path.join(folder, file) for folder, _, files in os.walk(top) for file in files if re.search(r'\.([cm]?[jt]s|tsx)$', file) and os.path.join(folder, file) != path)


def spelled_words(pattern):
    """The words that a pattern spells out: what stands outside its classes, its escapes and its counts."""
    return set(WORD.findall(NO_WORD_OF_A_PATTERN.sub(lambda found: found.group(1) if found.group(1) and not found.group(1).isalnum() else ' ', pattern)))


def alternatives(pattern):
    """The parts of a pattern between the `|` that stand in no group and in no class."""
    parts, depth, in_class, start, at = [], 0, False, 0, 0
    while at < len(pattern):
        sign = pattern[at]
        if sign == '\\': at += 1
        elif in_class: in_class = sign != ']'
        elif sign == '[':
            in_class = True
            at += pattern[at + 1:at + 2] == '^'
            at += pattern[at + 1:at + 2] == ']'
        elif sign in '()': depth += 1 if sign == '(' else -1
        elif sign == '|' and not depth: parts.append(pattern[start:at]); start = at + 1
        at += 1
    return parts + [pattern[start:]]


def is_met_by_nothing(kind, rest):
    return kind in ('IR-', 'CALLS-', 'JSCALLS-') or kind in ('IR=', 'IR@=', 'IRT=', 'IRM=') and rest.startswith('0 ')


def names_what_nothing_has(kind, rest, words_of_dumps, summaries):
    """What a line that is met where nothing matches names in vain, or None. `words_of_dumps`: one word a line. `summaries`: one function a line."""
    if not is_met_by_nothing(kind, rest): return None
    if kind in ('CALLS-', 'JSCALLS-'):
        if not is_checked_on_host(kind, rest): return None
        unseen = [part for part in alternatives(rest.split(' ', 1)[-1]) if not re.search(part, summaries, re.M)]
        return 'no function of any program calls /%s/' % '/, /'.join(unseen) if unseen else None
    # A word of a pattern may be a part of a word that is held.
    unseen = sorted(word for word in spelled_words(rest if kind == 'IR-' else rest.split(' ', 1 if kind == 'IRM=' else 2)[-1]) if word not in words_of_dumps)
    return 'the dump of no program holds %s' % ', '.join(unseen) if unseen else None


def programs_with_expectations():
    names = set()
    for folder, _, files in os.walk(PROGRAMS):
        for file in files:
            if not re.search(r'\.([cm]?[jt]s|tsx)$', file): continue
            text = open(os.path.join(folder, file), errors='replace').read()
            if LINE.search(text) or ALLOCATION.search(text) or lines_that_nothing_reads(text):
                rel = os.path.relpath(os.path.join(folder, file), PROGRAMS).split('/')
                names.add('/'.join(rel[:2]) if len(rel) > 2 else re.sub(r'\.\w+$', '', '/'.join(rel)))
    return sorted(names)


def program_options(name):
    """What the comment lines `// Flags:` and `// Env:` of the program say: see ../run-parallel.ts."""
    text = open(source(name), errors='replace').read()
    lines = lambda word: re.findall(r'^// %s:[ \t]+(.*)$' % word, text, re.M)
    return {'build': [flag for line in lines('Flags') for flag in line.split()],
            'env': dict(line.strip().split('=', 1) for word in ('Env', 'Env of the executable') for line in lines(word))}


def option_words(name):
    """(flags for the front end, option words for testaot)."""
    front_flags, words = toolchain.split_flags(program_options(name).get('build', []))
    if not any(word.startswith('heat=') for word in words): words = ['heat=nothing-is-hottest', *words]
    return front_flags, [*words, *os.environ.get('WORDS', '').split()]


def bodies(ir, wanted):
    """The lines of the functions whose head `wanted` accepts."""
    out, on = [], False
    for line in ir.split('\n'):
        if line.startswith('function '): on = wanted(line)
        if on: out.append(line)
    return out


def calls(image, map_file):
    """function -> a line about its machine code: `<function>: <n> instructions; <what it calls or jumps to, by name, sorted; another function as f:<name>>; uses <the kinds of floating-point
    instructions it has: ucvtf scvtf fcvtzs fcmp>; tables <number of br>; tests for equality with <the immediates of cmp xN | wN, #imm; b.eq | b.ne> .` On x86-64 only what it calls or jumps to is filled in. A function that is split at its calls is one function here.
    Of the bodies that have one name the typed one is described, not the ones for untyped callers. Of an async function or a generator the coroutine body is described, not the ramp. A function that only its generic entrypoint calls has no code of its own: its body is in that entrypoint, which is
    described in its place. A function without a name is a body that call sites of a built-in share, and `outlined <n>` is a piece of code that the outliner has taken out of several functions: what they call counts for their callers."""
    data = open(image, 'rb').read()
    offset, size = struct.unpack_from('<QQ', data, CODE_RANGE_IN_HEADER)
    if offset + size > len(data): sys.exit('the image header is not laid out as expectations.py expects')
    thunks, functions, first, waiting, sizes, ranks, entrypoint_sizes, copies, coroutines = {}, [], {}, {}, {}, [], {}, [], {}
    typed_body, coroutine_body, other_code = range(3)
    for line in open(map_file, errors='replace'):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'T': thunks[int(f[1])] = f[2]
        elif f[0] == 'C': copies.append(int(f[1]))
        elif f[0] == 'U' and len(f) > 4: functions.append((f[4], [(int(f[1]), int(f[2]))])); ranks.append(other_code)
        elif f[0] == 'F' and len(f) >= 10:
            name, part = f[-6], (int(f[2]), int(f[3]))
            role = 'GenericEntrypoint' if f[-5].startswith('generic-') else MAP_ROLES.get(f[-5], f[-5])
            kind = ROLE_CLASSES.get(role) or ('body' if role in BODY_ROLES else None)
            if kind is None: sys.exit('the map names a role that expectations.py does not know: ' + role)
            if role == 'Source': sizes.setdefault(name, part[1])
            if kind == 'continuation' and name in first: functions[first[name]][1].append(part)
            elif kind == 'continuation': waiting.setdefault(name, []).append(part)
            elif kind == 'generic entrypoint': functions.append((name + ' [generic entrypoint]', [part])); ranks.append(other_code); entrypoint_sizes.setdefault(name, part[1])
            elif kind == 'entry': functions.append((name + ' [' + role + ']', [part])); ranks.append(other_code)
            elif role in COROUTINE_BODY_ROLES and name in coroutines: functions[coroutines[name]][1].append(part)
            else:
                first[name] = len(functions); functions.append((name, [part] + waiting.pop(name, [])))
                ranks.append(typed_body if role in TYPED_BODY_ROLES else coroutine_body if role in COROUTINE_BODY_ROLES else other_code)
                if role in COROUTINE_BODY_ROLES: coroutines[name] = first[name]
    # A T line has an offset within a copy of the stubs, a C line the offset of a copy in the code.
    copies = copies or [0]
    stub_offsets = sorted(thunks)
    # The functions follow the last stub of the last copy.
    end_of_stubs = min((start - copies[-1] for _, parts in functions for start, _ in parts if start > copies[-1] + stub_offsets[-1]), default=stub_offsets[-1]) if stub_offsets else 0
    for stub_offset, next_stub_offset in zip(stub_offsets, stub_offsets[1:] + [end_of_stubs]):
        if thunks[stub_offset].startswith('outlined '): functions.append((thunks.pop(stub_offset), [(copy + stub_offset, next_stub_offset - stub_offset) for copy in copies])); ranks.append(other_code)
    thunks = {copy + stub_offset: name for copy in copies for stub_offset, name in thunks.items()}
    starts = {start: (name, i) for i, (name, parts) in enumerate(functions) for start, _ in parts}
    result, found = {}, []
    for number, (name, parts) in enumerate(functions):
        called, kinds, tested, tables, shared = set(), set(), set(), 0, set()

        def leads_to(target):
            if target in thunks: called.add(thunks[target])
            elif target in starts and starts[target][1] != number:
                called.add('f:' + starts[target][0])
                if not starts[target][0] or starts[target][0].startswith('outlined '): shared.add(starts[target][1])

        for start, length in parts:
            if not ARM64:
                code = data[offset + start:offset + start + length]
                for k in range(length - 4):  # call, jmp, jcc with 32 bits: taken for one where it leads to the start of a thunk or a function
                    size = 5 if code[k] in (0xe8, 0xe9) else 6 if code[k] == 0x0f and 0x80 <= code[k + 1] <= 0x8f and k + 6 <= length else 0
                    if size: leads_to(start + k + size + struct.unpack_from('<i', code, k + size - 4)[0])
                continue
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
                    leads_to(start + 4 * k + 4 * distance)
        found.append((called, kinds, tested, tables, shared))

    def reached(number, seen):
        called = set(found[number][0])
        for other in found[number][4] - seen: called |= reached(other, seen | {number, other})
        return called

    for number in sorted(range(len(functions)), key=ranks.__getitem__):
        name, parts = functions[number]
        _, kinds, tested, tables, _ = found[number]
        result.setdefault(name, '%s: %d instructions; %s; uses %s; tables %d; tests for equality with %s .' % (name, sum(length for _, length in parts) // 4, '; '.join(sorted(reached(number, {number}))), ' '.join(sorted(kinds)), tables, ' '.join(map(str, sorted(tested)))))
    for name, size in entrypoint_sizes.items():
        sizes[name + ' [generic entrypoint]'] = size
        if name not in result: result[name] = result[name + ' [generic entrypoint]']; sizes[name] = size
    return result, sizes


def is_checked_on_host(kind, rest):
    return ARM64 or X86_64 and kind != 'SIZE<' and not MORE_THAN_CALLS.search(rest)


class Failures:
    """Pairs each appended text with the expectation line it is about."""
    def __init__(self, into, line): self.into, self.line = into, line
    def append(self, text): self.into.append((self.line, text))


def function_role(head):
    found = re.search(r' role=(\w+)', head)
    return found.group(1) if found else 'Source'


def entry_module(ir):
    """The id of the program's own module, or None. The front end gets one entry point."""
    found = re.search(r'^entry module=(m\d+)\b', ir, re.M)
    return found.group(1) if found else None


def runtime_counters(name, path, image, counts, entry, operations):
    """(the program's exit code in the shell, counter -> its value when the shell exits). The second is None if the module threw.
    A program whose module has been evaluated goes on in its promise jobs and timers, so the counts are read from the file `counts`, which the shell writes at exit.
    The file lists the operations that were called. The shell is asked for each of `operations` by name, so that one that was not called counts 0; a name that it does not know ends the script, and what is behind it has no counter."""
    asked = ['aotOperationCount("%s"); print("@operation:%s")' % (operation, operation) for operation in operations]
    exit_code, output = toolchain.run_image(image, entry, {**toolchain.run_environment(program_options(name)), 'JSC_aotCountsPath': os.path.abspath(counts)}, after=['print("@evaluated")', *asked], cwd=os.path.dirname(path))
    printed = output.split('\n')
    if '@evaluated' not in printed or not os.path.isfile(counts): return exit_code, None
    counters = {operation: 0 for operation in operations if '@operation:' + operation in printed}
    for line in open(counts, errors='replace').read().split('\n'):
        count, _, what = line.partition('\t')
        kind, _, counter = what.partition(':')
        if count.isdigit() and (kind in ('counter', 'exit', 'limit') or kind == 'operation' and counter in counters): counters[counter] = counters.get(counter, 0) + int(count)
    return exit_code, counters


def counter_failure(rest, counters, exit_code):
    """Why a COUNTER: line is not met, or None."""
    if counters is None: return 'the program ends with %s before its counters are printed' % exit_code
    found = re.fullmatch(r'(\w+) (=|>=|<=) (\d+)(?: Todo: .+)?', rest.strip())
    if not found: return 'not of the form <RuntimeCounter> (= | >= | <=) <n>'
    counter, relation, limit = found.group(1), found.group(2), int(found.group(3))
    if counter not in counters: return 'no counter %s' % counter
    value = counters[counter]
    return None if {'=': value == limit, '>=': value >= limit, '<=': value <= limit}[relation] else '%s is %d' % (counter, value)


def expected_remarks(path):
    """[(the number of a source line, the remarks its //! comment lists)], for each line that has the comment."""
    found = []
    for number, line in enumerate(open(path, errors='replace').read().split('\n'), 1):
        comment = ALLOCATION.search(line)
        if comment: found.append((number, [item.strip() for item in comment.group(1).split(';')]))
    return found


def remark_failures(work, words, remarks, path):
    """Checks the //! comments. `allocation-remarks` prints `<file>:<line>: <remark>` for each allocation, function by function. What else the build says about the program, a warning for one, is not asked here."""
    try: text = toolchain.print_program(work + '.bin')
    except toolchain.ToolFailed: return [('//!', 'no IR text')]
    _, output = toolchain.run_ir_test(text, work + '.remarks.ir', ['RUN: allocation-remarks', 'OPTIONS: references=narrow report=allocations ' + ' '.join(words)], show_output=True)
    if not re.search(r'^OUTPUT ', output, re.M): return [('//!', 'no remarks: ' + output[-200:].replace('\n', ' | '))]
    printed = {}
    for line, remark in re.findall(r'^%s:(\d+): (.*)$' % re.escape(os.path.basename(path)), output, re.M): printed.setdefault(int(line), []).append(remark)
    return [('//!', 'line %d: %s, not %s' % (number, '; '.join(printed.get(number, [])) or 'no remark', '; '.join(items))) for number, items in remarks
            if len(printed.get(number, [])) != len(items) or not all(got.startswith(item) for got, item in zip(printed[number], items))]


def counts_failure(name):
    """Why what the program itself says about its counts does not hold in the shell, or None."""
    env = {**os.environ, 'KNOWS_SHELL_FUNCTIONS': '1', 'PROGRAMS': PROGRAMS, 'WORK': WORK + '/counts', 'PLAIN': os.environ.get('PLAIN') or toolchain.tool('FRONT_END')}
    _, said = toolchain.run([sys.executable, HERE + '/quick.py', name], seconds=900, env=env)
    verdict = next((line[len(name) + 2:] for line in said.split('\n') if line.startswith(name + ': ')), 'quick.py has no verdict: ' + ' | '.join(said.strip().split('\n')[-2:])[:200])
    # counts-known.txt is to those what known-failures.txt is to the lines.
    return None if re.match(r'same \(|skipped: TODO: ', verdict) else verdict


def check_program(name):
    path = source(name)
    if not path: return name, [('', 'no source')], 0, 0, set(), set()
    text = open(path, errors='replace').read()
    asks = quick.functions_that_count('%s/%s' % (PROGRAMS, name), path)
    lines = expectation_lines(text)
    remarks = expected_remarks(path)
    unread = [(line, 'nothing reads a line of this kind') for line in lines_that_nothing_reads(text)]
    for other in other_files(name, path):
        there = open(other, errors='replace').read()
        # ../run-parallel.ts asks a COUNTER: line wherever it stands.
        unread += [(line, 'only %s is read, and this stands in %s' % (os.path.basename(path), os.path.relpath(other, os.path.dirname(path)))) for line in [found.group(0) for found in LINE.finditer(there) if found.group(1) != 'COUNTER:'] + lines_that_nothing_reads(there)]
        if ALLOCATION.search(there): unread.append(('//!', 'only %s is read, and a remark stands in %s' % (os.path.basename(path), os.path.relpath(other, os.path.dirname(path)))))
    total = len(lines) + sum(len(items) for _, items in remarks) + bool(asks) + len(unread)
    work = '%s/%s' % (WORK, name.replace('/', '.'))
    front_flags, words = option_words(name)
    for suffix in SUFFIXES:
        if os.path.exists(work + suffix): os.remove(work + suffix)
    try: toolchain.front_end(path, work + '.bin', front_flags, cwd=os.path.dirname(path))
    except toolchain.ToolFailed: return name, [('', 'no IR')], total, 0, set(), set()
    failures, skipped = unread, 0
    kinds = {kind for kind, _ in lines}
    last_passes = [rest.strip() for kind, rest in lines if kind == 'IR-UNTIL']
    if len(last_passes) > 1: failures.append(('', 'more than one IR-UNTIL'))
    ir = ''
    if kinds & IR_KINDS:
        # The dump quotes the text of each module, and with it these very lines: a pattern would find itself there.
        try: ir = TEXT_OF_A_MODULE.sub('', toolchain.print_program(work + '.bin', last_passes[0] if last_passes else toolchain.OPTIMIZED, words))
        except toolchain.ToolFailed: pass
    # An expectation of nothing is met by no dump at all.
    if kinds & IR_KINDS and not re.search(r'^function ', ir, re.M): failures.append(('', 'THE DUMP HAS NO FUNCTION'))
    called, sizes = {}, {}
    expressions = set()
    thunks = None
    entries = []
    if kinds & {'CALLS+', 'CALLS-', 'SIZE<', 'ENTRY-SIZE<'} and (ARM64 or X86_64) or kinds & {'KNOWN', 'PARTLY', 'UNKNOWN', 'THUNKS<', 'DATA<', 'MESSAGE-DATA<', 'TYPES<', 'COUNTER:'}:
        try: entries = toolchain.compile_image(work + '.bin', work + '.img', ['check=validate-references', *words], ['--aotMapFilePath=' + work + '.map'])
        except toolchain.ToolFailed as failed: failures.append(('', 'not compiled: testaot %s: %s' % ('ran out of its time' if failed.code is None else 'dies by signal %d' % -failed.code if failed.code < 0 else 'exits with %d' % failed.code, ' ~ '.join((failed.said or '').strip().split('\n')[-2:])[:300])))
        else:
            if ARM64 or X86_64: called, sizes = calls(work + '.img', work + '.map')
            # The map writes a backslash twice.
            expressions = {line.rstrip('\n').split('\t')[5].replace('\\\\', '\\') for line in open(work + '.map', errors='replace') if line.startswith('X') and line.count('\t') >= 5}
            thunks = sum(1 for line in open(work + '.map', errors='replace') if re.match(r'T\t\d+\t.*(#\d+| to \w+)$', line))
    called_without_types = {}
    if kinds & {'JSCALLS+', 'JSCALLS-'} and (ARM64 or X86_64):
        try:
            toolchain.front_end(path, work + '.erased.bin', [*front_flags, '--aot-erase-types'], cwd=os.path.dirname(path))
            toolchain.compile_image(work + '.erased.bin', work + '.erased.img', ['check=validate-references', *words], ['--aotMapFilePath=' + work + '.erased.map'])
        except toolchain.ToolFailed as failed: failures.append(('', 'not compiled without its types: %s' % failed.code))
        else: called_without_types = calls(work + '.erased.img', work + '.erased.map')[0]
    exit_code, counters = runtime_counters(name, path, work + '.img', work + '.counts', entries[0], [rest.split()[0] for kind, rest in lines if kind == 'COUNTER:' and rest.startswith('operationAOT')]) if entries and 'COUNTER:' in kinds else (None, None)
    for kind, rest in lines:
        bad = Failures(failures, '// %s %s' % (kind, rest))
        if kind == 'IR-UNTIL': continue
        elif kind in ('IR+', 'IR-'):
            if bool(re.search(rest, ir, re.M)) != (kind == 'IR+'): bad.append('%s /%s/' % ('no line matches' if kind == 'IR+' else 'a line matches', rest))
            # `IR- <a declaration>[\s\S]*<a use of it>`: without the declaration there is no use to find.
            elif kind == 'IR-' and ANYTHING_BETWEEN in rest and not re.search(rest.split(ANYTHING_BETWEEN)[0], ir, re.M): bad.append('it cannot fail: nothing matches what it begins with, /%s/' % rest.split(ANYTHING_BETWEEN)[0])
        elif kind in ('IR=', 'IR@=', 'IRT=', 'IRM='):
            if kind == 'IRM=':
                count, pattern = rest.split(' ', 1); fn = 'the module'
                module = entry_module(ir)
                found = module and re.search(r'^module %s .*?\bbody=(f\d+)\b' % module, ir, re.M)
                # The code of a module that awaits is in the body of a coroutine: `body` names the ramp, which only makes the promise.
                body = bodies(ir, lambda head: head.split(' ')[1] == found.group(1) or re.search(r' creator=Coroutine\{[^}]*\bramp=%s\b' % found.group(1), head)) if found else []
            else:
                count, fn, pattern = rest.split(' ', 2)
                body = bodies(ir, lambda head: head.split(' ')[2] == 'name="%s"' % fn and (kind != 'IRT=' or function_role(head) in TYPED_BODY_ROLES))
            # A function all of whose calls were copied has no body any more: nothing is found in it, whatever is looked for.
            if not any(' = ' in line for line in body): bad.append('the function %s has no body in the dump' % fn); continue
            typed_bodies = sum(1 for line in body if line.startswith('function ')) if kind == 'IRT=' else 1
            matching = [line for line in body if re.search(pattern, line)]
            got = len({PLACE_IN_SOURCE.search(line).group(0) or line for line in matching}) if kind == 'IR@=' else len(matching)
            if got != int(count) * typed_bodies: bad.append('%s has %d %sof /%s/, not %s%s' % (fn, got, 'places ' if kind == 'IR@=' else '', pattern, count, ' in each of its %d typed bodies' % typed_bodies if typed_bodies > 1 else ''))
        elif kind in ('KNOWN', 'PARTLY'):
            if rest.split(' ', 1)[1] not in expressions: bad.append('not in the image: %s' % rest[:70])
        elif kind == 'UNKNOWN':
            if rest in expressions: bad.append('in the image, and not known: %s' % rest[:70])
        elif kind == 'TYPES<':
            counts = [int(line.split('\t')[3]) for line in open(work + '.map', errors='replace') if line.startswith('Z\t') and line.count('\t') > 2] if os.path.isfile(work + '.map') else []
            if not (counts and counts[0] < int(rest)): bad.append('%s types are described, not under %s' % (counts[0] if counts else '?', rest))
        elif kind == 'MESSAGE-DATA<':
            counts = [int(line.split('\t')[2]) for line in open(work + '.map', errors='replace') if line.startswith('Z\t') and line.count('\t') > 1] if os.path.isfile(work + '.map') else []
            if not (counts and counts[0] < int(rest)): bad.append('%s layouts carry what only a message reads, not under %s' % (counts[0] if counts else '?', rest))
        elif kind == 'DATA<':
            sizes_of_data = [int(line.split('\t')[1]) for line in open(work + '.map', errors='replace') if line.startswith('Z\t')] if os.path.isfile(work + '.map') else []
            if not (sizes_of_data and 0 < sizes_of_data[0] < int(rest)): bad.append('the data is %s bytes, not under %s' % (sizes_of_data[0] if sizes_of_data else '?', rest))
        elif kind == 'VALIDATED':
            try: toolchain.compile_image(work + '.bin', work + '.validated.img', [*words, 'validate'])
            except toolchain.ToolFailed as failed: bad.append('not compiled with validation: testaot exits with %s' % failed.code)
        elif kind == 'THUNKS<':
            if thunks is None or not 0 < thunks < int(rest): bad.append('%s stubs have a bound immediate, not between 1 and %s' % (thunks, rest))
        elif kind == 'COUNTER:':
            failure = counter_failure(rest, counters, exit_code) if entries else None
            if failure: bad.append(failure)
        elif not is_checked_on_host(kind, rest): skipped += 1
        elif kind == 'ENTRY-SIZE<':
            fn, on_arm64, on_x86_64 = rest.split()
            limit = int(on_arm64 if ARM64 else on_x86_64)
            if fn not in called: bad.append('no function %s in the image' % fn); continue
            if sizes.get(fn + ' [generic entrypoint]', 0) >= limit: bad.append('the generic entrypoint of %s is %d bytes, not under %d' % (fn, sizes[fn + ' [generic entrypoint]'], limit))
        elif kind == 'SIZE<':
            fn, limit = rest.split()
            if not (fn in sizes and sizes[fn] < int(limit)): bad.append('%s is %s bytes, not under %s' % (fn, sizes.get(fn, '?'), limit))
        else:
            fn, pattern = rest.split(' ', 1)
            summaries = called_without_types if kind.startswith('JS') else called
            if fn not in summaries: bad.append('no function %s in the image' % fn); continue
            if bool(re.search(pattern, summaries[fn])) != kind.endswith('+'): bad.append('%s %s /%s/' % (fn, 'does not call' if kind.endswith('+') else 'calls', pattern))
    if remarks: failures += remark_failures(work, words, remarks, path)
    if asks:
        failure = counts_failure(name)
        if failure: failures.append(('asks ' + ', '.join(asks), failure))
    if not failures:
        for suffix in SUFFIXES:
            if os.path.exists(work + suffix): os.remove(work + suffix)
    return name, failures, total, skipped, set(WORD.findall(ir)), {*called.values(), *called_without_types.values()}


flags = [a for a in sys.argv[1:] if a.startswith('--')]
arguments = [a for a in sys.argv[1:] if not a.startswith('--')]
jobs = 8
if arguments[:1] == ['-j']: jobs = int(arguments[1]); arguments = arguments[2:]
for name in ('JSC', 'TESTAOT', 'FRONT_END'): toolchain.tool(name)
names = programs_with_expectations() if arguments == ['all'] else arguments
# known-failures.txt: see the top of this file.
KNOWN = HERE + '/known-failures.txt'
known = {tuple(line.split('\t', 1)) for line in open(KNOWN).read().split('\n') if line and not line.startswith('#')} if os.path.isfile(KNOWN) else set()
failed = total = untried = old = 0
seen = set()
with concurrent.futures.ThreadPoolExecutor(jobs) as pool: checked = list(pool.map(check_program, names))
if arguments == ['all']:
    words_of_dumps, summaries = ('\n'.join(sorted(set().union(*(program[member] for program in checked)))) for member in (4, 5))
    for name, bad, *_ in checked:
        for kind, rest in expectation_lines(open(source(name), errors='replace').read()) if source(name) else []:
            in_vain = names_what_nothing_has(kind, rest, words_of_dumps, summaries)
            if in_vain and '// %s %s' % (kind, rest) not in [line for line, _ in bad]: bad.append(('// %s %s' % (kind, rest), 'it cannot fail: ' + in_vain))
for name, bad, count, skipped, *_ in checked:
    total += count; untried += skipped
    seen |= {(name, line) for line, _ in bad}
    new = [text for line, text in bad if (name, line) not in known]
    old += len(bad) - len(new)
    if new:
        failed += 1
        for line, text in bad:
            if (name, line) not in known: print('FAIL %s\t%s\t%s' % (name, line, text))
    else: print('ok   %s: %d expectations%s%s' % (name, count - skipped - len(bad), ', %d skipped on this platform' % skipped if skipped else '', ', %d known failures' % len(bad) if bad else ''))
if '--write-known' in flags: open(KNOWN, 'w').write('# <program> TAB <expectation line>: expectations that are known to fail today. See expectations.py.\n' + ''.join('%s\t%s\n' % pair for pair in sorted(seen)))
# Whether a line names what no program has, only a run over all of them can tell.
fixed = sorted(pair for pair in known - seen if pair[0] in names and (pair[0], '') not in seen and (not re.match(r'// (JSCALLS|CALLS|SIZE)', pair[1]) or is_checked_on_host(*pair[1][3:].split(' ', 1)))
               and (arguments == ['all'] or not is_met_by_nothing(*pair[1][3:].split(' ', 1))))
for pair in fixed: print('PASSES AGAIN, remove it from known-failures.txt: %s: %s' % pair)
print('%d programs, %d expectation lines: %d programs fail; %d lines are known failures%s' % (len(names), total, failed, old, '; %d lines are for ARM64 only and were skipped' % untried if untried else ''))
sys.exit(1 if failed or fixed else 0)
