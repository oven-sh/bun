# frame.f_lineno = n where something that has no name is read again further on, or lies in another register there: the exception that a `finally` clause raises again, the one an outer `except` clause
# tests, the iterator of a loop, what a `with` holds, the subject of a `match`. From each line, the first and the second time the frame is told of it, to each line.
try: import sys, warnings, gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings, gc')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
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
try: PROGRAMS = {
    'raise in a clause that runs with an exception': 'x = 1\ntry:\n    try:\n        raise E\n    finally:\n        if c(x):\n            raise E\n        y = 2\nexcept E:\n    z = 3\nw = 4',
    'return in a clause that runs with an exception': 'x = 1\ntry:\n    raise E\nfinally:\n    return x\nw = 4',
    'a clause that may return, with an exception': 'x = 1\ntry:\n    try:\n        raise E\n    finally:\n        if c(0):\n            return x\n        y = 2\nexcept E:\n    z = 3\nw = 4',
    'return first in a for': 'x = 1\nfor i in (1, 2):\n    return 5\nw = 4',
    'handler in handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    y = 2\n    try:\n        raise E\n    except E:\n        z = 3\n    v = 5\nw = 4',
    'for, and for in something': 'x = 1\nfor i in (1, 2):\n    y = 2\nif c(x):\n    with M():\n        for j in (3, 4):\n            z = 3\nw = 4',
    'with, and with in something': 'x = 1\nwith M():\n    y = 2\nfor i in (1, 2):\n    with M():\n        z = 3\nw = 4',
    'class pattern over lines': 'x = M()\nx.a = 1; x.b = 2\nmatch x:\n    case M(\n        a=1,\n        b=2\n    ):\n        y = 2\nw = 4',
    'class pattern over lines, wildcard last': 'x = M()\nx.a = 1; x.b = 2\nmatch x:\n    case M(a=5):\n        y = 1\n    case M(\n        a=1,\n        b=_\n    ):\n        y = 2\nw = 4',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PROGRAMS = { 'raise in a clause that runs with an exception': 'x = 1\\...")
try: TIMES = (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TIMES = (1, 2)')
# CPython goes by what is on its stack, whatever it is, and by every place where a line begins in its code.
try: NOT_AS_IN_CPYTHON = set()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NOT_AS_IN_CPYTHON = set()')
try:
    def these(name, *pairs):
        for p in pairs: NOT_AS_IN_CPYTHON.add((name, p[0], 1, p[1]) if len(p) == 2 else (name,) + p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def these(name, *pairs):')
# To the line of a `for` loop from a block in it, or with a value: what is on top of the iterator stands for what the iterator gives last, and the loop has ended.
try: these('for, and for in something', (3, 2, 7), (4, 7), (4, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('for, and for in something', (3, 2, 7), (4, 7), (4, 2, 7))")
try: these('with, and with in something', (7, 5), (7, 2, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('with, and with in something', (7, 5), (7, 2, 5))")
# To the line of a `with` from its body: to the call of __exit__, at the end of the body or on the way of a `return`.
try: these('for, and for in something', (3, 2, 6), (4, 6), (4, 2, 6), (7, 6), (7, 2, 6), (8, 6), (8, 2, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('for, and for in something', (3, 2, 6), (4, 6), (4, 2, 6), (7, ...")
try: these('with, and with in something', (4, 3), (5, 2, 3), (6, 3), (7, 3), (7, 6), (7, 2, 3), (7, 2, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('with, and with in something', (4, 3), (5, 2, 3), (6, 3), (7, 3...")
# From the line of a `with` when the frame is told of it again, at the call of __exit__: what the `with` holds is on the stack there, so the frame can go into the body.
try: these('for, and for in something', (6, 2, 6), (6, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('for, and for in something', (6, 2, 6), (6, 2, 7))")
try: these('with, and with in something', (3, 2, 3), (3, 2, 4), (6, 2, 3), (6, 2, 4), (6, 2, 5), (6, 2, 6), (6, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('with, and with in something', (3, 2, 3), (3, 2, 4), (6, 2, 3),...")
# `match`: from the line of a `case`, or of a part of its pattern, to that of another, with the subject on the stack; to the line of `case _:`, where nothing is; to the first line of the
# body of a case that is not the last, of which what drops the subject is.
try: these('class pattern over lines', (5, 7), (6, 5), (6, 6), (6, 7), (7, 5), (7, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('class pattern over lines', (5, 7), (6, 5), (6, 6), (6, 7), (7,...")
try: these('class pattern over lines, wildcard last', (2, 6), (3, 6), (4, 6), (5, 7), (7, 5), (7, 2, 5), (7, 2, 7), (8, 5), (8, 7), (8, 8), (11, 6), (12, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('class pattern over lines, wildcard last', (2, 6), (3, 6), (4, ...")
# Into or out of a `finally` clause, or to the line of a `return` that has its value: an exception, an iterator or what a `with` holds stands for the value that waits, or the other way round.
try: these('raise in a clause that runs with an exception', (10, 6), (10, 7), (10, 8), (10, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('raise in a clause that runs with an exception', (10, 6), (10, ...")
try: these('a clause that may return, with an exception', (10, 6), (10, 7), (10, 8), (10, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a clause that may return, with an exception', (10, 6), (10, 7)...")
# Into the body of a `with` from a loop: the iterator stands for what the `with` holds.
try: these('with, and with in something', (5, 2, 4), (6, 4), (7, 4), (7, 2, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('with, and with in something', (5, 2, 4), (6, 4), (7, 4), (7, 2...")
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, code, source, nth, target, collects):')
# Where the frame goes, once more with a collection before the assignment and once with one behind it, in the trace function (of the youngest generation: any collection looks at the
# frames): that must not tell. (The rows that are not as in CPython run as well.)
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try:
    for row in rows(): print(row)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for row in rows(): print(row)')
