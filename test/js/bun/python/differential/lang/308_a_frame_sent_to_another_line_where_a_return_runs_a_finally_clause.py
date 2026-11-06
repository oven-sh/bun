# frame.f_lineno = n in functions that return through a `finally` clause: every pair of lines. What the assignment raises, the lines the frame is then on, and what the function returns.
#
# While the clause runs on the way of a `return`, the value waits. A frame that is elsewhere cannot be sent into that copy of the clause: there would be nothing to return.
import sys, warnings, gc
warnings.simplefilter('ignore')
class E(Exception): pass
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def c(v): return v
PROGRAMS = {
    'return a variable': 'x = 1\ntry:\n    return x\nfinally:\n    y = 2',
    'return a constant': 'x = 1\ntry:\n    return 5\nfinally:\n    y = 2',
    'return nothing': 'x = 1\ntry:\n    return\nfinally:\n    y = 2',
    'return a call': 'x = 1\ntry:\n    return c(x)\nfinally:\n    y = 2\n    z = 3',
    'the try may go on': 'x = 1\ntry:\n    if c(x):\n        return x\n    w = 4\nfinally:\n    y = 2\n    z = 3\nv = 5',
    'two returns': 'x = 1\ntry:\n    if c(0):\n        return x\n    return x + 1\nfinally:\n    y = 2\n    z = 3',
    'a return in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    y = 2\n    return y',
    'an if in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    if c(x):\n        y = 2\n    z = 3',
    'a loop in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    for i in (1, 2):\n        y = i\n    z = 3',
    'a try in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    try:\n        y = 2\n    except E:\n        y = 3\n    z = 4',
    'two clauses': 'x = 1\ntry:\n    try:\n        return x\n    finally:\n        y = 2\nfinally:\n    z = 3',
    'in a loop': 'x = 1\nfor i in (1, 2):\n    try:\n        return x\n    finally:\n        y = 2\nz = 3',
    'in a loop, break in the clause': 'x = 1\nfor i in (1, 2):\n    try:\n        return x\n    finally:\n        y = 2\n        break\nz = 3',
    'in a while loop, continue in the clause': 'x = 0\nwhile x < 2:\n    x += 1\n    try:\n        return x\n    finally:\n        y = 2\n        continue\nz = 3',
    'in a with': 'x = 1\nwith M():\n    try:\n        return x\n    finally:\n        y = 2\nz = 3',
    'a with in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    with M():\n        y = 2\n    z = 3',
    'in a handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    try:\n        return x\n    finally:\n        y = 2\nz = 3',
    'with handlers': 'x = 1\ntry:\n    return x\nexcept E:\n    w = 4\nfinally:\n    y = 2\nz = 3',
    'a return in a handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    return x\nfinally:\n    y = 2\nz = 3',
    'a return in the else': 'x = 1\ntry:\n    w = 4\nexcept E:\n    w = 5\nelse:\n    return x\nfinally:\n    y = 2\nz = 3',
    'a match in the clause': 'x = 1\ntry:\n    return x\nfinally:\n    match x:\n        case 1:\n            y = 2\n        case _:\n            y = 3',
    'a clause left by break in the clause': 'x = 1\ntry:\n    return c(x)\nfinally:\n    for i in (1, 2):\n        try:\n            if c(0): break\n            y = 2\n        finally:\n            z = 3',
    'a clause left by continue in the clause': 'x = 1\ntry:\n    return c(x)\nfinally:\n    for i in (1, 2):\n        try:\n            if c(i == 1): continue\n            y = 2\n        finally:\n            z = 3',
    'a clause left by break in a clause in the clause': 'x = 1\ntry:\n    return c(x)\nfinally:\n    try:\n        y = 2\n    finally:\n        while True:\n            try:\n                break\n            finally:\n                z = 3',
    'the clause of the second return': 'x = 1\ntry:\n    for i in (1, 2):\n        if c(0):\n            return c(3)\n    return c(4)\nfinally:\n    y = 2\n    z = 3',
}
TIMES = (1,)
# CPython goes by what is on its stack, whatever it is, and by every place where a line begins in its code.
NOT_AS_IN_CPYTHON = set()
def these(name, *pairs):
    for p in pairs: NOT_AS_IN_CPYTHON.add((name, p[0], 1, p[1]) if len(p) == 2 else (name,) + p)
# To the line of a `for` loop from a block in it, or with a value: what is on top of the iterator stands for what the iterator gives last, and the loop has ended.
these('in a loop', (7, 3))
these('in a loop, break in the clause', (7, 3), (8, 3))
# To the line of a `with` from its body: to the call of __exit__, at the end of the body or on the way of a `return`.
these('in a with', (7, 3))
these('a with in the clause', (7, 6))
# `match`: from the line of a `case`, or of a part of its pattern, to that of another, with the subject on the stack; to the line of `case _:`, where nothing is; to the first line of the
# body of a case that is not the last, of which what drops the subject is.
these('a match in the clause', (6, 9), (7, 9), (8, 9))
# To the last line of a handler in front of a `finally`: something that does nothing is left of that line behind the handler.
these('with handlers', (2, 6), (3, 6), (4, 6), (8, 6))
# Into or out of a `finally` clause, or to the line of a `return` that has its value: an exception, an iterator or what a `with` holds stands for the value that waits, or the other way round.
these('a with in the clause', (7, 5))
these('in a handler', (5, 8), (5, 9))
these('a return in a handler', (5, 7), (5, 8), (6, 7), (6, 8))
these('a return in the else', (2, 6), (3, 6), (4, 6), (8, 6), (10, 6))
these('the clause of the second return', (5, 8), (5, 9), (5, 10))
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
            for nth in TIMES:
                for target in range(1, count + 2):
                    got = [run(ns['f'], ns['f'].__code__, source, nth, target, '')]
                    if ' >' in got[0]: got += [run(ns['f'], ns['f'].__code__, source, nth, target, collects) for collects in ('before', 'behind')]
                    if (name, source, nth, target) in NOT_AS_IN_CPYTHON: continue
                    yield '%s | %d (%d) to %d | %s' % (name, source, nth, target, got[0] if len(set(got)) == 1 else got)
for row in rows(): print(row)
