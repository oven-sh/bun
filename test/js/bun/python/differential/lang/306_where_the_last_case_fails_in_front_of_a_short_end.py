# Where a branch is said to lead when the last case of a `match` fails, in front of a short end of the function: by the pattern, by what the body ends with, and by where the `match` is.
#
# A copy of the end of the function takes the place of the jump behind the statement. Where several branches meet there, a pattern and its guard, it is of no line of theirs. Alternatives fail
# with a jump, which has a copy of its own. Behind a `for` loop with a `break`, CPython is left with something of the line of the loop, and what has failed does not come through it.
import sys
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
class E(Exception): pass
PATTERNS = ['1', '1 if b', '1 | 2', '1 | 2 if b', '(1, 2)', '(1, 2) if b', 'int() if b', 'v if b', '[1, *r] if b', '(1 | 2) as w']
BODIES = ['x = 1', 'for i in ():\n    x = 1', 'for i in ():\n    break', 'for i in ():\n    if a:\n        break', 'for i in ():\n    if 0:\n        break', 'for i in (1,):\n    if b:\n        break',
          'for i in ():\n    try:\n        if 0:\n            break\n    finally:\n        x = 3', 'while b:\n    break', 'if b:\n    x = 1']
WHICH = {'only': '', 'last of two': 'case 0:\n    x = 5\n'}
PLACES = {'short end': 'S\nx = 7', 'return': 'S\nx = 6\nreturn a', 'in the only case _': 'match a:\n    case _:\n        S\nx = 7', 'in the only case _, return': 'match a:\n    case _:\n        S\nx = 6\nreturn a',
          'try, else': 'try:\n    S\nexcept E:\n    x = 4\nelse:\n    y = 1\n    raise E', 'if': 'if a is not None:\n    S\nx = 7', 'long end': 'S\nx = 7\ny = 8\nz = 9\nreturn x + y + z'}
M = sys.monitoring; EV = M.events
T = []
def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end: return line
def two(name):
    def callback(code, a, b):
        if code.co_filename == 'p': T.append('%s%s>%s' % (name, line_of(code, a), line_of(code, b)))
    return callback
def line(code, lineno):
    if code.co_filename == 'p': T.append('L%d' % lineno)
M.use_tool_id(3, 'test')
M.register_callback(3, EV.LINE, line); M.register_callback(3, EV.JUMP, two('J')); M.register_callback(3, EV.BRANCH_LEFT, two('bl')); M.register_callback(3, EV.BRANCH_RIGHT, two('br'))
def put(place, statement):
    return '\n'.join(indent(statement, len(l) - 1) if l.strip() == 'S' else l for l in place.split('\n'))
def run(f, a, b):
    del T[:]
    M.set_events(3, EV.LINE | EV.JUMP | EV.BRANCH_LEFT | EV.BRANCH_RIGHT)
    try:
        try: f(a, b)
        finally: M.set_events(3, 0)
    except E: T.append('E')
    return ' '.join(T)
def rows():
    for pn, place in PLACES.items():
        for wn, before in WHICH.items():
            for pattern in PATTERNS:
                for body in BODIES:
                    if 'break' in body and 'only case _' in pn: continue
                    statement = 'match a:\n' + indent(before + 'case %s:\n' % pattern + indent(body))
                    ns = {'E': E}
                    exec(compile('def f(a, b):\n' + indent(put(place, statement)) + '\n', 'p', 'exec'), ns)
                    yield '%s | %s | %s | %s | %s' % (pn, wn, pattern, body.replace('\n', ' / '), ' ; '.join(run(ns['f'], a, b) for a in (1, 3, (1, 2)) for b in (0, 1)))
print('\n'.join(rows()))
