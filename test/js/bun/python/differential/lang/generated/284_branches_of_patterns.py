# The branches and jumps of patterns, as tools are told of them, and the lines.
#
# CPython's code keeps what a pattern still has to look at on its stack. What drops that, where the pattern has matched or has failed, is
# of the line of the pattern, and it is there that a branch or a jump before it is said to lead. The last case of a `match` that the
# body of a loop ends with goes on with the loop where it fails: a branch that would go backwards is turned round.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')

try:
    class C:
        __match_args__ = ('p',)
        def __init__(self, p): self.p = p
        def __repr__(self): return 'C(%r)' % self.p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')

try:
    class K:
        k = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')

try: NEXT = '\n' + ' ' * 18
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: NEXT = '\\n' + ' ' * 18")
try: CASES = [
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CASES = [ \'case 0:\', \'case -1:\', \'case "s":\', \'case K.k:\', \'case None...')
try: SUBJECTS = [0, 5, 7, -1, 's', None, True, [1, 0], [1, 2], [2, 0], [[1], 0], [[1], 2], [C(0), 1], (1,), C(0), C(1), {'k': 0}, {'k': 1}, {'k': {}}, {'k': None}, {}]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SUBJECTS = [0, 5, 7, -1, 's', None, True, [1, 0], [1, 2], [2, 0], [[1...")
try: WHERE = {
    'the body of a for loop ends': 'def f(xs, g):\n    i = x = 0\n    for a in xs:\n        match a:\n%s    return x\n',
    'the body of a while loop ends': 'def f(xs, g):\n    i = x = 0\n    while i < len(xs):\n        a = xs[i]\n        i += 1\n        match a:\n%s    return x\n',
    'the function ends': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s',
    'a return comes next': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s    return 2\n',
    'more comes next': 'def f(xs, g):\n    a = xs[0]\n    if g < 2:\n        match a:\n%s        x = [a, g, xs]\n        x = [x, a, g, xs]\n    return x\n',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHERE = { 'the body of a for loop ends': 'def f(xs, g):\\n i = x = 0\\n...")
try: FIRST = {'the only case': '', 'the second case': '            case 99:\n                x = 9\n'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FIRST = {'the only case': '', 'the second case': ' case 99:\\n x = 9\\n'}")

try:
    def run(function, subject, g, log):
        del log[:]
        function([subject], g)
        return ' '.join(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(function, subject, g, log):')

try:
    for where, frame in WHERE.items():
        for first, before in FIRST.items():
            for case in CASES:
                try: source = frame % (before + '            ' + case.replace('>', NEXT) + '\n                x = 1\n')
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = frame % (before + ' ' + case.replace('>', NEXT) + '\\n x = 1\\n')")
                try: namespace = {'C': C, 'K': K}
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace = {'C': C, 'K': K}")
                try: exec(compile(source, 'm', 'exec'), namespace)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, 'm', 'exec'), namespace)")
                try: function = namespace['f']
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: function = namespace['f']")
                try: code = function.__code__
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = function.__code__')
                try: line_at = {}
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: line_at = {}')
                for start, end, line in code.co_lines():
                    for offset in range(start, end):
                        try: line_at[offset] = line
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: line_at[offset] = line')
                try: log = []
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
                try: M.use_tool_id(1, 't')
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 't')")
                for event, name in ((E.BRANCH_LEFT, 'BL'), (E.BRANCH_RIGHT, 'BR'), (E.JUMP, 'J')):
                    try: M.register_callback(1, event, lambda c, a, b, name=name: log.append('%s%s>%s' % (name, line_at[a], line_at[b])))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, event, lambda c, a, b, name=name: log.append('...")
                try: M.register_callback(1, E.LINE, lambda c, line: log.append('L%d' % line))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.LINE, lambda c, line: log.append('L%d' % line))")
                try: M.set_local_events(1, code, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP | E.LINE)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, code, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP |...')
                try: seen = {}
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = {}')
                for g in (0, 1) if ' if ' in case else (0,):
                    for subject in SUBJECTS:
                        try: seen.setdefault(run(function, subject, g, log), []).append('%r%s' % (subject, ' g' if g else ''))
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: seen.setdefault(run(function, subject, g, log), []).append('%r%s' % (...")
                try: M.set_local_events(1, code, 0)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, code, 0)')
                try: M.free_tool_id(1)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')
                try: print("'%s, %s: %s' % (where, first, case.replace('>', ' / ')) [" + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + ", " + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + ", " + 'first=' + (repr(first) if type(first) in (str, int, float, bytes, bool, type(None)) or (type(first) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in first)) else first.__name__ if type(first) is type else type(first).__name__) + ", " + 'before=' + (repr(before) if type(before) in (str, int, float, bytes, bool, type(None)) or (type(before) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in before)) else before.__name__ if type(before) is type else type(before).__name__) + ", " + 'case=' + (repr(case) if type(case) in (str, int, float, bytes, bool, type(None)) or (type(case) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in case)) else case.__name__ if type(case) is type else type(case).__name__) + '] =>', '%s, %s: %s' % (where, first, case.replace('>', ' / ')))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%s, %s: %s' % (where, first, case.replace('>', ' / '))")
                for told, subjects in seen.items():
                    try: print("' %s | %s' % (told, ', '.join(subjects)) [" + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + ", " + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + ", " + 'first=' + (repr(first) if type(first) in (str, int, float, bytes, bool, type(None)) or (type(first) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in first)) else first.__name__ if type(first) is type else type(first).__name__) + ", " + 'before=' + (repr(before) if type(before) in (str, int, float, bytes, bool, type(None)) or (type(before) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in before)) else before.__name__ if type(before) is type else type(before).__name__) + ", " + 'case=' + (repr(case) if type(case) in (str, int, float, bytes, bool, type(None)) or (type(case) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in case)) else case.__name__ if type(case) is type else type(case).__name__) + ", " + 'told=' + (repr(told) if type(told) in (str, int, float, bytes, bool, type(None)) or (type(told) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in told)) else told.__name__ if type(told) is type else type(told).__name__) + ", " + 'subjects=' + (repr(subjects) if type(subjects) in (str, int, float, bytes, bool, type(None)) or (type(subjects) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in subjects)) else subjects.__name__ if type(subjects) is type else type(subjects).__name__) + '] =>', '    %s | %s' % (told, ', '.join(subjects)))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' %s | %s' % (told, ', '.join(subjects))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for where, frame in WHERE.items():')
