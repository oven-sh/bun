# The branches and jumps of patterns, as tools are told of them, and the lines.
#
# CPython's code keeps what a pattern still has to look at on its stack. What drops that, where the pattern has matched or has failed, is
# of the line of the pattern, and it is there that a branch or a jump before it is said to lead. The last case of a `match` that the
# body of a loop ends with goes on with the loop where it fails: a branch that would go backwards is turned round.
import sys
M = sys.monitoring
E = M.events

class C:
    __match_args__ = ('p',)
    def __init__(self, p): self.p = p
    def __repr__(self): return 'C(%r)' % self.p

class K:
    k = 7

NEXT = '\n' + ' ' * 18
CASES = [
    'case 0:', 'case -1:', 'case "s":', 'case K.k:', 'case None:', 'case True:', 'case _:', 'case y:', 'case 0 as z:', 'case 0 | 5:',
    'case [1, 0]:', 'case [1, y]:', 'case [1, *r]:', 'case [[1], 0]:', 'case [1, 0 | 5]:', 'case [0 | 1, 0]:', 'case [(0 | 5) | 1, 0]:',
    'case []:', 'case [_, _]:', 'case [*_]:', 'case [1, *_]:', 'case [*_, 0]:', 'case [1, _]:', 'case [[1], _]:', 'case [[_], _]:', 'case [1, *_] as z:',
    'case [_, _] | [_]:', 'case {} | []:',
    'case C(0):', 'case C():', 'case C(p=0):', 'case C(_):', 'case C(y):', 'case C(0 | 5):', 'case C() as z:', 'case [C(), 0]:', 'case [C(0), _]:',
    'case int():', 'case int(y):', 'case int() | str():', 'case [1, int()]:',
    'case {"k": 0}:', 'case {"k": 0, **r}:', 'case {}:', 'case {"k": y}:', 'case {"k": _}:', 'case {"k": 0, "j": 1}:', 'case {"k": 0 | 5}:', 'case {"k": None}:', 'case {"k": {}}:',
    'case y if y == 0:', 'case 0 if g:', 'case y if y == 0 and g:', 'case y if y == 0 or g:', 'case [1, y] if g:', 'case {"k": y} if g:',
    'case [1,>0]:', 'case [1,>_]:', 'case [_,>_]:', 'case [1,>*_]:', 'case [*_,>0]:', 'case [1,>int()]:', 'case [1,>{}]:',
    'case {"k":>0}:', 'case {"k":>y}:', 'case {"k":>_}:', 'case {"k": 0,>**r}:', 'case {"k":>{}}:',
    'case C(>0):', 'case C(>_):', 'case C(>y):', 'case (0 |>5):', 'case (0>as z):', 'case 0 if (g and>g):',
]
SUBJECTS = [0, 5, 7, -1, 's', None, True, [1, 0], [1, 2], [2, 0], [[1], 0], [[1], 2], [C(0), 1], (1,), C(0), C(1), {'k': 0}, {'k': 1}, {'k': {}}, {'k': None}, {}]
WHERE = {
    'the body of a for loop ends': 'def f(xs, g):\n    i = x = 0\n    for a in xs:\n        match a:\n%s    return x\n',
    'the body of a while loop ends': 'def f(xs, g):\n    i = x = 0\n    while i < len(xs):\n        a = xs[i]\n        i += 1\n        match a:\n%s    return x\n',
    'the function ends': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s',
    'a return comes next': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s    return 2\n',
    'more comes next': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s        x = [a, g, xs]\n        x = [x, a, g, xs]\n    return x\n',
}
FIRST = {'the only case': '', 'the second case': '            case 99:\n                x = 9\n'}

def run(function, subject, g, log):
    del log[:]
    function([subject], g)
    return ' '.join(log)

for where, frame in WHERE.items():
    for first, before in FIRST.items():
        for case in CASES:
            source = frame % (before + '            ' + case.replace('>', NEXT) + '\n                x = 1\n')
            namespace = {'C': C, 'K': K}
            exec(compile(source, 'm', 'exec'), namespace)
            function = namespace['f']
            code = function.__code__
            line_at = {}
            for start, end, line in code.co_lines():
                for offset in range(start, end):
                    line_at[offset] = line
            log = []
            M.use_tool_id(1, 't')
            for event, name in ((E.BRANCH_LEFT, 'BL'), (E.BRANCH_RIGHT, 'BR'), (E.JUMP, 'J')):
                M.register_callback(1, event, lambda c, a, b, name=name: log.append('%s%s>%s' % (name, line_at[a], line_at[b])))
            M.register_callback(1, E.LINE, lambda c, line: log.append('L%d' % line))
            M.set_local_events(1, code, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP | E.LINE)
            seen = {}
            for g in (0, 1) if ' if ' in case else (0,):
                for subject in SUBJECTS:
                    seen.setdefault(run(function, subject, g, log), []).append('%r%s' % (subject, ' g' if g else ''))
            M.set_local_events(1, code, 0)
            M.free_tool_id(1)
            print('%s, %s: %s' % (where, first, case.replace('>', ' / ')))
            for told, subjects in seen.items():
                print('    %s | %s' % (told, ', '.join(subjects)))
