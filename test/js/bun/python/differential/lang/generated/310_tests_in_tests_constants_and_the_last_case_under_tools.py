# Small things about tests in tests, constants and the last case of a `match`, as a trace function and a tool of sys.monitoring see them, and co_consts.
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: EV = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EV = M.events')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
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
try: M.use_tool_id(3, 't')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(3, 't')")
try: M.register_callback(3, EV.LINE, line)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(3, EV.LINE, line)')
try: M.register_callback(3, EV.JUMP, two('J'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.JUMP, two('J'))")
try: M.register_callback(3, EV.BRANCH_LEFT, two('bl'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.BRANCH_LEFT, two('bl'))")
try: M.register_callback(3, EV.BRANCH_RIGHT, two('br'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(3, EV.BRANCH_RIGHT, two('br'))")
try:
    def trace(frame, event, arg):
        if frame.f_code.co_filename != 'p': return None
        T.append(event[0].upper() + str(frame.f_lineno)); return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, arg):')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def call(f, args):
        try: return repr(f(*args))
        except Exception as e: return type(e).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call(f, args):')
try: ARGS = ((0, 0), (0, 1), (1, 0), (1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ARGS = ((0, 0), (0, 1), (1, 0), (1, 1))')
try:
    def show(title, bodies, kinds, ARGS=ARGS):
        print('--', title)
        for body in bodies:
            g = {'E': E, 'c': c}
            exec(compile(('async def' if 'K' in kinds and ('await ' in body or 'async ' in body) else 'def') + ' f(a, b):\n' + indent(body) + '\n', 'p', 'exec'), g); f = g['f']
            name = body.replace('\n', ' / ')
            if 'K' in kinds: print(name, '|', f.__code__.co_consts)
            for args in ARGS:
                if 'S' in kinds:
                    del T[:]; sys.settrace(trace)
                    try: r = call(f, args)
                    finally: sys.settrace(None)
                    print(name, '|', args, '|', ' '.join(T), '=>', r)
                if 'M' in kinds:
                    del T[:]; M.set_events(3, EV.LINE | EV.JUMP | EV.BRANCH_LEFT | EV.BRANCH_RIGHT)
                    try: r = call(f, args)
                    finally: M.set_events(3, 0)
                    print(name, '|', args, '|', ' '.join(T))
            if 'J' in kinds:
                for target in range(3, body.count('\n') + 3):
                    # (To the line of `case _:` a frame can go from anywhere in CPython. Not here.)
                    if body.split('\n')[target - 2].strip() == 'case _:': continue
                    del T[:]; done = []
                    def jump(frame, event, arg):
                        if frame.f_code.co_filename != 'p': return None
                        T.append(event[0].upper() + str(frame.f_lineno))
                        if event == 'line' and frame.f_lineno == 2 and not done:
                            done.append(1)
                            try: frame.f_lineno = target
                            except ValueError as e: T.append('(%s)' % e)
                        return jump
                    sys.settrace(jump)
                    try: r = call(f, (1, 1))
                    finally: sys.settrace(None)
                    print(name, '| to', target, '|', ' '.join(T), '=>', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(title, bodies, kinds, ARGS=ARGS):')

try: TESTS = ['((c(a) or b) if c(1) else c(0))', '((c(a) and b) if c(1) else c(0))', '((a or b) if c(0) else c(1))', '((0 < c(a) < 2) if c(1) else c(0))', '((0 < c(a) <\n    2) if c(1) else c(0))',
         '((0 < c(a) < 2 if c(1) else b) or c(0))', '(c(0) if c(b) else (0 < c(a) < 2))', '(not ((c(a) or b) if c(1) else c(0)))']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTS = ['((c(a) or b) if c(1) else c(0))', '((c(a) and b) if c(1) el...")
try: show('the jump behind the first arm of a test that is a conditional expression, in front of something short',
     [t.replace('X', x) for x in TESTS for t in ('if X: return 3', 'if X:\n    return 3', 'if X: raise E', 'return 1 if X else 2', 'assert X', 'assert X\nreturn 4', 'if X:\n    x = 1\n    y = 2\nreturn 5',
                                                 'while X:\n    break')], 'S')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the jump behind the first arm of a test that is a conditional e...")
try: show('a test over several lines that ends in a constant',
     ['if (a and\n    b and\n    0):\n    x = 1', 'if not (a or\n    b or\n    1):\n    x = 1', 'assert (a or\n    b or\n    1)', 'assert (a or\n    b or\n    1), c', 'if a:\n    assert (a or\n        b or\n        1)\nelse:\n    x = 1',
      'for i in (1, 2):\n    assert (a or\n        b or\n        1)', 'for i in (1, 2):\n    if (a and\n        b and\n        0):\n        x = 1', 'if a:\n    if (a and\n        b and\n        0):\n        x = 1\nelse:\n    x = 2',
      'if (a or\n    0): return 3', 'if (a or\n    0):\n    return 3', 'while (a or\n    0):\n    break', 'assert ((a or\n    "x") if c(1) else c(0))', 'assert (a or\n    1)', 'assert (a or\n    1), c(1)', 'assert (a or\n    1), (c(1) if 0 else c(2))', 'if (a and\n    0):\n    x = 1 if 1 else 2', 'match a:\n    case x if (a and\n        0):\n        y = 1',
      'match a:\n    case 0:\n        y = 0\n    case x if (b and\n        0):\n        y = 1', 'match a:\n    case x if (b or\n        1):\n        y = 1'], 'SM')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a test over several lines that ends in a constant', ['if (a and...")
try: COMPARISONS = [p.replace('X', x) for x in ('0 < c(a) < 2', '(0 < c(a) <\n        2)', '(c(0) if c(0) else 0 < c(a) < 2)', '(c(b) and 0 < c(a) < 2)', '(0 < c(a) < 2 if c(b) else c(0))', '0 < c(a) < c(b) < 2')
      for p in ('X', 'if c(1):\n    X', 'if c(b):\n    X\nelse:\n    x = 1', 'for i in (1, 2):\n    X', 'try:\n    X\nexcept E:\n    x = 1')]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: COMPARISONS = [p.replace('X', x) for x in ('0 < c(a) < 2', '(0 < c(a)...")
try: show('a chained comparison at the end of a function', COMPARISONS, 'S')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a chained comparison at the end of a function', COMPARISONS, 'S')")
try: show('a chained comparison that fails at the end of a function', [x for x in COMPARISONS if not x.startswith('try')], 'M', ((0, 0), (0, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a chained comparison that fails at the end of a function', [x f...")
try: show('constants',
     ['(a and\n    "x")', '(a or\n    "x")', '(a\n    if b else\n    "x")', '("x"\n    if b else\n    a)', '(a\n    if b else\n    c(0))', '(b\n    if b else\n    (not a\n    if c(1) else\n    c(b)))', '((c(a) and\n    "x")\n    if b else c(0))',
      '(a and\n    300)', '(a and\n    (1, 2))', '(a and\n    None)', '(a and "x")', 'if a:\n    x = a\nelse:\n    c(0)', 'if a:\n    x = a\nelse:\n    c("s")', 'if a:\n    x = a\nelse:\n    x = 300', 'for i in (a,):\n    if i:\n        x = i\n    else:\n        c(0)',
      'if a:\n    pass\nelif b:\n    c(5)\nelse:\n    c(6)', 'try:\n    x = a\nexcept E:\n    c(0)', 'if a:\n    return\nc(0)', 'if a:\n    x = a\nelse:\n    c(None, 0)', 'match a:\n    case 1:\n        x = a\n    case _:\n        c(0)',
      'while a:\n    if b:\n        break\n    c("s")\n    break', 'if a:\n    x = a\nelse:\n    return "s"', 'if a:\n    x = a\nelse:\n    return None'], 'K')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(\'constants\', [\'(a and\\n "x")\', \'(a or\\n "x")\', \'(a\\n if b else\\n...')
try: NONE = ['await c()', 'x = await c()', 'yield', 'x = yield', 'yield from c()', 'async for i in c(): pass', 'async with c(): pass', 'with c(): pass', 'try:\n    c()\nexcept E as e:\n    pass', 'try:\n    c()\nexcept E as e:\n    return',
        'try:\n    c()\nexcept E as e:\n    x = 7000', 'try:\n    c()\nexcept E as e:\n    pass\nexcept KeyError:\n    pass', 'try:\n    c()\nexcept* E as e:\n    pass', 'for k in a:\n    try:\n        c()\n    except E as e:\n        break',
        'x = [i async for i in c()]', 'x = [await c() for i in a]', 'c((yield))', 'return', 'x = None', 'pass']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: NONE = ['await c()', 'x = await c()', 'yield', 'x = yield', 'yield fr...")
try:
    def put(t, mark, what): return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == mark else l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def put(t, mark, what): return '\\n'.join(indent(what, len(l) - len(l....")
try: show('constants where something loads None',
     [put(t, 'N', n) for n in NONE for t in ('N\nx = "q"', 'x = "q"\nN', 'if a:\n    N\nelse:\n    x = "q"', 'if a:\n    x = "q"\nelse:\n    N', 'try:\n    N\nexcept KeyError:\n    x = "q"', 'for j in a:\n    N\nx = "q"', 'if a:\n    N', 'N',
                                               'if a:\n    if b:\n        N\n    else:\n        x = a\nelse:\n    x = "q"')], 'K')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('constants where something loads None', [put(t, 'N', n) for n in...")
try: LOOPS = ['for i in ():\n    break', 'for i in (1,):\n    break', 'for i in (1, 2):\n    if b: break', 'for i in (1,): pass']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = ['for i in ():\\n break', 'for i in (1,):\\n break', 'for i in ...")
try: show('a loop at the end of the last case',
     ['match 1:\n    case 0: x = 5\n' + indent(k + '\n' + indent(l)) + t for k in ('case _ if a:', 'case _:', 'case 1 if a:', 'case q if a:', 'case 1:') for l in LOOPS for t in ('', '\nx = 7') if not (t and k == 'case _:')], 'SM')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a loop at the end of the last case', ['match 1:\\n case 0: x = 5...")
try: show('the line of a match statement',
     ['z = 0\nmatch %s:\n    case 0:\n        x = 1\n    case _:\n        x = 2' % s for s in ('a', 'f""', 't"x{a}"', 'f"{a}"', '1', '(a,\n    b)', '-a')], 'J')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the line of a match statement', ['z = 0\\nmatch %s:\\n case 0:\\n ...")
try: show('the line of a match statement, as a trace function hears of it',
     ['z = 0\nmatch %s:\n    case 0:\n        x = 1\n    case _:\n        x = 2' % s for s in ('a', 'f""', 't"x{a}"', 'f"{a}"', '1', '(a or\n    b)', '(a,\n    b)', '-a')], 'S')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the line of a match statement, as a trace function hears of it'...")
