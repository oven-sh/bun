# The line that a generator, a coroutine, the body of a class and a module end on behind an expression statement that has several ways through it.
#
# In CPython what drops the value of an expression statement is of no line, and neither is the end of the function. Where nothing but a jump is in between, each way through the expression
# has a copy of them, of its own line. Where the statement is the last of an `if` or of an `else`, the end of that statement is in between: they are of no line at all, and
# f_lineno is None when the function returns.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    class M:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try: FORMS = [
    'a and c(1)', 'c(1) if a else c(2)', 'a or b or c(1)', '(a and c(1)) if b else c(2)', 'c(1) if True else c(2)', 'True or c(1)', 'not (a and c(1))', '0 < c(a) < 2', 'c(1)',
    '(a and\nc(1))', '(a or\nb or\nc(1))', '(c(1) if a else\nc(2))', '(c(1)\nif a else c(2))', '((a and\nc(1)) if b else\nc(2))', '(a and\n(c(1) if b else\nc(2)))',
    '(c(1) if True else\nc(2))',
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = [ 'a and c(1)', 'c(1) if a else c(2)', 'a or b or c(1)', '(a ...")
try: PLACES = {
    'function': 'S', 'behind a statement': 'x = 1\nS',
    'if': 'if c(1):\n    S', 'if, else: if': 'if c(1):\n    S\nelse:\n    x = 1', 'if, else: else': 'if c(0):\n    x = 1\nelse:\n    S', 'elif': 'if c(0):\n    x = 1\nelif c(1):\n    S',
    'elif, else: elif': 'if c(0):\n    x = 1\nelif c(1):\n    S\nelse:\n    x = 2', 'if in if': 'if c(1):\n    if c(1):\n        S', 'if in if, else': 'if c(1):\n    if c(1):\n        S\nelse:\n    x = 1',
    'if True': 'if True:\n    S', 'if, else in else': 'if c(0):\n    x = 1\nelse:\n    if c(0):\n        x = 2\n    else:\n        S',
    'for, else': 'for i in ():\n    x = 1\nelse:\n    S', 'for with break, else': 'for i in ():\n    break\nelse:\n    S', 'while, else': 'while c(0):\n    x = 1\nelse:\n    S',
    'while with break, else': 'while c(0):\n    break\nelse:\n    S', 'for, else in if': 'if c(1):\n    for i in ():\n        x = 1\n    else:\n        S',
    'for, else in if, else': 'if c(1):\n    for i in ():\n        x = 1\n    else:\n        S\nelse:\n    x = 2',
    'try': 'try:\n    S\nexcept E:\n    x = 1', 'except': 'try:\n    raise E\nexcept E:\n    S', 'except as': 'try:\n    raise E\nexcept E as e:\n    S', 'try, else': 'try:\n    x = 1\nexcept E:\n    x = 2\nelse:\n    S',
    'finally': 'try:\n    x = 1\nfinally:\n    S', 'finally, a return waits': 'try:\n    return 1\nfinally:\n    S', 'try, finally': 'try:\n    S\nfinally:\n    x = 1',
    'if in try': 'try:\n    if c(1):\n        S\nexcept E:\n    x = 1', 'if in except': 'try:\n    raise E\nexcept E:\n    if c(1):\n        S', 'if in except as': 'try:\n    raise E\nexcept E as e:\n    if c(1):\n        S',
    'else in except': 'try:\n    raise E\nexcept E:\n    if c(0):\n        x = 1\n    else:\n        S', 'if in finally': 'try:\n    x = 1\nfinally:\n    if c(1):\n        S',
    'if in finally, a return waits': 'try:\n    return 1\nfinally:\n    if c(1):\n        S', 'except*': 'try:\n    raise ExceptionGroup("g", [E()])\nexcept* E:\n    S',
    'with': 'with M():\n    S', 'if in with': 'with M():\n    if c(1):\n        S',
    'case': 'match 1:\n    case 1:\n        S', 'first case': 'match 1:\n    case 1:\n        S\n    case 2:\n        x = 1', 'default': 'match 1:\n    case 0:\n        x = 1\n    case _:\n        S',
    'only default': 'match 1:\n    case _:\n        S', 'default with a guard': 'match 1:\n    case 0:\n        x = 1\n    case _ if c(1):\n        S', 'last case': 'match 1:\n    case 0:\n        x = 1\n    case 1:\n        S',
    'last case with a guard': 'match 1:\n    case 0:\n        x = 1\n    case 1 if c(1):\n        S', 'capture': 'match 1:\n    case 0:\n        x = 1\n    case v:\n        S',
    'if in case': 'match 1:\n    case 1:\n        if c(1):\n            S',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = { 'function': 'S', 'behind a statement': 'x = 1\\nS', 'if': '...")
try: HEADS = {'def': 'def f(a, b):', 'generator': 'def f(a, b):\n    yield 0', 'coroutine': 'async def f(a, b):'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: HEADS = {'def': 'def f(a, b):', 'generator': 'def f(a, b):\\n yield 0'...")
try:
    def put(place, form):
        out = []
        for l in place.split('\n'):
            if l.strip() == 'S': out.append(indent(form, len(l) - 1))
            else: out.append(l)
        return '\n'.join(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(place, form):')
try:
    def events(run):
        ev = []
        def tr(frame, event, arg):
            if frame.f_code.co_filename != 'p': return None
            ev.append(event[0].upper() + str(frame.f_lineno)); return tr
        sys.settrace(tr)
        try: run()
        except E: ev.append('E')
        finally: sys.settrace(None)
        return ' '.join(ev)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def events(run):')
try:
    def drive(f, a, b):
        r = f(a, b)
        if hasattr(r, 'send'):
            try:
                while True: r.send(None)
            except StopIteration: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(f, a, b):')
try: WHICH = ['generator', 'coroutine', 'class', 'module']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHICH = ['generator', 'coroutine', 'class', 'module']")
try:
    def rows():
        for pn in ['function', 'if', 'if, else: if', 'if, else: else', 'for, else', 'for with break, else', 'try', 'except as', 'finally', 'if in finally', 'with', 'case', 'default', 'default with a guard']:
            place = PLACES[pn]
            for form in FORMS:
                body = put(place, form); name = '%s | %s' % (pn, form.replace('\n', ' / '))
                for hn in WHICH:
                    ns = {'c': c, 'E': E, 'M': M}
                    if hn in HEADS:
                        exec(compile(HEADS[hn] + '\n' + indent(body) + '\n', 'p', 'exec'), ns)
                        yield '%s | %s | %s' % (name, hn, ' ; '.join(events(lambda: drive(ns['f'], a, b)) for a in (0, 1) for b in (0, 1)))
                    elif 'return' not in body:
                        code = compile(('class K:\n' + indent(body) if hn == 'class' else body) + '\n', 'p', 'exec')
                        yield '%s | %s | %s' % (name, hn, ' ; '.join(events(lambda: exec(code, dict(ns, a=a, b=b))) for a in (0, 1) for b in (0, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
