# Something short behind a statement in the `else` of a loop: what tools are told of, by what comes behind the loop.
#
# Without a `break` nothing else leads to where the loop ends. So what is in the `else` is one run of instructions with what comes behind the loop, and where that is a short end of
# the function, CPython's compiler copies all of it to where a jump would lead to it: over an `else`, out of a `case` or a handler.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try: LAST = {'if': 'if g:\n    x = 9', 'if else': 'if g:\n    x = 9\nelse:\n    x = 8', 'if elif': 'if g:\n    x = 9\nelif a:\n    x = 8',
        'try': 'try:\n    x = 1 // g\nexcept ZeroDivisionError:\n    x = 8', 'with': 'with CM():\n    if g:\n        x = 9',
        'try that raises': 'try:\n    raise KeyError\nexcept KeyError:\n    x = 8', 'try* that raises': 'try:\n    raise KeyError\nexcept* KeyError:\n    x = 8',
        'match': 'match g:\n    case 1:\n        x = 9\n    case 0:\n        x = 8',
        'match default': 'match g:\n    case 1:\n        x = 9\n    case _:\n        if a:\n            x = 8'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LAST = {'if': 'if g:\\n x = 9', 'if else': 'if g:\\n x = 9\\nelse:\\n x =...")
try: LOOPS = {'for': 'for i in (1, 2):\n    x = i\nelse:\n%s', 'for break': 'for i in (1, 2):\n    if i == a: break\nelse:\n%s', 'while': 'i = 2\nwhile i:\n    i -= 1\nelse:\n%s',
         'while break': 'i = 2\nwhile i:\n    i -= 1\n    if i == a: break\nelse:\n%s', 'for if': 'for i in (1, 2):\n    if g:\n        x = i\nelse:\n%s',
         'while and': 'i = 2\nwhile i and a:\n    i -= 1\nelse:\n%s'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = {'for': 'for i in (1, 2):\\n x = i\\nelse:\\n%s', 'for break': '...")
try: OUTER = {
 'function': '%s', 'return': '%s\nreturn 3', 'return x': '%s\nreturn x', 'long': '%s\nx = [a, g]\nx = [x, a, g]\nreturn x',
 'else of loop': 'for j in (1,):\n    x = j\nelse:\n%s\nreturn 3',
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
                for sname, last in [(n + ' + ' + tn, l + '\n' + t) for n, l in LAST.items() for tn, t in (('assign', 'z = 3'), ('pass', 'pass'), ('return', 'return 4'), ('two', 'z = 3\nw = 4'))]:
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
