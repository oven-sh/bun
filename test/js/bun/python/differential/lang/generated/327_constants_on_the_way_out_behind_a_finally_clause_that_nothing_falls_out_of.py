# co_consts where a `return`, `break` or `continue` leaves a handler with a name or a `with` through a `finally` clause: CPython's compiler writes the rest of the way out behind the clause
# whether or not anything falls out of its end, so None, which that loads, is among the constants from there on; and a constant that the clause never lets be returned is not in use.
try: import itertools, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def ind(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def ind(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try: LEAVES = ['if a: return a', "if a: return 'r'", 'if a: return', 'if a: break', 'if a: continue', 'return a', 'pass']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LEAVES = [\'if a: return a\', "if a: return \'r\'", \'if a: return\', \'if a...')
try: CLAUSES = ['try: g()\nexcept F: pass', "try: g()\nexcept F: x = 'c'", 'g()', 'if b: g()\nelse: h()', 'return 5', 'raise F', 'with b: pass', 'for j in b: pass', 'while b: g()', "if b: x = 'c'", 'try: g()\nfinally: h()', 'match b:\n    case 1: pass\n    case _: g()']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CLAUSES = [\'try: g()\\nexcept F: pass\', "try: g()\\nexcept F: x = \'c\'",...')
try: AROUND = {'named handler': 'try: g()\nexcept E as e:\n{T}', 'with': 'with w:\n{T}', 'handler': 'try: g()\nexcept E:\n{T}', 'named handler in with': 'with w:\n    try: g()\n    except E as e:\n{T2}', 'two named handlers': 'try: g()\nexcept E as e:\n    try: g()\n    except F as f:\n{T2}'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: AROUND = {'named handler': 'try: g()\\nexcept E as e:\\n{T}', 'with': '...")
try:
    def main():
        for (an, at), leave, clause, behind in itertools.product(AROUND.items(), LEAVES, CLAUSES, ("x = 'q'", '', 'inside')):
            t = 'try:\n' + ind(leave) + '\nfinally:\n' + ind(clause)
            if behind == 'inside': t += "\nx = 'q'"; behind = ''
            body = at.replace('{T2}', ind(t, 8)).replace('{T}', ind(t))
            if 'break' in leave or 'continue' in leave: body = 'for i in a:\n' + ind(body)
            if behind: body += '\n' + behind
            code = compile('def f(a, b, w):\n' + ind(body), 'p', 'exec').co_consts[0]
            print(an, '|', leave, '|', repr(clause), '|', behind or t[-7:], '|', code.co_consts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
