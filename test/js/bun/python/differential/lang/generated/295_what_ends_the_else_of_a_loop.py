# What ends the `else` of a loop: what tools are told of, by what comes behind the loop.
#
# Nothing of the loop comes behind its `else`. So a statement at the end of it is in front of whatever the loop is in front of: a short end of the function, which CPython's compiler
# copies to where the statement would jump, or a jump over an `else`, over handlers or back, which a branch out of the statement goes through or to.
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore', SyntaxWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', SyntaxWarning)")
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try: LAST = {'assign': 'x = 9', 'if': 'if g:\n    x = 9', 'if else': 'if g:\n    x = 9\nelse:\n    x = 8', 'if elif': 'if g:\n    x = 9\nelif a:\n    x = 8',
        'if not': 'if not g:\n    x = 9', 'if and': 'if g and a:\n    x = 9', 'while': 'k = g\nwhile k:\n    k -= 1', 'for': 'for k in (1, 2):\n    x = k',
        'for else': 'for k in (1, 2):\n    x = k\nelse:\n    if g:\n        x = 9', 'try': 'try:\n    x = 1 // g\nexcept ZeroDivisionError:\n    x = 8',
        'try if': 'try:\n    if g:\n        x = 9\nexcept ZeroDivisionError:\n    x = 8', 'try else': 'try:\n    x = 9\nexcept ZeroDivisionError:\n    x = 8\nelse:\n    if g:\n        x = 7',
        'handler if': 'try:\n    1 // 0\nexcept ZeroDivisionError:\n    if g:\n        x = 8', 'finally': 'try:\n    x = 9\nfinally:\n    if g:\n        x = 8',
        'with': 'with CM():\n    if g:\n        x = 9', 'match': 'match g:\n    case 1:\n        x = 9\n    case 0:\n        x = 8', 'match default': 'match g:\n    case 1:\n        x = 9\n    case _:\n        if a:\n            x = 8',
        'assert': 'assert g or a', 'return': 'if g:\n    return 9', 'if in if': 'if a:\n    if g:\n        x = 9', 'pass': 'if g:\n    pass'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LAST = {'assign': 'x = 9', 'if': 'if g:\\n x = 9', 'if else': 'if g:\\n...")
try: LOOPS = {'for': 'for i in (1, 2):\n    x = i\nelse:\n%s', 'for break': 'for i in (1, 2):\n    if i == a: break\nelse:\n%s', 'while': 'i = 2\nwhile i:\n    i -= 1\nelse:\n%s',
         'while break': 'i = 2\nwhile i:\n    i -= 1\n    if i == a: break\nelse:\n%s', 'for if': 'for i in (1, 2):\n    if g:\n        x = i\nelse:\n%s',
         'while and': 'i = 2\nwhile i and a:\n    i -= 1\nelse:\n%s'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = {'for': 'for i in (1, 2):\\n x = i\\nelse:\\n%s', 'for break': '...")
try: OUTER = {
 'function': '%s', 'return': '%s\nreturn 3', 'return x': '%s\nreturn x', 'long': '%s\nx = [a, g]\nx = [x, a, g]\nreturn x',
 'arm': 'if a:\n%s\nelse:\n    x = 7\nreturn 3',
 'else': 'if a == 99:\n    x = 7\nelse:\n%s\nreturn 3', 'case': 'match 1:\n    case 1:\n%s\n    case 2:\n        x = 8\nreturn 3', 'try': 'try:\n%s\nexcept ValueError:\n    x = 7\nreturn 3',
 'loop': 'for j in (1, 2):\n%s\nreturn 3',
 'finally': 'try:\n    x = 5\nfinally:\n%s\nreturn 3', 'else of loop': 'for j in (1,):\n    x = j\nelse:\n%s\nreturn 3',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: OUTER = { 'function': '%s', 'return': '%s\\nreturn 3', 'return x': '%s...")
try:
    class CM:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    def rows():
        for oname, outer in OUTER.items():
            for lname, loop in LOOPS.items():
                for sname, last in LAST.items():
                    # Where the last branch of the second loop is said to lead: DEFERRED.md.
                    if lname == 'for break' and sname == 'for' and oname in ('case', 'try', 'finally'): continue
                    depth = 0 if outer.startswith('%s') else 8 if oname == 'case' else 4
                    src = 'def f(a, g):\n    x = 0\n' + indent(outer % indent(loop % indent(last), depth))
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
                    for a in (1, 0):
                        for g in (0, 1):
                            del log[:]
                            try: r = f(a, g)
                            except AssertionError: r = 'AssertionError'
                            yield '%s | %s | %s | %d %d | %s %s' % (oname, lname, sname, a, g, r, ' '.join(log))
                    M.set_local_events(1, code, 0); M.free_tool_id(1)
                    yield '%s | %s | %s | lines %s' % (oname, lname, sname, sorted({l for _, _, l in code.co_lines() if l}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
