# What the body of a case ends with: branches, jumps and ways out, as tools are told of them, and the lines. At the end of a function, in front of more, in loops.
#
# In CPython's code a jump to the end of the statement comes behind the body of every case but a `case _:` that is the last of several: also
# behind the last, where there is nothing to jump over, and behind a `case _:` that is the only one. So a branch the body ends with
# goes through that jump, and a branch at the end of the body of a loop is not turned round. Where a short end of the function comes next, a
# copy of it takes the place of the jump, and what is left of the jump is of the line of the only way there.
import sys, warnings
warnings.simplefilter('ignore')  # 'return' in a 'finally' block
M = sys.monitoring; E = M.events
class C:
    __match_args__ = ('p',)
    def __init__(self, p): self.p = p
    def __repr__(self): return 'C(%r)' % self.p
class CM:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
PATTERNS = ['case 1:', 'case [1, y]:', 'case y if g:', 'case _:']
BODIES = {'assign': 'x = 1', 'pass': 'pass', 'assert': 'assert g', 'if': 'if g:\n    x = 1', 'if else': 'if g:\n    x = 1\nelse:\n    x = 2', 'if assert else': 'if g:\n    assert g\nelse:\n    x = 2', 'while': 'while g:\n    g -= 1',
          'return': 'return 5', 'raise': 'raise KeyError', 'try': 'try:\n    x = 1\nexcept ValueError:\n    x = 2', 'try finally': 'try:\n    x = 1\nfinally:\n    x = 2', 'for': 'for k in (1, 2):\n    x = k', 'with': 'with CM():\n    x = 1',
          'match': 'match g:\n    case 1:\n        x = 1', 'match seq': 'match g:\n    case [1]:\n        x = 1', 'and': 'x = g and a'}
WHERE = {
 'function ends': '%s', 'return next': '%s\nreturn 2', 'more next': '%s\nx = [a, g]\nx = [x, a, g]\nreturn x', 'for': 'for i in (1, 2):\n%s\nreturn 3', 'while': 'i = 0\nwhile i < 2:\n    i += 1\n%s\nreturn 3',
 'for, more': 'for i in (1, 2):\n%s\n    x = 4\nreturn 3', 'arm': 'if a is not None:\n%s\nelse:\n    x = 7\nreturn 3', 'try': 'try:\n%s\nexcept ValueError:\n    x = 7\nreturn 3', 'handler': 'try:\n    1 / 0\nexcept ZeroDivisionError:\n%s\nreturn 3',
 'finally': 'try:\n    x = 0\nfinally:\n%s\nreturn 3', 'with': 'with CM():\n%s\nreturn 3', 'case': 'match 1:\n    case 1:\n%s\n    case 2:\n        x = 8\nreturn 3',
}
PLACE = {'only': '%s', 'last of two': 'case 99:\n    x = 9\n%s', 'first of two': '%s\ncase 98:\n    x = 9'}
SUBJECTS = [1, 5, [1, 0], [2]]
# Not as in CPython yet: where a `for` loop is said to lead when it runs out in front of a jump to a short end of the function, at the end of a `case _:`
# as at the end of an `else`; and the line of `x = 1`, which CPython tells of here although the test has failed.
LEFT_OUT = {(w, 'last of two', 'case _:', 'for') for w in ('arm', 'try', 'finally', 'case')} | {('with', 'only', 'case _:', 'for'), ('with', 'only', 'case _:', 'if')}
def rows(places):
    for wname in places:
        where = WHERE[wname]
        for pname, place in PLACE.items():
            for pattern in PATTERNS:
                if pattern == 'case _:' and pname == 'first of two': continue
                for bname, body in BODIES.items():
                    if (wname, pname, pattern, bname) in LEFT_OUT: continue
                    match = 'match a:\n' + indent(place % (pattern + '\n' + indent(body)))
                    depth = 0 if where.startswith('%s') else 8 if wname == 'case' else 4
                    src = 'def f(a, g):\n' + indent(where % indent(match, depth))
                    ns = {'C': C, 'CM': CM}
                    exec(compile(src + '\n', 'm', 'exec'), ns)
                    f = ns['f']; code = f.__code__
                    line_at = {}
                    for s, e, l in code.co_lines():
                        for o in range(s, e): line_at[o] = l
                    log = []
                    M.use_tool_id(1, 't')
                    for ev, k in ((E.BRANCH_LEFT, 'BL'), (E.BRANCH_RIGHT, 'BR'), (E.JUMP, 'J')):
                        M.register_callback(1, ev, lambda c, a, b, k=k: log.append('%s%s>%s' % (k, line_at[a], line_at[b])))
                    M.register_callback(1, E.LINE, lambda c, l: log.append('L%d' % l))
                    M.set_local_events(1, code, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP | E.LINE)
                    seen = {}
                    for g in (0, 1):
                        for subject in SUBJECTS:
                            del log[:]
                            try: r = f(subject, g)
                            except (AssertionError, KeyError) as e: r = type(e).__name__
                            seen.setdefault('%s %s' % (r, ' '.join(log)), []).append('%r/%d' % (subject, g))
                    M.set_local_events(1, code, 0); M.free_tool_id(1)
                    for told, who in seen.items():
                        yield ' | '.join((wname, pname, pattern, bname, told, ' '.join(who)))
print('\n'.join(rows(('function ends', 'return next', 'more next', 'for', 'while', 'for, more'))))
