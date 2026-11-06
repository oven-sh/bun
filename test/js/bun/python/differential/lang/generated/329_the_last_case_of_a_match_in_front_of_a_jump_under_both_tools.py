# The last case of a `match` in front of a jump: a guard over several lines that ends in a constant, and a body that ends with a `for` loop. What a tool of sys.monitoring
# is told of, what a trace function is told of, and co_branches().
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def put(template, what):
        return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == 'S' else l for l in template.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(template, what):')
try:
    class M:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try: MUCH = '\nx = c(7)\ny = c(8)\nz = c(9)\nreturn y + z'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: MUCH = '\\nx = c(7)\\ny = c(8)\\nz = c(9)\\nreturn y + z'")
try: PLACES = {'arm, much behind': 'if c(1):\n    S\nelse:\n    x = 1' + MUCH, 'arm, little behind': 'if c(1):\n    S\nelse:\n    x = 1\nx = 7', 'loop': 'for k in (1, 2):\n    S', 'while, break': 'while c(1):\n    S\n    break',
          'end': 'S', 'little behind': 'S\nx = 7', 'much behind': 'S' + MUCH, 'handler': 'try:\n    raise E\nexcept E:\n    S' + MUCH, 'handler: while, break': 'try:\n    raise E\nexcept E:\n    while c(1):\n        S\n        break',
          'handler: while, break, much behind': 'try:\n    raise E\nexcept E:\n    while c(1):\n        S\n        break' + MUCH}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = {'arm, much behind': 'if c(1):\\n S\\nelse:\\n x = 1' + MUCH, '...")
try:
    def cases(patterns, bodies): return ['match a:\n    case %s:\n%s' % (p, indent(s, 8)) for p in patterns for s in bodies] + ['match a:\n    case 1:\n        x = 1\n    case %s:\n%s' % (p, indent(s, 8)) for p in patterns for s in bodies]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def cases(patterns, bodies): return ['match a:\\n case %s:\\n%s' % (p, ...")
try: GUARDS = ['(b and\n            0)', '(not b and\n            None)', '(b or\n            1)', '(b and 0)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GUARDS = ['(b and\\n 0)', '(not b and\\n None)', '(b or\\n 1)', '(b and ...")
try: LOOPS = ['for i in (1, 2):\n    x = i', 'for i in (1, 2):\n    if b: break', 'for i in (1, 2):\n    if b: break\nelse:\n    x = 3', 'for i in ():\n    x = i',
         'if c(1):\n    for i in (1, 2):\n        if b: break', 'if b:\n    for i in ():\n        break']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = ['for i in (1, 2):\\n x = i', 'for i in (1, 2):\\n if b: break'...")
try: PROTECTED = ['try:\n    x = 2\nexcept E:\n    x = 3', 'with M():\n    x = 2', 'try:\n    x = 2\nfinally:\n    x = 3']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PROTECTED = ['try:\\n x = 2\\nexcept E:\\n x = 3', 'with M():\\n x = 2', ...")
# What is left out is not as in CPython yet: a guard over several lines in front of a short end of the function, a guard on one line that ends in a constant in a handler, a loop
# with a `break` in a case that cannot fail, with something behind the `match`, a loop at the end of a guarded `case _` that is the last of several,
# and a loop in an `if` in front of a jump.
try: TABLES = [(cases(['%s if %s' % (p, g) for p in ('x', '_') for g in GUARDS], ['x = 2']), lambda place, m: 'little' not in place and not (place.startswith('handler') and '(b and 0)' in m)),
          (cases(['_', 'x', '0', 'x if b', '_ if c(1)'], LOOPS), lambda place, m: not (('break' in place or place in ('little behind', 'much behind')) and 'break' in m and m.split('case ')[-1].startswith(('_:', 'x:'))) and not ('case 1:' in m and '_ if c(1)' in m) and not (place in ('arm, much behind', 'arm, little behind', 'handler') and '    if ' in m.split('case ')[-1].split('\n')[1])),
          (cases(['_', '0', '_ if c(1)', 'x if c(1)'], PROTECTED), lambda place, m: True)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TABLES = [(cases(['%s if %s' % (p, g) for p in ('x', '_') for g in GU...")
try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
try:
    def trace(frame, event, arg):
        if frame.f_code.co_filename != 'p': return None
        events.append(event[0].upper() + str(frame.f_lineno)); return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, arg):')
try: mon = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon = sys.monitoring')
try: ev = mon.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ev = mon.events')
try: TOOL = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TOOL = 3')
try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end: return line
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')
try:
    def on(name, places):
        def callback(code, *a):
            if code.co_filename != 'p': return mon.DISABLE
            events.append(name + ','.join(str(a[0] if name == 'L' else line_of(code, a[i])) for i in range(places)))
        return callback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def on(name, places):')
try: WHAT = {ev.LINE: on('L', 1), ev.PY_RETURN: on('R', 1), ev.JUMP: on('J', 2), ev.BRANCH_LEFT: on('<', 2), ev.BRANCH_RIGHT: on('>', 2)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHAT = {ev.LINE: on('L', 1), ev.PY_RETURN: on('R', 1), ev.JUMP: on('J...")
try:
    def same(rows): return ' ; '.join('=' if i and r == rows[i - 1] else r for i, r in enumerate(rows))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def same(rows): return ' ; '.join('=' if i and r == rows[i - 1] else ...")
try:
    def run(f, args):
        try: f(*args)
        except BaseException as e: events.append(type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, args):')
try: ARGS = ((0, 0), (0, 1), (1, 0), (1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ARGS = ((0, 0), (0, 1), (1, 0), (1, 1))')
try:
    def main():
        for pn, place, m in ((pn, place, m) for matches, isIn in TABLES for pn, place in PLACES.items() for m in matches if isIn(pn, m)):
            source = 'def f(a, b):\n' + indent(put(place, m)) + '\n'
            g = {'c': c, 'E': E, 'M': M}; exec(compile(source, 'p', 'exec'), g)
            f = g['f']; name = pn + ' | ' + ' '.join(m.replace('\n', ' /').split())
            rows = []
            for args in ARGS:
                del events[:]; sys.settrace(trace)
                try: run(f, args)
                finally: sys.settrace(None)
                rows.append(' '.join(events))
            print(name, '| trace |', same(rows))
            rows = []
            mon.use_tool_id(TOOL, 't')
            for e, cb in WHAT.items(): mon.register_callback(TOOL, e, cb)
            mon.set_events(TOOL, sum(WHAT))
            for args in ARGS:
                del events[:]; run(f, args); rows.append(' '.join(events))
            mon.set_events(TOOL, 0); mon.free_tool_id(TOOL)
            print(name, '| tool |', same(rows))
            code = f.__code__
            print(name, '| branches |', sorted(((line_of(code, s), line_of(code, l), line_of(code, r)) for s, l, r in code.co_branches()), key=str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
