# Which way of a branch is BRANCH_LEFT and which BRANCH_RIGHT, where they lead and which jumps are told of, for the last statement of a block: it
# depends on what comes after the block. CPython's compiler lets a branch see through the jump at the end of a loop, and turns round a branch that would
# go backwards; it does not let it see through the jump over an `else` or over handlers.
import sys
import textwrap

M = sys.monitoring
E = M.events

# Two ways meet behind the statement.
MEET = {
    'if': 'if a:\n    x = 1',
    'if not': 'if not a:\n    x = 1',
    'if and': 'if a and b:\n    x = 1',
    'if or': 'if a or b:\n    x = 1',
    'if else': 'if a:\n    x = 1\nelse:\n    x = 2',
    'if elif': 'if a:\n    x = 1\nelif b:\n    x = 2',
    'if if': 'if a:\n    if b:\n        x = 1',
    'is None': 'if n is None:\n    x = 1',
    'and': 'x = a and b',
}
# Something is raised in it.
RAISE = {
    'assert': 'assert a or b',
    'if raise': 'if a and b:\n    raise KeyError',
    'for': 'for y in (a,):\n    x = 1',
}
# A branch is the only way to what is behind the statement.
ONE_WAY = {
    'assert not': 'assert not a',
    'assert of a chain': 'assert a <= b < c',
    'while': 'while a:\n    a = 0',
    'if continue': 'if a:\n    continue',
    'if return': 'if a:\n    return 1',
}
# Nothing is to be done on the way out of the block.
PLAIN = {
    'plain': '{S}',
    'except': 'try:\n    raise KeyError\nexcept KeyError:\n{S4}',
    'except as': 'try:\n    raise KeyError\nexcept KeyError as e:\n{S4}',
    'except, and the body may go on': 'try:\n    if c:\n        raise KeyError\nexcept KeyError:\n{S4}',
    'if body': 'if c:\n{S4}\nelse:\n    x = 5',
    'else body': 'if not c:\n    x = 5\nelse:\n{S4}',
    'if only': 'if c:\n{S4}',
    'case': 'match c:\n    case 1:\n{S8}\n    case _:\n        x = 5',
}
TRY = {
    'try': 'try:\n{S4}\nexcept KeyError:\n    x = 3',
    'try else': 'try:\n    x = 0\nexcept KeyError:\n    x = 3\nelse:\n{S4}',
    'finally': 'try:\n    x = 0\nfinally:\n{S4}',
    'try finally': 'try:\n{S4}\nfinally:\n    x = 3',
}
WITH = {
    'with': 'with cm:\n{S4}',
}
OUTER = {
    'for': 'def f(a, b, c=1, n=None):\n    for i in (1, 2):\n{B8}\n    x = 9\n    y = x + a + b\n    return y',
    'while True': 'def f(a, b, c=1, n=None):\n    i = 0\n    while True:\n        i += 1\n        if i > 2:\n            return\n{B8}',
    'end': 'def f(a, b, c=1, n=None):\n{B4}',
    'then': 'def f(a, b, c=1, n=None):\n{B4}\n    x = 9\n    y = x + a + b\n    return y',
}


class CM:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end:
            return line
    return '?'


log = []


def callback(name):
    def told(code, source, destination):
        if code.co_filename == 'generated':
            log.append('%s%s>%s' % (name, line_of(code, source), line_of(code, destination)))
    return told


M.use_tool_id(1, 'test')
for event, name in ((E.BRANCH_LEFT, 'L'), (E.BRANCH_RIGHT, 'R'), (E.JUMP, 'J')):
    M.register_callback(1, event, callback(name))


def main():
    for contexts, statements in ((PLAIN | TRY | WITH, MEET), (PLAIN | TRY, RAISE), (PLAIN, ONE_WAY)):
        for outer_name, outer in OUTER.items():
            for context_name, context in contexts.items():
                for name, statement in statements.items():
                    if name == 'if continue' and outer_name in ('end', 'then'):
                        continue
                    body = context.format(S=statement, S4=textwrap.indent(statement, ' ' * 4), S8=textwrap.indent(statement, ' ' * 8))
                    source = 'x = 0\n' + outer.format(B4=textwrap.indent(body, ' ' * 4), B8=textwrap.indent(body, ' ' * 8))
                    namespace = {'cm': CM()}
                    exec(compile(source, 'generated', 'exec'), namespace)
                    rows = []
                    for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)):
                        log.clear()
                        M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP)
                        try:
                            namespace['f'](a, b)
                        except (KeyError, AssertionError, UnboundLocalError) as e:
                            log.append(type(e).__name__)
                        M.set_events(1, 0)
                        rows.append(' '.join(log))
                    print('%s / %s / %s' % (outer_name, context_name, name))
                    for row in dict.fromkeys(rows):
                        print('   ', row)


main()
M.free_tool_id(1)
