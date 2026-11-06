# frame.f_lineno = n from the line of a call that goes through a generator expression by itself, all(... for ...): that is no loop of the program, and the frame cannot go from there into one.
# From each line, the first, second and third time the frame is told of it, to each line.
import sys, warnings, gc
warnings.simplefilter('ignore')
class E(Exception): pass
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def c(v): return v
PROGRAMS = {
    'all, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = all(\n    c(v) for v in (1, 2))\nw = 4',
    'all, in a loop': 'x = 1\nfor i in (1, 2):\n    r = all(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'any, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = any(\n    c(v) for v in (1, 2))\nw = 4',
    'any, in a loop': 'x = 1\nfor i in (1, 2):\n    r = any(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'set, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = set(\n    c(v) for v in (1, 2))\nw = 4',
    'set, in a loop': 'x = 1\nfor i in (1, 2):\n    r = set(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'list, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = list(\n    c(v) for v in (1, 2))\nw = 4',
    'list, in a loop': 'x = 1\nfor i in (1, 2):\n    r = list(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'tuple, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = tuple(\n    c(v) for v in (1, 2))\nw = 4',
    'tuple, in a loop': 'x = 1\nfor i in (1, 2):\n    r = tuple(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'sorted, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = sorted(\n    c(v) for v in (1, 2))\nw = 4',
    'sorted, in a loop': 'x = 1\nfor i in (1, 2):\n    r = sorted(\n        c(v) for v in (1, 2))\n    y = 2\nw = 4',
    'a list comprehension, behind a loop': 'x = 1\nfor i in (1, 2):\n    y = 2\nr = [\n    c(v) for v in (1, 2)]\nw = 4',
}
TIMES = (1, 2, 3)
# CPython goes by what is on its stack, whatever it is, and by every place where a line begins in its code.
NOT_AS_IN_CPYTHON = set()
def these(name, *pairs):
    for p in pairs: NOT_AS_IN_CPYTHON.add((name, p[0], 1, p[1]) if len(p) == 2 else (name,) + p)
# To the line of a `for` loop from a block in it, or with a value: what is on top of the iterator stands for what the iterator gives last, and the loop has ended.
these('all, in a loop', (4, 2, 3), (4, 3, 3), (5, 3), (5, 2, 3))
these('any, in a loop', (4, 2, 3), (5, 3), (5, 2, 3))
these('set, in a loop', (4, 2, 3), (4, 3, 3), (5, 3), (5, 2, 3))
these('list, in a loop', (4, 2, 3), (4, 3, 3), (5, 3), (5, 2, 3))
these('tuple, in a loop', (4, 2, 3), (4, 3, 3), (5, 3), (5, 2, 3))
these('sorted, in a loop', (4, 2, 3), (5, 3), (5, 2, 3))
# To a line of the call itself: in CPython lines begin in the middle of the call, with the function or the generator on the stack; here the statement begins again, or the frame is refused.
these('all, behind a loop', (5, 2, 5), (5, 2, 6), (5, 3, 6), (6, 6))
these('all, in a loop', (4, 2, 4), (4, 2, 5), (4, 3, 5), (5, 5), (5, 2, 5))
these('any, behind a loop', (5, 2, 5), (5, 2, 6), (6, 6))
these('any, in a loop', (4, 2, 4), (4, 2, 5), (5, 5), (5, 2, 5))
these('set, behind a loop', (5, 2, 5), (5, 2, 6), (5, 3, 6), (6, 6))
these('set, in a loop', (4, 2, 4), (4, 2, 5), (4, 3, 5), (5, 5), (5, 2, 5))
these('list, behind a loop', (5, 2, 5), (5, 2, 6), (5, 3, 6), (6, 6))
these('list, in a loop', (4, 2, 4), (4, 2, 5), (4, 3, 5), (5, 5), (5, 2, 5))
these('tuple, behind a loop', (5, 2, 5), (5, 2, 6), (5, 3, 6), (6, 6))
these('tuple, in a loop', (4, 2, 4), (4, 2, 5), (4, 3, 5), (5, 5), (5, 2, 5))
these('sorted, behind a loop', (5, 2, 5), (5, 2, 6), (6, 6))
these('sorted, in a loop', (4, 2, 4), (4, 2, 5), (5, 5), (5, 2, 5))
these('a list comprehension, behind a loop', (5, 5), (5, 2, 5), (6, 2, 5), (6, 2, 6), (6, 3, 5), (6, 3, 6))
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
def run(f, code, source, nth, target, collects):
    ev = []; seen = [0]
    def tr(frame, event, arg):
        if frame.f_code is not code: return None
        if event == 'line':
            ev.append(str(frame.f_lineno))
            if frame.f_lineno == source:
                seen[0] += 1
                if seen[0] == nth:
                    if collects == 'before': gc.collect(0)
                    try: frame.f_lineno = target
                    except ValueError as e: ev.append('(%s)' % e)
                    else: ev.append('>%d' % target)
                    if collects == 'behind': gc.collect(0)
            if len(ev) > 60: raise E('too long')
        return tr
    sys.settrace(tr)
    try:
        r = f()
        if hasattr(r, 'send'):
            got = []
            try:
                while True: got.append(r.send(None))
            except StopIteration as e: r = (got, e.value)
        r = repr(r)
    except BaseException as e: r = '%s: %s' % (type(e).__name__, e)
    finally: sys.settrace(None)
    return ' '.join(ev) + ' => ' + r
# Where the frame goes, once more with a collection before the assignment and once with one behind it, in the trace function (of the youngest generation: any collection looks at the
# frames): that must not tell. (The rows that are not as in CPython run as well.)
def rows():
    for name, body in PROGRAMS.items():
        ns = {'E': E, 'M': M, 'c': c}
        exec(compile('def f():\n' + indent(body) + '\n', 'p', 'exec'), ns)
        count = body.count('\n') + 2
        for source in range(2, count + 1):
            # (From elsewhere into the middle of the call, CPython goes, and crashes.)
            if not body.split('\n')[source - 2].strip().startswith(('r = ', 'c(v)')): continue
            for nth in TIMES:
                for target in range(1, count + 2):
                    got = [run(ns['f'], ns['f'].__code__, source, nth, target, '')]
                    if ' >' in got[0]: got += [run(ns['f'], ns['f'].__code__, source, nth, target, collects) for collects in ('before', 'behind')]
                    if (name, source, nth, target) in NOT_AS_IN_CPYTHON: continue
                    yield '%s | %d (%d) to %d | %s' % (name, source, nth, target, got[0] if len(set(got)) == 1 else got)
for row in rows(): print(row)
