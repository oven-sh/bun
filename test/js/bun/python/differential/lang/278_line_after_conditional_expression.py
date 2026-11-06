# `x = (a or b) if c else d` is told of twice: in CPython the jump over the other value is of no line if a branch leads to it, so what comes after the expression is a
# line that begins. Not so where what comes after it is short and ends the function: that is copied to where the jump was, and then there is no jump to be told of either.
import contextlib
import sys
import textwrap

M = sys.monitoring
E = M.events

PRELUDE = '''
def g(a, b, c, d):
    yield (a or b) if c else d
def f(a, b, c, d):
    global G
    o = O(); l = [0, 1]; l2 = [1, 2]; x = 0
    y = 0
%s
'''


class O:
    pass


def n(*x, **k):
    return 1


@contextlib.contextmanager
def cm(*x):
    yield


def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end:
            return line


def run(function, args, log):
    try:
        result = function(*args)
        if hasattr(result, 'send'):
            list(result)
    except Exception as e:
        log.append(type(e).__name__)


def lines(function, args):
    log = []

    def trace(frame, event, arg):
        if frame.f_code.co_filename != 'generated':
            return None
        if event == 'line':
            log.append(str(frame.f_lineno))
        return trace
    sys.settrace(trace)
    try:
        run(function, args, log)
    finally:
        sys.settrace(None)
    return ' '.join(log[2:])


def jumps(function, args):
    log = []

    def callback(name):
        def told(code, source, destination):
            if code.co_filename == 'generated':
                log.append('%s%s>%s' % (name, line_of(code, source), line_of(code, destination)))
        return told
    M.use_tool_id(1, 'test')
    for event, name in ((E.BRANCH_LEFT, 'L'), (E.BRANCH_RIGHT, 'R'), (E.JUMP, 'J')):
        M.register_callback(1, event, callback(name))
    M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP)
    try:
        run(function, args, log)
    finally:
        M.set_events(1, 0)
        M.free_tool_id(1)
    return ' '.join(log)


def show(title, body, with_jumps):
    code = compile(PRELUDE % textwrap.indent(body, ' ' * 4), 'generated', 'exec')
    namespace = {'O': O, 'n': n, 'cm': cm}
    exec(code, namespace)
    rows = []
    for args in ((0, 1, 1, 0), (1, 1, 1, 0), (0, 0, 0, 0)):
        row = lines(namespace['f'], args)
        if with_jumps:
            row += ' | ' + jumps(namespace['f'], args)
        rows.append(row)
    print(title)
    for row in dict.fromkeys(rows):
        print('   ', row)


# What the first value is, and what uses the value of the expression.
for body in (
    'x = (a or b) if c else d',
    'x = (a and b) if c else d',
    'x = (a or b or d) if c else d',
    'x = (a and b or d) if c else d',
    'x = (not (a or b)) if c else d',
    'x = (a < b < c) if c else d',
    'x = ((a or b) if b else c) if c else d',
    'x = (a if b else (c or d)) if c else d',
    'x = ((a or b) if b else (c or d)) if c else d',
    'x = a if not c else ((a or b) if c else d)',
    'x = a if not c else (a or b)',
    'x = (0 or b) if c else d',
    'x = (1 or b) if c else d',
    'x = (a or 1) if c else d',
    'x = (1 and b) if c else d',
    'x = (a or b) if 1 else d',
    'x = (a or b) if 0 else d',
    'x = (w := a or b) if c else d',
    'n((w := (a or b) if c else d))',
    'x = n((a or b) if c else d)',
    'x = ((a or b) if c else d, 1)',
    'o.x = (a or b) if c else d',
    'l[0] = (a or b) if c else d',
    'G = (a or b) if c else d',
    'y += (a or b) if c else d',
    'x: int = (a or b) if c else d',
    '(a or b) if c else d',
    'x = z = (a or b) if c else d',
    'x, z = (a or l2) if c else l2',
    'x = ((a or b) if c else d) + 1',
    'x = ((a or b) if c else d) or b',
    'if (a or b) if c else d:\n    x = 1',
    'while (a or b) if c else d:\n    break',
    'assert (a or b) if c else 1',
    'x = [(i or b) if c else d for i in (0, 1)]',
    'x = list((i or b) if c else d for i in (0, 1))',
    'x = (lambda: (a or b) if c else d)()',
    'x = f"{(a or b) if c else d}"',
    'x = list(g(a, b, c, d))',
    'x = ((a or b) if c\n    else d)',
    'x = ((a or\n    b) if c\n    else d)',
    '(\n    x) = ((a or b) if c else d)',
    'x = (a or b) if c else d; y = 1',
    'x = n(x=(a or b) if c else d)',
    'def h(k=(a or b) if c else d): pass',
    'x = l2[(a or b) if c else d]',
    'x = l2[(a or b) if c else d:]',
    'x = [*((a or l2) if c else l2)]',
    'x = {1: (a or b) if c else d}',
    'x = ((a or b) if c else d) == 1',
    'x = -((a or b) if c else d)',
    'del l[(a and d) if c else d]',
    'with cm((a or b) if c else d):\n    pass',
    'for i in (a or l2) if c else l2:\n    pass',
    'match (a or b) if c else d:\n    case 1:\n        pass',
):
    show(body, body + '\ny = 2', False)

