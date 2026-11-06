# A `for` loop that is left through `finally` clauses, by `break` or `return`, closes the generator it goes through behind the last of them.
# The line its frame is on meanwhile, as the `finally` clause of the generator sees it: that of the way out of the clause, or none where ways meet.
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore', SyntaxWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', SyntaxWarning)")
try:
    def gg(T):
        try:
            yield 1
            yield 2
        finally:
            fr = sys._getframe(1)
            T.append(fr.f_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gg(T):')
try:
    class CM:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try: CLAUSE = {
 'assign': 'a = 1', 'pass': 'pass', 'if': 'if a:\n    a = 1', 'if 0': 'if 0:\n    a = 1', 'if 1': 'if 1:\n    a = 1', 'if else': 'if a:\n    a = 1\nelse:\n    a = 2', 'if not': 'if not a:\n    a = 1',
 'try assign': 'try:\n    a = 1\nexcept ValueError:\n    pass', 'try pass': 'try:\n    pass\nexcept ValueError:\n    pass', 'try if': 'try:\n    if a:\n        a = 1\nexcept ValueError:\n    pass',
 'try if 0': 'try:\n    if 0:\n        a = 1\nexcept ValueError:\n    pass',
 'try finally': 'try:\n    a = 1\nfinally:\n    a = 2', 'try finally if': 'try:\n    a = 1\nfinally:\n    if a:\n        a = 2', 'try else': 'try:\n    a = 1\nexcept ValueError:\n    pass\nelse:\n    a = 3',
 'try star': 'try:\n    a = 1\nexcept* ValueError:\n    pass', 'with': 'with CM():\n    a = 1', 'with if': 'with CM():\n    if a:\n        a = 1', 'while': 'while a:\n    a -= 1', 'for': 'for k in (1, 2):\n    a = k',
 'match': 'match a:\n    case 1:\n        a = 2\n    case 2:\n        a = 3', 'match seq': 'match a:\n    case [1, 2]:\n        a = 2', 'assert': 'assert a or True', 'and': 'a = (a and\n     1)', 'call': 'len(\n    "")',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CLAUSE = { 'assign': 'a = 1', 'pass': 'pass', 'if': 'if a:\\n a = 1', ...")
try: LEAVE = {
 'break': 'try:\n    break\nfinally:\n%s', 'break in with': 'try:\n    with CM():\n        break\nfinally:\n%s', 'break in finally': 'try:\n    try:\n        a = 1\n    finally:\n        break\nfinally:\n%s',
 'return': 'try:\n    return 5\nfinally:\n%s', 'return value': 'try:\n    return a\nfinally:\n%s', 'if break': 'try:\n    if a:\n        break\nfinally:\n%s', 'break in handler': 'try:\n    try:\n        1 / 0\n    except ZeroDivisionError:\n        break\nfinally:\n%s',
 'break, two clauses': 'try:\n    try:\n        break\n    finally:\n        a = 3\nfinally:\n%s', 'break, clause in with': 'with CM():\n    try:\n        break\n    finally:\n%s',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LEAVE = { 'break': 'try:\\n break\\nfinally:\\n%s', 'break in with': 'tr...")
try: REST = {'nothing': ('', ''), 'more in the loop': ('a = 2', ''), 'return': ('', 'return 7'), 'both': ('a = 2', 'return 7'), 'long': ('a = 2', 'b = [a, T]\nb = [b, a, T]\nreturn b'), 'else': ('', None)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: REST = {'nothing': ('', ''), 'more in the loop': ('a = 2', ''), 'retu...")
try: LOOP = {'for': 'for i in gg(T):', 'enumerate': 'for i in enumerate(gg(T)):'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOP = {'for': 'for i in gg(T):', 'enumerate': 'for i in enumerate(gg...")
try:
    def rows():
        for lname, loop in LOOP.items():
            for vname, leave in LEAVE.items():
                for rname, (more, after) in REST.items():
                    for cname, clause in CLAUSE.items():
                        body = leave % indent(clause, 8 if vname == 'break, clause in with' else 4)
                        if more: body += '\n' + more
                        src = 'def f(T, a):\n' + indent(loop + '\n' + indent(body))
                        if after is None: src += '\n    else:\n        a = 9'
                        elif after: src += '\n' + indent(after)
                        ns = {'gg': gg, 'CM': CM}
                        exec(compile(src + '\n', 'f', 'exec'), ns)
                        out = []
                        for a in (0, 1, 2):
                            T = []
                            ns['f'](T, a)
                            out.append(T)
                        yield '%s | %s | %s | %s | %s' % (lname, vname, rname, cname, out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
