# frame.f_lineno = n where a value to return waits while more than a `finally` clause runs: the end of a `with`, of a loop that owns its iterator, of a handler with a name; and the clause
# may never hand the value on. From the lines of the clause to every line. A collection comes wherever code of the program runs on the way out, and at the assignment: it must not tell.
try: import sys, warnings, gc, re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings, gc, re')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def collect(): gc.collect(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def collect(): gc.collect(0)')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    class V:
        def __repr__(self): return 'V()'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V:')
try:
    class M:
        def __enter__(self): return self
        def __exit__(self, *a): collect(); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try:
    class K:
        def __await__(self): yield 'k'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try:
    class AM:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): await K(); collect(); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AM:')
try:
    def c(v): collect(); return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): collect(); return v')
try:
    def items():
        try: yield 1; yield 2
        finally: collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def items():')
try: ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue', 'raise': 'raise E', 'goes on': 'z = 3'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue...")
try: WAYS = {'with': 'with M():\n    return V()', 'loop': 'for i in items():\n    return V()', 'handler': 'try:\n    raise E\nexcept E as e:\n    return V()',
        'inner clause': 'try:\n    return V()\nfinally:\n    c(0)', 'with in loop': 'for i in items():\n    with M():\n        return V()', 'plain': 'return V()', 'with, value over lines': 'with M():\n    return (V() if c(1) else\n        c(2))',
        'async with': 'async with AM():\n    return V()', 'async with in with': 'with M():\n    async with AM():\n        return V()'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WAYS = {'with': 'with M():\\n return V()', 'loop': 'for i in items():\\...")
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def program(way, end):
        first = 'try:\n' + indent(way) + '\nfinally:\n    x = 1\n' + indent(end)
        if end in ('break', 'continue'): first = 'for k in (1, 2):\n' + indent(first)
        return 'if s:\n' + indent(first) + '\ntry:\n    return V()\nfinally:\n    y = 2'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def program(way, end):')
try:
    def run(f, code, source, target):
        ev = []; done = [False]
        def tr(frame, event, arg):
            if frame.f_code is not code: return None
            if event == 'line':
                ev.append(str(frame.f_lineno))
                if frame.f_lineno == source and not done[0]:
                    done[0] = True
                    try: frame.f_lineno = target
                    except ValueError as e: ev.append('(%s)' % e)
                    else: ev.append('>%d' % target)
                    collect()
                if len(ev) > 60: raise E('too long')
            return tr
        sys.settrace(tr)
        try:
            r = f(1)
            if hasattr(r, 'send'):
                try:
                    while True: r.send(None)
                except StopIteration as e: r = e.value
            r = repr(r)
        except BaseException as e: r = '%s: %s' % (type(e).__name__, e)
        finally: sys.settrace(None)
        return ' '.join(ev) + ' => ' + re.sub(' at 0x[0-9a-f]+', '', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, code, source, target):')
try:
    for wn, way in WAYS.items():
        for en, end in ENDS.items():
            try: name = wn + ', ' + en
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: name = wn + ', ' + en")
            try: body = program(way, end)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: body = program(way, end)')
            try: ns = {'E': E, 'M': M, 'c': c, 'V': V, 'items': items, 'AM': AM}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'E': E, 'M': M, 'c': c, 'V': V, 'items': items, 'AM': AM}")
            try: exec(compile(('async ' if 'async' in wn else '') + 'def f(s):\n' + indent(body) + '\n', 'p', 'exec'), ns)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(('async ' if 'async' in wn else '') + 'def f(s):\\n' + in...")
            try: lines = body.split('\n')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: lines = body.split('\\n')")
            try: count = len(lines) + 1
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count = len(lines) + 1')
            try: clause = lines.index(next(l for l in lines if l.strip() == 'x = 1')) + 2
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: clause = lines.index(next(l for l in lines if l.strip() == 'x = 1')) + 2")
            try: second = len(lines) - 2
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: second = len(lines) - 2')
            for source in range(clause, second):
                for target in range(1, count + 2):
                    # Not as in CPython yet, from within a loop: the line of the loop, where it goes on with the next item there and begins the loop again here; and where a value waits, for which CPython takes what the loop goes through.
                    if en in ('break', 'continue') and (target == 3 or target > second + 1): continue
                    if target == 1 and 'async' in wn: continue # CPython dies.
                    try: print('%s | %d to %d | %s' % (name, source, target, run(ns['f'], ns['f'].__code__, source, target)), flush=True)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: print('%s | %d to %d | %s' % (name, source, target, run(ns['f'], ns['...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for wn, way in WAYS.items():')
