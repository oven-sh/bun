# `x = (a or b) if c else d` is told of twice: in CPython the jump over the other value is of no line if a branch leads to it, so what comes after the expression is a
# line that begins. Not so where what comes after it is short and ends the function: that is copied to where the jump was, and then there is no jump to be told of either.
try: import contextlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import contextlib')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import textwrap
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import textwrap')

try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')

try: PRELUDE = '''
def g(a, b, c, d):
    yield (a or b) if c else d
def f(a, b, c, d):
    global G
    o = O(); l = [0, 1]; l2 = [1, 2]; x = 0
    y = 0
%s
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PRELUDE = ''' def g(a, b, c, d): yield (a or b) if c else d def f(a, ...")


try:
    class O:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O:')


try:
    def n(*x, **k):
        return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n(*x, **k):')


try:
    @contextlib.contextmanager
    def cm(*x):
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cm(*x):')


try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end:
                return line
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')


try:
    def run(function, args, log):
        try:
            result = function(*args)
            if hasattr(result, 'send'):
                list(result)
        except Exception as e:
            log.append(type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(function, args, log):')


try:
    def lines(function, args):
        log = []

        def trace(frame, event, arg):
            if frame.f_code.co_filename != 'generated':
                return None
            if event == 'line':
                log.append(str(frame.f_lineno))
            return trace
        sys.settrace(trace)
        try:
            run(function, args, log)
        finally:
            sys.settrace(None)
        return ' '.join(log[2:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lines(function, args):')


try:
    def jumps(function, args):
        log = []

        def callback(name):
            def told(code, source, destination):
                if code.co_filename == 'generated':
                    log.append('%s%s>%s' % (name, line_of(code, source), line_of(code, destination)))
            return told
        M.use_tool_id(1, 'test')
        for event, name in ((E.BRANCH_LEFT, 'L'), (E.BRANCH_RIGHT, 'R'), (E.JUMP, 'J')):
            M.register_callback(1, event, callback(name))
        M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP)
        try:
            run(function, args, log)
        finally:
            M.set_events(1, 0)
            M.free_tool_id(1)
        return ' '.join(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def jumps(function, args):')


try:
    def show(title, body, with_jumps):
        code = compile(PRELUDE % textwrap.indent(body, ' ' * 4), 'generated', 'exec')
        namespace = {'O': O, 'n': n, 'cm': cm}
        exec(code, namespace)
        rows = []
        for args in ((0, 1, 1, 0), (1, 1, 1, 0), (0, 0, 0, 0)):
            row = lines(namespace['f'], args)
            if with_jumps:
                row += ' | ' + jumps(namespace['f'], args)
            rows.append(row)
        print(title)
        for row in dict.fromkeys(rows):
            print('   ', row)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(title, body, with_jumps):')


# What the first value is, and what uses the value of the expression.
try:
    for body in (
        'x = (a or b) if c else d',
        'x = (a and b) if c else d',
        'x = (a or b or d) if c else d',
        'x = (a and b or d) if c else d',
        'x = (not (a or b)) if c else d',
        'x = (a < b < c) if c else d',
        'x = ((a or b) if b else c) if c else d',
        'x = (a if b else (c or d)) if c else d',
        'x = ((a or b) if b else (c or d)) if c else d',
        'x = a if not c else ((a or b) if c else d)',
        'x = a if not c else (a or b)',
        'x = (a and (3 if b else 1)) if c else d',
        'x = (a or (3 if b else 1)) if c else d',
        'x = (not a or (3 if b else 1)) if c else d',
        'x = (a and (3 if b\n     else 1)) if c else d',
        'x = (a and b and (3 if b else 1)) if c else d',
        'x = (a and (b or (3 if b else 1))) if c else d',
        'x = (a and (3 if b else (a or b))) if c else d',
        'x = (a and ((a or b) if b else 1)) if c else d',
        'x = (a and (3 if b else 1)) if c else (a or b)',
        'x = (1 if not b else (a and (3 if b else 1))) if c else d',
        'x = [(a and (3 if b else 1)) if c else d]',
        'y += (not a or (2 if b else 1)) if c else 5',
        'x = (0 or b) if c else d',
        'x = (1 or b) if c else d',
        'x = (a or 1) if c else d',
        'x = (1 and b) if c else d',
        'x = (a or b) if 1 else d',
        'x = (a or b) if 0 else d',
        'x = (w := a or b) if c else d',
        'n((w := (a or b) if c else d))',
        'x = n((a or b) if c else d)',
        'x = ((a or b) if c else d, 1)',
        'o.x = (a or b) if c else d',
        'l[0] = (a or b) if c else d',
        'G = (a or b) if c else d',
        'y += (a or b) if c else d',
        'x: int = (a or b) if c else d',
        '(a or b) if c else d',
        'x = z = (a or b) if c else d',
        'x, z = (a or l2) if c else l2',
        'x = ((a or b) if c else d) + 1',
        'x = ((a or b) if c else d) or b',
        'if (a or b) if c else d:\n    x = 1',
        'while (a or b) if c else d:\n    break',
        'assert (a or b) if c else 1',
        'x = [(i or b) if c else d for i in (0, 1)]',
        'x = list((i or b) if c else d for i in (0, 1))',
        'x = (lambda: (a or b) if c else d)()',
        'x = f"{(a or b) if c else d}"',
        'x = list(g(a, b, c, d))',
        'x = ((a or b) if c\n    else d)',
        'x = ((a or\n    b) if c\n    else d)',
        '(\n    x) = ((a or b) if c else d)',
        'x = (a or b) if c else d; y = 1',
        'x = n(x=(a or b) if c else d)',
        'def h(k=(a or b) if c else d): pass',
        'x = l2[(a or b) if c else d]',
        'x = l2[(a or b) if c else d:]',
        'x = [*((a or l2) if c else l2)]',
        'x = {1: (a or b) if c else d}',
        'x = ((a or b) if c else d) == 1',
        'x = -((a or b) if c else d)',
        'del l[(a and d) if c else d]',
        'with cm((a or b) if c else d):\n    pass',
        'for i in (a or l2) if c else l2:\n    pass',
        'match (a or b) if c else d:\n    case 1:\n        pass',
    ):
        try: show(body, body + '\ny = 2', False)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(body, body + '\\ny = 2', False)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for body in (')

try: VALUES = ('(a or b) if c else d', 'a if c else d')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: VALUES = ('(a or b) if c else d', 'a if c else d')")
# What comes after the expression, up to the end of the function.
try:
    for value in VALUES:
        for form in ('x = V', 'x: int = V', 'y += V', 'x = z = V', 'o.x = V', 'G = V', 'x = n(V)', 'x = -(V)', 'n(V)', 'return V', 'return n(V)', 'return -(V)', 'return (V) + 1', 'return (V, 1)',
                     'return [V, 1, 2]', 'raise KeyError(V)', 'raise V', 'return (V).real', 'return not (V)', 'x = (V) + 1', 'x = (V).real', 'yield V', 'x = yield V', 'return (V) is None', 'return l[V]',
                     'x, z = V, 1', 'del l[V]', 'return n(1, V)', 'return n(x=V)'):
            for after in ('', 'return x', 'return 1', 'return', 'return x.real', 'return x + 1', 'raise KeyError', 'y = 2', 'pass', 'return G', 'return not x'):
                if after and form.startswith(('return', 'raise')):
                    continue
                try: show('%s / %r' % (form.replace('V', value), after), form.replace('V', value) + '\n' + after, True)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('%s / %r' % (form.replace('V', value), after), form.replace('V',...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for value in VALUES:')

# In blocks.
try:
    for value in VALUES:
        for name, context in {
            'for': 'for i in (1, 2):\n{S4}',
            'for for': 'for i in (1, 2):\n    for j in (1, 2):\n{S8}',
            'while': 'while y < 2:\n    y += 1\n{S4}',
            'try': 'try:\n{S4}\nexcept ValueError:\n    pass',
            'try in for': 'for i in (1, 2):\n    try:\n{S8}\n    except ValueError:\n        pass',
            'except': 'try:\n    raise ValueError\nexcept ValueError:\n{S4}',
            'except as': 'try:\n    raise ValueError\nexcept ValueError as e:\n{S4}',
            'try finally': 'try:\n{S4}\nfinally:\n    y = 3',
            'with': 'with cm():\n{S4}',
            'if': 'if c or not c:\n{S4}',
            'if else': 'if c or not c:\n{S4}\nelse:\n    y = 5',
            'else': 'if not (c or not c):\n    y = 5\nelse:\n{S4}',
            'if, then more': 'if c or not c:\n{S4}\ny = 7\ny = 8\ny = 9',
            'match': 'match 1:\n    case 1:\n{S8}\n    case 2:\n        y = 5',
            'try else': 'try:\n    pass\nexcept ValueError:\n    pass\nelse:\n{S4}',
            'elif': 'if not (c or not c):\n    y = 5\nelif c or not c:\n{S4}',
            'elif else': 'if not (c or not c):\n    y = 5\nelif c or not c:\n{S4}\nelse:\n    y = 6',
            'default case': 'match 1:\n    case 2:\n        y = 5\n    case _:\n{S8}',
            'if else in if': 'if c or not c:\n    if c or not c:\n{S8}\n    else:\n        y = 5',
            'if else in if else': 'if c or not c:\n    if c or not c:\n{S8}\n    else:\n        y = 5\nelse:\n    y = 6',
            'if in try': 'try:\n    if c or not c:\n{S8}\n    else:\n        y = 5\nexcept ValueError:\n    pass',
            'try in try': 'try:\n    try:\n{S8}\n    except KeyError:\n        pass\nexcept ValueError:\n    pass',
            'try in if else': 'if c or not c:\n    try:\n{S8}\n    except KeyError:\n        pass\nelse:\n    y = 5',
            'except in for': 'for i in (1, 2):\n    try:\n        raise ValueError\n    except ValueError:\n{S8}',
            'with in for': 'for i in (1, 2):\n    with cm():\n{S8}',
            'while in for': 'for i in (1, 2):\n    while y < 9:\n        y += 1\n{S8}',
        }.items():
            for form in ('return V', 'x = V\nreturn x', 'x = V\nreturn 1', 'x = V', 'x = V\nreturn', 'return n(V)', 'raise KeyError(V)', 'x = V\nraise KeyError', 'y += V', 'x = V\npass', 'return (V,\n    1)',
                         'return (\n    V)', 'V', 'x = V\nbreak', 'x = V\ncontinue'):
                if form.endswith(('break', 'continue')) and 'for' not in name and name != 'while':
                    continue
                # (However short the `finally` clause is, it counts as too long.)
                if (name, form) == ('try finally', 'return V'):
                    continue
                try: statement = form.replace('V', value)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: statement = form.replace('V', value)")
                try: show('%s / %s / %r' % (value, name, form), context.format(S4=textwrap.indent(statement, ' ' * 4), S8=textwrap.indent(statement, ' ' * 8)), False)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('%s / %s / %r' % (value, name, form), context.format(S4=textwrap...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for value in VALUES:')


# Other code than that of a function.
try:
    for source in (
        'y = 0\nx = (a or b) if c else d\n',
        'y = 0\nx = (a or b) if c else d\ny = 1\n',
        'y = 0\n(a or b) if c else d\n',
        'class K:\n    y = 0\n    x = (a or b) if c else d\n',
        'class K:\n    y = 0\n    x = (a or b) if c else d\n    y = 1\n',
        'async def f():\n    y = 0\n    x = (a or b) if c else d\ntry: f().send(None)\nexcept StopIteration: pass\n',
        'async def f():\n    y = 0\n    return (a or b) if c else d\ntry: f().send(None)\nexcept StopIteration: pass\n',
        'def f():\n    yield 1\n    return (a or b) if c else d\nlist(f())\n',
        'def f():\n    yield 1\n    x = (a or b) if c else d\nlist(f())\n',
        'def o():\n    x = 0\n    def f():\n        nonlocal x\n        x = (a or b) if c else d\n    f()\no()\n',
    ):
        try: code = compile(source, 'generated', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = compile(source, 'generated', 'exec')")
        try: print('repr(source) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', repr(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(source)')
        for c in (1, 0):
            try: print('   ', "lines(lambda: exec(code, {'a': 0, 'b': 1, 'c': c, 'd': 0}), ()) [" + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', lines(lambda: exec(code, {'a': 0, 'b': 1, 'c': c, 'd': 0}), ()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: lines(lambda: exec(code, {'a': 0, 'b': 1, 'c': c, 'd': 0}), ())")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in (')


# The values, wherever they go: jumps that go further than to the end of their own expression take the value along.
try: import itertools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools')
try: EXPRESSIONS = (
    '(a and (3 if b else 1)) if c else d', '(a or (3 if b else 1)) if c else d', '(a and b and (3 if b else 1)) if c else d', '(a and (b or (3 if d else 1))) if c else d',
    '(a and (3 if b else (a or d))) if c else d', '(a and ((a or d) if b else 1)) if c else 7', '(a and (3 if b else 1)) if c else (a or b)', '(1 if not b else (a and (3 if d else 4))) if c else 5',
    '((a and (3 if b else 1)) if c else d) if d else (a or (5 if b else 6))', '(a and (3 if b else (4 if d else (a and (6 if c else 7))))) if c else 8', '(x and (3 if b else 1)) if c else x',
    '(a and (x if b else 1)) if c else d', '(a or (x + 1 if b else x + 2)) if c else x + 3',
)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: EXPRESSIONS = ( '(a and (3 if b else 1)) if c else d', '(a or (3 if b...")
try: FORMS = {
    'return': 'return V', 'variable': 'x = V\nreturn x', 'augmented': 'x += V\nreturn x', 'item': 'l = [0]\nl[0] = V\nreturn l', 'argument': 'return n2(V, x)', 'in a list': 'return [x, V, x]',
    'cell': 'x = V\nreturn (lambda: x)()', 'global': 'global G\nG = V\nreturn G', 'two targets': 'x = y = V\nreturn x, y', 'test': 'if V:\n    return 1\nreturn 2', 'in and': 'return (V) and x', 'walrus': 'return (x := V), x',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = { 'return': 'return V', 'variable': 'x = V\\nreturn x', 'augme...")
try:
    for expression in EXPRESSIONS:
        for name, form in FORMS.items():
            try: namespace = {'n2': lambda *v: v}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace = {'n2': lambda *v: v}")
            try: exec('def f(a, b, c, d):\n    x = 9\n' + textwrap.indent(form.replace('V', expression), '    '), namespace)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec('def f(a, b, c, d):\\n x = 9\\n' + textwrap.indent(form.replace('V...")
            try: print("'%s | %s | %s' % (expression, name, [namespace['f'](*v) for v in iter... [" + 'expression=' + (repr(expression) if type(expression) in (str, int, float, bytes, bool, type(None)) or (type(expression) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in expression)) else expression.__name__ if type(expression) is type else type(expression).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'form=' + (repr(form) if type(form) in (str, int, float, bytes, bool, type(None)) or (type(form) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in form)) else form.__name__ if type(form) is type else type(form).__name__) + '] =>', '%s | %s | %s' % (expression, name, [namespace['f'](*v) for v in itertools.product((0, 1), repeat=4)]))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%s | %s | %s' % (expression, name, [namespace['f'](*v) for v in iter...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for expression in EXPRESSIONS:')
