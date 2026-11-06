# frame.f_lineno = n where a `return` goes over several lines: the frame is told of the line of the `return` once more when the value has been computed, and has the value then.
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
try: PROGRAMS = {
    'a call': 'x = 1\ntry:\n    return (\n        c(x))\nfinally:\n    y = 2\n    z = 3',
    'a variable': 'x = 1\ntry:\n    return (\n        x)\nfinally:\n    y = 2\n    z = 3',
    'a constant': 'x = 1\ntry:\n    return (\n        5)\nfinally:\n    y = 2\n    z = 3',
    'two returns': 'x = 1\ntry:\n    if c(0):\n        return (\n            c(x))\n    return (\n        c(x) + 1)\nfinally:\n    y = 2\n    z = 3',
    'two clauses': 'x = 1\ntry:\n    try:\n        return (\n            c(x))\n    finally:\n        y = 2\nfinally:\n    z = 3',
    'in a loop': 'x = 1\nfor i in (1, 2):\n    try:\n        return (\n            c(x))\n    finally:\n        y = 2\nz = 3',
    'in a with': 'x = 1\nwith M():\n    try:\n        return (\n            c(x))\n    finally:\n        y = 2\nz = 3',
    'a with in the try': 'x = 1\ntry:\n    with M():\n        return (\n            c(x))\nfinally:\n    y = 2\nz = 3',
    'a loop in the try': 'x = 1\ntry:\n    for i in (1, 2):\n        return (\n            c(x))\nfinally:\n    y = 2\nz = 3',
    'in a handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    try:\n        return (\n            c(x))\n    finally:\n        y = 2\nz = 3',
    'a return in a handler': 'x = 1\ntry:\n    raise E\nexcept E:\n    return (\n        c(x))\nfinally:\n    y = 2\nz = 3',
    'a named handler': 'x = 1\ntry:\n    raise E\nexcept E as e:\n    return (\n        c(x))\nfinally:\n    y = 2\nz = 3',
    'no finally, a with': 'x = 1\nwith M():\n    return (\n        c(x))\nz = 3',
    'no finally, a loop': 'x = 1\nfor i in (1, 2):\n    return (\n        c(x))\nz = 3',
    'no block': 'x = 1\nreturn (\n    c(x))',
    'a return in the clause': 'x = 1\ntry:\n    return (\n        c(x))\nfinally:\n    y = 2\n    return (\n        y)',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PROGRAMS = { 'a call': 'x = 1\\ntry:\\n return (\\n c(x))\\nfinally:\\n y ...")
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
try: these('in a loop', (5, 3), (8, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('in a loop', (5, 3), (8, 3))")
try: these('a loop in the try', (5, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a loop in the try', (5, 4))")
try: these('no finally, a loop', (4, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('no finally, a loop', (4, 3))")
# To the line of a `with` from its body: to the call of __exit__, at the end of the body or on the way of a `return`.
try: these('in a with', (5, 3), (8, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('in a with', (5, 3), (8, 3))")
try: these('a with in the try', (5, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a with in the try', (5, 4))")
try: these('no finally, a with', (4, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('no finally, a with', (4, 3))")
# From the line of a `with` when the frame is told of it again, at the call of __exit__: what the `with` holds is on the stack there, so the frame can go into the body.
try: these('in a with', (3, 2, 3), (3, 2, 4), (3, 2, 5), (3, 2, 6), (3, 2, 7), (3, 2, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('in a with', (3, 2, 3), (3, 2, 4), (3, 2, 5), (3, 2, 6), (3, 2,...")
try: these('a with in the try', (4, 2, 4), (4, 2, 5), (4, 2, 6), (4, 2, 7), (4, 2, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a with in the try', (4, 2, 4), (4, 2, 5), (4, 2, 6), (4, 2, 7)...")
try: these('no finally, a with', (3, 2, 3), (3, 2, 4), (3, 2, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('no finally, a with', (3, 2, 3), (3, 2, 4), (3, 2, 5))")
# Into or out of a `finally` clause, or to the line of a `return` that has its value: an exception, an iterator or what a `with` holds stands for the value that waits, or the other way round.
try: these('a with in the try', (5, 7), (5, 8), (6, 7), (6, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a with in the try', (5, 7), (5, 8), (6, 7), (6, 8))")
try: these('a loop in the try', (5, 7), (5, 8), (6, 7), (6, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a loop in the try', (5, 7), (5, 8), (6, 7), (6, 8))")
try: these('in a handler', (5, 7), (5, 9), (5, 10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('in a handler', (5, 7), (5, 9), (5, 10))")
try: these('a return in a handler', (5, 6), (5, 8), (5, 9), (6, 8), (6, 9), (7, 8), (7, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a return in a handler', (5, 6), (5, 8), (5, 9), (6, 8), (6, 9)...")
try: these('a named handler', (5, 6), (5, 8), (5, 9), (6, 8), (6, 9), (7, 8), (7, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a named handler', (5, 6), (5, 8), (5, 9), (6, 8), (6, 9), (7, ...")
try: these('a return in the clause', (4, 8), (7, 8), (9, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: these('a return in the clause', (4, 8), (7, 8), (9, 8))")
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
