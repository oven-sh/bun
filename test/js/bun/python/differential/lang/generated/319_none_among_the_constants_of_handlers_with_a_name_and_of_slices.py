# co_consts: None is there from where CPython's compiler first loads it. What unbinds the name of a handler does: at the end of the handler, which the code has once however many ways lead
# there, and on the way of a `return`, `break` or `continue` out of it. So does a slice with a bound left out, if not all of it is constant.
try: import itertools, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def show(c):
        return tuple('<code>' if hasattr(x, 'co_name') else x for x in c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(c):')
try:
    def ind(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def ind(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def row(*what, src):
        try: code = compile(src, 'p', 'exec')
        except SyntaxError as e:
            print(*what, 'SyntaxError', sep=' | '); return
        print(*what, show(code.co_consts if what[0] == 'module' else code.co_consts[0].co_consts), sep=' | ')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def row(*what, src):')
try: ARMS = ["if b: pass\nelse: x = 'q'", "if b: pass\nelif a: x = 'q'", "if b: x = 'p'\nelse: x = 'q'", "try: g()\nexcept F: x = 'q'", "try: g()\nexcept F as f: x = 'q'", "x = 'q'", "pass", "(b if a else\n 'q')", "if b: return\nx = 'q'", "if b: return 'r'\nx = 'q'",
        "if b: break\nx = 'q'", "if b: continue\nx = 'q'", "with a: x = 'q'", "for j in a: x = 'q'", "while b: x = 'q'", "match a:\n    case 1: pass\n    case _: x = 'q'",
        # A `break` goes on with a copy of what is behind its loop.
        "while b:\n    if a: break\nelse: x = 'q'", "for j in a:\n    if b: break\nelse: x = 'q'", "while b:\n    if a: break", "for j in a:\n    try: break\n    finally: g()", "while b:\n    with a: break\nelse: x = 'q'",
        "for j in a:\n    if b: continue\n    x = 'q'", "for j in a:\n    try: g()\n    except F as f: break\nelse: x = 'q'"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ARMS = ["if b: pass\\nelse: x = \'q\'", "if b: pass\\nelif a: x = \'q\'", "...')
try: OUTER = {'for': "for i in a:\n{T}", 'while': "while a:\n{T}", 'plain': "{T0}", 'for, more': "for i in a:\n{T}\n    y = 'r'", 'plain, more': "{T0}\ny = 'r'", 'if': "if a:\n{T}", 'try finally': "try:\n{T}\nfinally:\n    z = 's'", 'with': "with a:\n{T}", 'plain, much more': "{T0}\ny = 'r'\nif a: y = 's'\nfor i in a: y = 't'\ny = 'u'",
         'handler': "try: g()\nexcept G as h:\n{T}", 'handler, more': "try: g()\nexcept G as h:\n{T}\ny = 'r'", 'for, handler, else': "for i in a:\n    try: g()\n    except G as h:\n        if b:\n{T3}\n        else: y = 'r'"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OUTER = {\'for\': "for i in a:\\n{T}", \'while\': "while a:\\n{T}", \'plain\'...')
try: FORMS = {'def': 'def f(a, b):\n{T}', 'async def': 'async def f(a, b):\n{T}', 'module': '{T0}'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = {'def': 'def f(a, b):\\n{T}', 'async def': 'async def f(a, b):...")
try: KIND = {'as e': "try: g()\nexcept E as e:\n{A}", 'star': "try: g()\nexcept* E as e:\n{A}", 'two': "try: g()\nexcept E as e:\n{A}\nexcept F as f:\n    pass", 'else': "try: g()\nexcept E as e:\n{A}\nelse:\n    w = 't'"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: KIND = {\'as e\': "try: g()\\nexcept E as e:\\n{A}", \'star\': "try: g()\\ne...')
try:
    def put(into, t): return into.replace('{T0}', t).replace('{T3}', ind(t, 12)).replace('{T}', ind(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def put(into, t): return into.replace('{T0}', t).replace('{T3}', ind(...")
try:
    for (f, ft), (o, ot), (k, kt), arm in itertools.product(FORMS.items(), OUTER.items(), KIND.items(), ARMS):
        if f != 'def' and o not in ('for', 'plain', 'plain, more', 'for, handler, else'): continue
        try: row(f, o, k, repr(arm), src=put(ft, put(ot, kt.replace('{A}', ind(arm)))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row(f, o, k, repr(arm), src=put(ft, put(ot, kt.replace('{A}', ind(arm...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for (f, ft), (o, ot), (k, kt), arm in itertools.product(FORMS.items()...')
try: SLICES = ['a[b:]', 'a[:b]', 'a[::b]', 'a[b::]', 'a[b:b]', 'a[b:b:b]', 'a[:b:b]', 'a[b::b]', 'a[:]', 'a[::]', 'a[1:]', 'a[:1]', 'a[1:b]', 'a[b:1]', 'a[::1]', 'a[1::b]', 'a[b:, 1]', 'a[b:, :b]', 'a[1:, :2]', 'a[b:][:b]']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SLICES = ['a[b:]', 'a[:b]', 'a[::b]', 'a[b::]', 'a[b:b]', 'a[b:b:b]',...")
try: USES = ['x = {S}', '{S} = x', 'del {S}', '{S} += x', 'g({S})', 'return {S}', 'x = {S}, 2', 'for {S} in a: pass', 'with a as {S}: pass', 'x = [{S} for i in a]', 'x = lambda: {S}']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: USES = ['x = {S}', '{S} = x', 'del {S}', '{S} += x', 'g({S})', 'retur...")
try:
    for s, u, more in itertools.product(SLICES, USES, ('', "y = 'q'\n", "\ny = 'q'")):
        try: body = more + u.replace('{S}', s) if more.endswith('\n') else u.replace('{S}', s) + more
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: body = more + u.replace('{S}', s) if more.endswith('\\n') else u.repla...")
        try: row(s, u, repr(more), src='def f(a, b, x):\n' + ind(body))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: row(s, u, repr(more), src='def f(a, b, x):\\n' + ind(body))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s, u, more in itertools.product(SLICES, USES, (\'\', "y = \'q\'\\n", "...')
