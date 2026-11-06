# frame.f_lineno = n for a frame that has left a block by `continue`: it is told of the line where the jump leads, and is in the block no longer.
# From each line, the first and the second time the frame is told of it, to each line.
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
try:
    class AM:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AM:')
try: PROGRAMS = {
    'continue, with': 'for i in (1, 2):\n    with M():\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, with as': 'for i in (1, 2):\n    with M() as m:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, with in with': 'for i in (1, 2):\n    with M():\n        with M():\n            if i == 1:\n                continue\n            z = 3\nw = 4',
    'continue, handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, named handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E as e:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, handler in handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        try:\n            raise E\n        except E:\n            if i == 1:\n                continue\n        z = 3\nw = 4',
    'continue, try finally': 'for i in (1, 2):\n    try:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\n    finally:\n        v = 5\nw = 4',
    'continue, clause': 'for i in (1, 2):\n    try:\n        y = 2\n    finally:\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, case': 'for i in (1, 2):\n    match i:\n        case 1:\n            continue\n        case 2:\n            z = 3\nw = 4',
    'continue, while, with': 'i = 0\nwhile i < 2:\n    i += 1\n    with M():\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, while, handler': 'i = 0\nwhile i < 2:\n    i += 1\n    try:\n        raise E\n    except E:\n        if i == 1:\n            continue\n        z = 3\nw = 4',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PROGRAMS = { 'continue, with': 'for i in (1, 2):\\n with M():\\n y = 2\\...")
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
try: these('continue, with', (4, 2), (4, 2, 2), (5, 2), (5, 2, 2), (6, 2), (7, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with', (4, 2), (4, 2, 2), (5, 2), (5, 2, 2), (6, 2),...")
try: these('continue, with as', (4, 2), (4, 2, 2), (5, 2), (5, 2, 2), (6, 2), (7, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with as', (4, 2), (4, 2, 2), (5, 2), (5, 2, 2), (6, ...")
try: these('continue, with in with', (4, 2), (5, 2), (5, 2, 2), (6, 2), (7, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with in with', (4, 2), (5, 2), (5, 2, 2), (6, 2), (7...")
try: these('continue, handler', (5, 2), (5, 2, 2), (6, 2), (6, 2, 2), (7, 2), (7, 2, 2), (8, 2), (9, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, handler', (5, 2), (5, 2, 2), (6, 2), (6, 2, 2), (7, ...")
try: these('continue, named handler', (5, 2), (5, 2, 2), (6, 2), (6, 2, 2), (7, 2), (7, 2, 2), (8, 2), (9, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, named handler', (5, 2), (5, 2, 2), (6, 2), (6, 2, 2)...")
try: these('continue, handler in handler', (5, 2), (5, 2, 2), (6, 2), (6, 2, 2), (7, 2), (7, 2, 2), (8, 2), (8, 2, 2), (9, 2), (9, 2, 2), (10, 2), (11, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, handler in handler', (5, 2), (5, 2, 2), (6, 2), (6, ...")
try: these('continue, case', (4, 2), (4, 2, 2), (5, 2), (6, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, case', (4, 2), (4, 2, 2), (5, 2), (6, 2))")
# To the line of a `with` from its body: to the call of __exit__, at the end of the body or on the way of a `return`.
try: these('continue, with', (4, 3), (4, 2, 3), (5, 3), (5, 2, 3), (6, 3), (7, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with', (4, 3), (4, 2, 3), (5, 3), (5, 2, 3), (6, 3),...")
try: these('continue, with as', (4, 3), (4, 2, 3), (5, 3), (5, 2, 3), (6, 3), (7, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with as', (4, 3), (4, 2, 3), (5, 3), (5, 2, 3), (6, ...")
try: these('continue, with in with', (4, 3), (5, 3), (5, 4), (5, 2, 3), (5, 2, 4), (6, 3), (6, 4), (7, 3), (7, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with in with', (4, 3), (5, 3), (5, 4), (5, 2, 3), (5...")
try: these('continue, while, with', (6, 5), (6, 2, 5), (7, 5), (8, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, while, with', (6, 5), (6, 2, 5), (7, 5), (8, 5))")
# From the line of a `with` when the frame is told of it again, at the call of __exit__: what the `with` holds is on the stack there, so the frame can go into the body.
try: these('continue, with', (3, 2, 2), (3, 2, 3), (3, 2, 4), (3, 2, 5), (3, 2, 6), (3, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with', (3, 2, 2), (3, 2, 3), (3, 2, 4), (3, 2, 5), (...")
try: these('continue, with as', (3, 2, 2), (3, 2, 3), (3, 2, 4), (3, 2, 5), (3, 2, 6), (3, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with as', (3, 2, 2), (3, 2, 3), (3, 2, 4), (3, 2, 5)...")
try: these('continue, with in with', (3, 2, 2), (3, 2, 3), (3, 2, 4), (4, 2, 2), (4, 2, 3), (4, 2, 4), (4, 2, 5), (4, 2, 6), (4, 2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, with in with', (3, 2, 2), (3, 2, 3), (3, 2, 4), (4, ...")
try: these('continue, while, with', (5, 2, 5), (5, 2, 6), (5, 2, 7), (5, 2, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, while, with', (5, 2, 5), (5, 2, 6), (5, 2, 7), (5, 2...")
# `match`: from the line of a `case`, or of a part of its pattern, to that of another, with the subject on the stack; to the line of `case _:`, where nothing is; to the first line of the
# body of a case that is not the last, of which what drops the subject is.
try: these('continue, case', (2, 5), (2, 2, 5), (3, 5), (3, 2, 5), (4, 6), (4, 2, 6), (5, 4), (5, 6), (6, 4), (7, 5), (8, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('continue, case', (2, 5), (2, 2, 5), (3, 5), (3, 2, 5), (4, 6),...")
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
            ns = {'E': E, 'M': M, 'AM': AM, 'c': c}
            exec(compile(('async ' if 'async' in body else '') + 'def f():\n' + indent(body) + '\n', 'p', 'exec'), ns)
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