VALUES = ('(a or b) if c else d', 'a if c else d')
# What comes after the expression, up to the end of the function.
for value in VALUES:
    for form in ('x = V', 'x: int = V', 'y += V', 'x = z = V', 'o.x = V', 'G = V', 'x = n(V)', 'x = -(V)', 'n(V)', 'return V', 'return n(V)', 'return -(V)', 'return (V) + 1', 'return (V, 1)',
                 'return [V, 1, 2]', 'raise KeyError(V)', 'raise V', 'return (V).real', 'return not (V)', 'x = (V) + 1', 'x = (V).real', 'yield V', 'x = yield V', 'return (V) is None', 'return l[V]',
                 'x, z = V, 1', 'del l[V]', 'return n(1, V)', 'return n(x=V)'):
        for after in ('', 'return x', 'return 1', 'return', 'return x.real', 'return x + 1', 'raise KeyError', 'y = 2', 'pass', 'return G', 'return not x'):
            if after and form.startswith(('return', 'raise')):
                continue
            show('%s / %r' % (form.replace('V', value), after), form.replace('V', value) + '\n' + after, True)

# In blocks.
for value in VALUES:
    for name, context in {
        'for': 'for i in (1, 2):\n{S4}',
        'for for': 'for i in (1, 2):\n    for j in (1, 2):\n{S8}',
        'while': 'while y < 2:\n    y += 1\n{S4}',
        'try': 'try:\n{S4}\nexcept ValueError:\n    pass',
        'try in for': 'for i in (1, 2):\n    try:\n{S8}\n    except ValueError:\n        pass',
        'except': 'try:\n    raise ValueError\nexcept ValueError:\n{S4}',
        'except as': 'try:\n    raise ValueError\nexcept ValueError as e:\n{S4}',
        'try finally': 'try:\n{S4}\nfinally:\n    y = 3',
        'with': 'with cm():\n{S4}',
        'if': 'if c or not c:\n{S4}',
        'if else': 'if c or not c:\n{S4}\nelse:\n    y = 5',
        'else': 'if not (c or not c):\n    y = 5\nelse:\n{S4}',
        'if, then more': 'if c or not c:\n{S4}\ny = 7\ny = 8\ny = 9',
        'match': 'match 1:\n    case 1:\n{S8}\n    case 2:\n        y = 5',
        'try else': 'try:\n    pass\nexcept ValueError:\n    pass\nelse:\n{S4}',
        'elif': 'if not (c or not c):\n    y = 5\nelif c or not c:\n{S4}',
        'elif else': 'if not (c or not c):\n    y = 5\nelif c or not c:\n{S4}\nelse:\n    y = 6',
        'default case': 'match 1:\n    case 2:\n        y = 5\n    case _:\n{S8}',
        'if else in if': 'if c or not c:\n    if c or not c:\n{S8}\n    else:\n        y = 5',
        'if else in if else': 'if c or not c:\n    if c or not c:\n{S8}\n    else:\n        y = 5\nelse:\n    y = 6',
        'if in try': 'try:\n    if c or not c:\n{S8}\n    else:\n        y = 5\nexcept ValueError:\n    pass',
        'try in try': 'try:\n    try:\n{S8}\n    except KeyError:\n        pass\nexcept ValueError:\n    pass',
        'try in if else': 'if c or not c:\n    try:\n{S8}\n    except KeyError:\n        pass\nelse:\n    y = 5',
        'except in for': 'for i in (1, 2):\n    try:\n        raise ValueError\n    except ValueError:\n{S8}',
        'with in for': 'for i in (1, 2):\n    with cm():\n{S8}',
        'while in for': 'for i in (1, 2):\n    while y < 9:\n        y += 1\n{S8}',
    }.items():
        for form in ('return V', 'x = V\nreturn x', 'x = V\nreturn 1', 'x = V', 'x = V\nreturn', 'return n(V)', 'raise KeyError(V)', 'x = V\nraise KeyError', 'y += V', 'x = V\npass', 'return (V,\n    1)',
                     'return (\n    V)', 'V', 'x = V\nbreak', 'x = V\ncontinue'):
            if form.endswith(('break', 'continue')) and 'for' not in name and name != 'while':
                continue
            # (However short the `finally` clause is, it counts as too long.)
            if (name, form) == ('try finally', 'return V'):
                continue
            statement = form.replace('V', value)
            show('%s / %s / %r' % (value, name, form), context.format(S4=textwrap.indent(statement, ' ' * 4), S8=textwrap.indent(statement, ' ' * 8)), False)


# Other code than that of a function.
for source in (
    'y = 0\nx = (a or b) if c else d\n',
    'y = 0\nx = (a or b) if c else d\ny = 1\n',
    'y = 0\n(a or b) if c else d\n',
    'class K:\n    y = 0\n    x = (a or b) if c else d\n',
    'class K:\n    y = 0\n    x = (a or b) if c else d\n    y = 1\n',
    'async def f():\n    y = 0\n    x = (a or b) if c else d\ntry: f().send(None)\nexcept StopIteration: pass\n',
    'async def f():\n    y = 0\n    return (a or b) if c else d\ntry: f().send(None)\nexcept StopIteration: pass\n',
    'def f():\n    yield 1\n    return (a or b) if c else d\nlist(f())\n',
    'def f():\n    yield 1\n    x = (a or b) if c else d\nlist(f())\n',
    'def o():\n    x = 0\n    def f():\n        nonlocal x\n        x = (a or b) if c else d\n    f()\no()\n',
):
    code = compile(source, 'generated', 'exec')
    print(repr(source))
    for c in (1, 0):
        print('   ', lines(lambda: exec(code, {'a': 0, 'b': 1, 'c': c, 'd': 0}), ()))
