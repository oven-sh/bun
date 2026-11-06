# Tests over several lines that end in a constant, or have a branch on the line of the constant, in front of a jump: the guard of the last case of a `match`, `if`, `while`, `assert`.
# And a `break` out of a `while` loop that the function ends with, in all sorts of things. What a tool of sys.monitoring and a trace function are told of, and co_branches().
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    class W:
        def __enter__(self): return self
        def __exit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W:')
try: A = (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A = (1, 2)')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def put(template, what):
        return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == 'S' else l for l in template.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(template, what):')
try: MUCH = '\nx = c(7)\ny = c(8)\nz = c(9)\nreturn y + z'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: MUCH = '\\nx = c(7)\\ny = c(8)\\nz = c(9)\\nreturn y + z'")
try: CONDITIONS = ['(b and\n        0)', '(b and\n        c(0) and 0)', '(b and\n        c(1) and 0)', '(0 and\n        b)', '(b and\n        not 1)', '(b and\n        c(1) and\n        c(0) and None)', '(b and\n        c(0))', '(b and 0)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CONDITIONS = ['(b and\\n 0)', '(b and\\n c(0) and 0)', '(b and\\n c(1) a...")
# What is left out is not as in CPython yet: a guard or the test of a `while` that ends in a call on a line of its own; a guard on one line that ends in a constant; `while (0 and / b)`;
# and, further down, a `for` loop with a `break` in front of the `break` where a copy of the end of the function comes behind it.
try: CALL_BELOW, ON_ONE_LINE, CONSTANT_FIRST = CONDITIONS[6], CONDITIONS[7], CONDITIONS[3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CALL_BELOW, ON_ONE_LINE, CONSTANT_FIRST = CONDITIONS[6], CONDITIONS[7...')
try: TESTS = ['match a:\n    case x if %s:\n        x = 2' % indent(t, 4).lstrip() for t in CONDITIONS if t not in (CALL_BELOW, ON_ONE_LINE)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTS = ['match a:\\n case x if %s:\\n x = 2' % indent(t, 4).lstrip() f...")
try: TESTS += ['match a:\n    case 0:\n        x = 1\n    case %s if %s:\n        x = 2' % (p, indent(t, 4).lstrip()) for p in 'x_' for t in CONDITIONS[:3]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTS += ['match a:\\n case 0:\\n x = 1\\n case %s if %s:\\n x = 2' % (p,...")
try: TESTS += ['if %s:\n    x = 2' % t for t in CONDITIONS] + ['while %s:\n    x = 2' % t for t in CONDITIONS if t not in (CALL_BELOW, CONSTANT_FIRST)] + ['assert (not b or\n        1)', 'assert (not b or\n        c(1) or 1)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTS += ['if %s:\\n x = 2' % t for t in CONDITIONS] + ['while %s:\\n x...")
try: ARM = 'if c(1):\n    S\nelse:\n    x = 1'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ARM = 'if c(1):\\n S\\nelse:\\n x = 1'")
try: PLACES = {'arm': ARM + MUCH, 'try': 'try:\n    S\nexcept E:\n    x = 1' + MUCH, 'else of a try': 'try:\n    x = 0\nexcept E:\n    x = 1\nelse:\n    S' + MUCH, 'finally': 'try:\n    x = 0\nfinally:\n    S' + MUCH,
          'else of a try with finally': 'try:\n    x = 0\nexcept E:\n    x = 1\nelse:\n    S\nfinally:\n    y = 5', 'handler': 'try:\n    raise E\nexcept E:\n    S' + MUCH, 'with': 'with W():\n    S' + MUCH,
          'arm in the else of a try': 'try:\n    x = 0\nexcept E:\n    x = 1\nelse:\n' + indent(ARM) + MUCH, 'arm in a try': 'try:\n' + indent(ARM) + '\nexcept E:\n    x = 1' + MUCH, 'arm in an arm': 'if c(1):\n' + indent(ARM) + '\nelse:\n    x = 3' + MUCH,
          'arm in finally': 'try:\n    x = 0\nfinally:\n' + indent(ARM) + MUCH, 'arm in a handler': 'try:\n    raise E\nexcept E:\n' + indent(ARM) + MUCH, 'arm in a loop': 'for k in (1, 2):\n' + indent(ARM)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = {'arm': ARM + MUCH, 'try': 'try:\\n S\\nexcept E:\\n x = 1' + M...")
try: BODIES = ['if a:\n    x = 1\nelse:\n    x = 2', 'for j in A:\n    if a: break', 'try:\n    c(1)\nexcept E:\n    x = 1', 'match a:\n    case 0:\n        x = 1\n    case _:\n        x = 2', 'with W():\n    x = 1']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODIES = ['if a:\\n x = 1\\nelse:\\n x = 2', 'for j in A:\\n if a: break'...")
try: LOOPS = ['while c(1):\n%s\n    break' % indent(s) for s in BODIES]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = ['while c(1):\\n%s\\n break' % indent(s) for s in BODIES]")
try: AROUND = {'nothing': 'S', 'while': 'while c(1):\n    S\n    break', 'while, return in a try with finally': 'while c(1):\n    try:\n        return 1\n    finally:\n        S', 'return in a try with finally': 'try:\n    return a\nfinally:\n    S',
          'for, return in a try with finally': 'for k in A:\n    try:\n        return 1\n    finally:\n        S', 'handler': 'try:\n    raise E\nexcept E:\n    S', 'handler with a name': 'try:\n    raise E\nexcept E as e:\n    S', 'with': 'with W():\n    S',
          'try': 'try:\n    S\nexcept E:\n    x = 1', 'two whiles, return in a try with finally': 'while c(1):\n    while c(1):\n        try:\n            return 1\n        finally:\n            S'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: AROUND = {'nothing': 'S', 'while': 'while c(1):\\n S\\n break', 'while,...")
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
    def isIn(place, what):
        return not ('for j in A' in what and place in ('nothing', 'while, return in a try with finally', 'return in a try with finally', 'two whiles, return in a try with finally'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def isIn(place, what):')
try:
    def main():
        for pn, place, s in [(pn, place, s) for pn, place in PLACES.items() for s in TESTS] + [(pn, place, s) for pn, place in AROUND.items() for s in LOOPS]:
            if not isIn(pn, s): continue
            g = {'c': c, 'E': E, 'W': W, 'A': A}; exec(compile('def f(a, b):\n' + indent(put(place, s)) + '\n', 'p', 'exec'), g)
            f = g['f']; name = pn + ' | ' + ' '.join(s.replace('\n', ' /').split())
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
