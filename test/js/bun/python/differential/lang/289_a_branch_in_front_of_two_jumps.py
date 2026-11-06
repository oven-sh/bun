# A statement that ends with a branch, in front of a jump that leads to a jump: at the end of an arm of an `if` with an `else` that a `case`,
# the body of a `try` or another arm ends with. CPython's compiler has a branch to a jump go where the jump goes if the jump is of one kind,
# and not if it is of the other, whatever that one comes to lead to.
import sys
M = sys.monitoring
E = M.events

def record(function, *arguments):
    code = function.__code__
    line_at = {}
    for start, end, line in code.co_lines():
        for offset in range(start, end):
            line_at[offset] = line
    log = []
    M.use_tool_id(3, 't')
    for event, name in ((E.JUMP, 'J'), (E.BRANCH_LEFT, 'BL'), (E.BRANCH_RIGHT, 'BR')):
        M.register_callback(3, event, lambda c, a, b, name=name: log.append('%s%s>%s' % (name, line_at[a], line_at[b])))
    M.register_callback(3, E.LINE, lambda c, line: log.append('L%d' % line))
    M.set_local_events(3, code, E.JUMP | E.BRANCH_LEFT | E.BRANCH_RIGHT | E.LINE)
    try:
        try:
            result = function(*arguments)
        except AssertionError:
            result = 'AssertionError'
    finally:
        M.set_local_events(3, code, 0)
        M.free_tool_id(3)
    return '%s | %s' % (result, ' '.join(log))

SRC = '''
def f(a, b):
    match a:
        case 5:
            pass
        case int(w):
            if a:
                %s
            else:
                x = 1
        case _:
            x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
SRC2 = '''
def f(a, b):
    match a:
        case 5:
            pass
        case int(w):
            %s
        case _:
            x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
SRC3 = '''
def f(a, b):
    for i in range(2):
        if a:
            if i:
                %s
            else:
                x = 1
        else:
            x = 3
        y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
SRC4 = '''
def f(a, b):
    try:
        if a:
            %s
        else:
            x = 1
    except ValueError:
        x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
BODY = {'assert': 'assert b', 'assert msg': 'assert b, a', 'if': 'if b: x = 2', 'if not': 'if not b: x = 2', 'assert or': 'assert b or a', 'assert and': 'assert b and a', 'assert not': 'assert not b', 'while': 'while b: b -= 1', 'if raise': 'if not b: raise AssertionError'}
for sname, src in (('case if', SRC), ('case', SRC2), ('loop', SRC3), ('try', SRC4)):
    for name, body in BODY.items():
        ns = {}
        exec(compile(src % body, 'm', 'exec'), ns)
        for args in ((1, 1), (0, 1), (2, 1), (1, 0), (0, 0)):
            print(sname, '|', name, args, record(ns['f'], *args))
