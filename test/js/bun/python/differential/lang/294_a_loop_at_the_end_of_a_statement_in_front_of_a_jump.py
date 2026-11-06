# A loop at the end of an `else`, of a case, of a handler or of the statements of a `try` or a `with`, in front of a jump: what tools are told of when it runs out.
#
# Where a short end of the function comes behind the statement, CPython's compiler copies it in place of the jump. What is left of the jump does nothing. Behind a `for` loop it is on
# the line of the loop, like what drops the iterator in front of it, and goes, unless it is the first of a block: at the end of an `else` or of the last `case _:`, where the
# other ways through the statement were to jump.
import sys
M = sys.monitoring; E = M.events
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
LOOPS = {'for': 'for k in (1, 2):\n    x = k', 'for else': 'for k in (1, 2):\n    x = k\nelse:\n    x = 0',
         'while': 'k = 2\nwhile k:\n    k -= 1',
         'for if': 'for k in (1, 2):\n    if k == g:\n        x = k'}
FIRST = {'assign': 'x = 9', 'return': 'return 9', 'raise': 'raise KeyError', 'if': 'if g:\n    x = 9'}
INNER = {
 'if else': 'if a == 99:\n%(first)s\nelse:\n%(loop)s',
 'if elif else': 'if a == 99:\n%(first)s\nelif a == 98:\n    x = 8\nelse:\n%(loop)s',
 'if elif': 'if a == 99:\n%(first)s\nelif a:\n%(loop)s',
 'if': 'if a:\n%(loop)s',
 'match default': 'match a:\n    case 99:\n%(first2)s\n    case _:\n%(loop2)s',
 'match last': 'match a:\n    case 99:\n%(first2)s\n    case 1:\n%(loop2)s',
 'try else': 'try:\n%(first)s\nexcept ValueError:\n    x = 8\nelse:\n%(loop)s',
 'handler': 'try:\n    1 / 0\nexcept ZeroDivisionError:\n%(loop)s',
 'try': 'try:\n%(loop)s\nexcept ValueError:\n%(first)s',
 'with': 'with CM():\n%(loop)s',
 'plain': '%(loop0)s',
}
OUTER = {
 'arm': 'if a:\n%s\nelse:\n    x = 7\nreturn 3', 'arm, nothing': 'if a:\n%s\nelse:\n    x = 7',
 'case': 'match 1:\n    case 1:\n%s\n    case 2:\n        x = 8\nreturn 3', 'try': 'try:\n%s\nexcept ValueError:\n    x = 7\nreturn 3', 'loop': 'for i in (1, 2):\n%s\nreturn 3',
 'arm in arm': 'if a:\n    if a:\n%s\n    else:\n        x = 6\nelse:\n    x = 7\nreturn 3', 'function': '%s', 'return': '%s\nreturn 3',
}
class CM:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def rows():
    for oname, outer in OUTER.items():
        for iname, inner in INNER.items():
            for lname, loop in LOOPS.items():
                for fname, first in FIRST.items():
                    if '%(first' not in inner and fname != 'assign': continue
                    body = inner % {'first': indent(first), 'loop': indent(loop), 'first2': indent(first, 8), 'loop2': indent(loop, 8), 'loop0': loop}
                    depth = 0 if outer.startswith('%s') else 8 if oname in ('case', 'arm in arm') else 4
                    src = 'def f(a, g):\n' + indent(outer % indent(body, depth))
                    ns = {'CM': CM}
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
                    for a in (1, 99):
                        for g in (0, 1):
                            del log[:]
                            try: r = f(a, g)
                            except KeyError: r = 'KeyError'
                            yield '%s | %s | %s | %s | %s %s | %s %s' % (oname, iname, lname, fname, a, g, r, ' '.join(log))
                    M.set_local_events(1, code, 0); M.free_tool_id(1)
print('\n'.join(rows()))
