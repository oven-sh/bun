# frame.f_lineno = n in functions with one compound statement, or one in another: every pair of lines. What the assignment raises, the lines the frame is then on, and what the function returns.
import sys, warnings, gc
warnings.simplefilter('ignore')
class E(Exception): pass
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def c(v): return v
PROGRAMS = {
    'for': 'x = 1\nfor i in (1, 2):\n    y = 2\n    z = 3\nw = 4',
    'for else': 'x = 1\nfor i in (1, 2):\n    y = 2\n    z = 3\nelse:\n    v = 5\nw = 4',
    'for in for': 'x = 1\nfor i in (1, 2):\n    for j in (3, 4):\n        y = 2\n    z = 3\nw = 4',
    'while': 'x = 0\nwhile x < 2:\n    x += 1\n    z = 3\nw = 4',
    'with': 'x = 1\nwith M():\n    y = 2\n    z = 3\nw = 4',
    'with as': 'x = 1\nwith M() as m:\n    y = 2\n    z = 3\nw = 4',
    'with in with': 'x = 1\nwith M():\n    with M():\n        y = 2\n    z = 3\nw = 4',
    'with two': 'x = 1\nwith M(), M():\n    y = 2\n    z = 3\nw = 4',
    'with in for': 'x = 1\nfor i in (1, 2):\n    with M():\n        y = 2\n    z = 3\nw = 4',
    'for in with': 'x = 1\nwith M():\n    for i in (1, 2):\n        y = 2\n    z = 3\nw = 4',
    'match': 'x = 1\nmatch x:\n    case 2:\n        y = 2\n    case 1:\n        y = 4\n    case _:\n        y = 3\nw = 4',
    'match no default': 'x = 1\nmatch x:\n    case 2:\n        y = 2\n    case 1:\n        y = 3\nw = 4',
    'match capture': 'x = 1\nmatch x:\n    case 2:\n        y = 2\n    case q:\n        y = 3\nw = 4',
    'match guard': 'x = 1\nmatch x:\n    case 2:\n        y = 2\n    case _ if c(0):\n        y = 3\n    case _:\n        y = 5\nw = 4',
    'try except': 'x = 1\ntry:\n    y = 2\nexcept E:\n    y = 3\nw = 4',
    'try except raise': 'x = 1\ntry:\n    raise E\nexcept E:\n    y = 3\n    z = 5\nw = 4',
    'try except as': 'x = 1\ntry:\n    raise E\nexcept E as e:\n    y = 3\n    z = 5\nw = 4',
    'try except finally': 'x = 1\ntry:\n    y = 2\nexcept E:\n    y = 3\nfinally:\n    z = 5\nw = 4',
    'try raise except finally': 'x = 1\ntry:\n    raise E\nexcept E:\n    y = 3\nfinally:\n    z = 5\nw = 4',
    'try finally': 'x = 1\ntry:\n    y = 2\nfinally:\n    z = 5\n    v = 6\nw = 4',
    'try except else': 'x = 1\ntry:\n    y = 2\nexcept E:\n    y = 3\nelse:\n    z = 5\nw = 4',
    'two handlers': 'x = 1\ntry:\n    raise E\nexcept KeyError:\n    y = 3\nexcept E:\n    z = 5\nw = 4',
    'try in handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    try:\n        raise E\n    except E:\n        y = 3\n    z = 5\nw = 4',
    'if': 'x = 1\nif c(x):\n    y = 2\nelse:\n    y = 3\nw = 4',
}
TIMES = (1,)
# CPython goes by what is on its stack, whatever it is, and by every place where a line begins in its code.
NOT_AS_IN_CPYTHON = set()
def these(name, *pairs):
    for p in pairs: NOT_AS_IN_CPYTHON.add((name, p[0], 1, p[1]) if len(p) == 2 else (name,) + p)
# To the line of a `for` loop from a block in it, or with a value: what is on top of the iterator stands for what the iterator gives last, and the loop has ended.
these('for in for', (5, 3))
these('with in for', (5, 3))
# To the line of a `with` from its body: to the call of __exit__, at the end of the body or on the way of a `return`.
these('with', (4, 3), (5, 3))
these('with as', (4, 3), (5, 3))
these('with in with', (4, 3), (5, 3), (5, 4), (6, 3))
these('with two', (4, 3), (5, 3))
these('with in for', (5, 4))
these('for in with', (4, 3), (5, 3), (6, 3))
# `match`: from the line of a `case`, or of a part of its pattern, to that of another, with the subject on the stack; to the line of `case _:`, where nothing is; to the first line of the
# body of a case that is not the last, of which what drops the subject is.
these('match', (2, 5), (2, 8), (3, 5), (3, 8), (4, 6), (4, 8), (6, 4), (6, 8), (7, 5), (7, 8), (10, 5), (10, 8))
these('match no default', (2, 5), (3, 5), (4, 6), (6, 4), (7, 5), (8, 5))
these('match capture', (2, 5), (3, 5), (4, 6), (6, 4), (7, 5), (8, 5))
these('match guard', (2, 5), (2, 8), (3, 5), (3, 8), (4, 6), (4, 8), (6, 4), (6, 8), (8, 5), (9, 5), (9, 8), (10, 5), (10, 8))
# To the last line of a handler in front of a `finally`: something that does nothing is left of that line behind the handler.
these('try raise except finally', (2, 6), (3, 6), (4, 6), (8, 6), (9, 6))
# Into or out of a `finally` clause, or to the line of a `return` that has its value: an exception, an iterator or what a `with` holds stands for the value that waits, or the other way round.
these('try raise except finally', (5, 7), (5, 8))
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
