# Where a branch is said to lead when the last case of a `match` fails, in front of a short end of the function: by the pattern, by what the body ends with, and by where the `match` is.
#
# A copy of the end of the function takes the place of the jump behind the statement. Where several branches meet there, a pattern and its guard, it is of no line of theirs. Alternatives fail
# with a jump, which has a copy of its own. Behind a `for` loop with a `break`, CPython is left with something of the line of the loop, and what has failed does not come through it.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try: PATTERNS = ['1', '1 if b', '1 | 2', '1 | 2 if b', '(1, 2)', '(1, 2) if b', 'int() if b', 'v if b', '[1, *r] if b', '(1 | 2) as w']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PATTERNS = ['1', '1 if b', '1 | 2', '1 | 2 if b', '(1, 2)', '(1, 2) i...")
try: BODIES = ['x = 1', 'for i in ():\n    x = 1', 'for i in ():\n    break', 'for i in ():\n    if a:\n        break', 'for i in ():\n    if 0:\n        break', 'for i in (1,):\n    if b:\n        break',
          'for i in ():\n    try:\n        if 0:\n            break\n    finally:\n        x = 3', 'while b:\n    break', 'if b:\n    x = 1']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODIES = ['x = 1', 'for i in ():\\n x = 1', 'for i in ():\\n break', 'f...")
try: WHICH = {'only': '', 'last of two': 'case 0:\n    x = 5\n'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHICH = {'only': '', 'last of two': 'case 0:\\n x = 5\\n'}")
try: PLACES = {'short end': 'S\nx = 7', 'return': 'S\nx = 6\nreturn a', 'in the only case _': 'match a:\n    case _:\n        S\nx = 7', 'in the only case _, return': 'match a:\n    case _:\n        S\nx = 6\nreturn a',
          'try, else': 'try:\n    S\nexcept E:\n    x = 4\nelse:\n    y = 1\n    raise E', 'if': 'if a is not None:\n    S\nx = 7', 'long end': 'S\nx = 7\ny = 8\nz = 9\nreturn x + y + z'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = {'short end': 'S\\nx = 7', 'return': 'S\\nx = 6\\nreturn a', 'i...")
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: EV = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EV = M.events')
try: T = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = []')
try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end: return line
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')
try:
    def two(name):
        def callback(code, a, b):
            if code.co_filename == 'p': T.append('%s%s>%s' % (name, line_of(code, a), line_of(code, b)))
        return callback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(name):')
try:
    def line(code, lineno):
        if code.co_filename == 'p': T.append('L%d' % lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line(code, lineno):')
try: M.use_tool_id(3, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(3, 'test')")
try: M.register_callback(3, EV.LINE, line)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(3, EV.LINE, line)')
try: M.register_callback(3, EV.JUMP, two('J'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.JUMP, two('J'))")
try: M.register_callback(3, EV.BRANCH_LEFT, two('bl'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.BRANCH_LEFT, two('bl'))")
try: M.register_callback(3, EV.BRANCH_RIGHT, two('br'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.BRANCH_RIGHT, two('br'))")
try:
    def put(place, statement):
        return '\n'.join(indent(statement, len(l) - 1) if l.strip() == 'S' else l for l in place.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(place, statement):')
try:
    def run(f, a, b):
        del T[:]
        M.set_events(3, EV.LINE | EV.JUMP | EV.BRANCH_LEFT | EV.BRANCH_RIGHT)
        try:
            try: f(a, b)
            finally: M.set_events(3, 0)
        except E: T.append('E')
        return ' '.join(T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, a, b):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
