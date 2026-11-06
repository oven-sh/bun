# frame.f_lineno = n where a value to return waits while more than a `finally` clause runs: the end of a `with`, of a loop that owns its iterator, of a handler with a name; and the clause
# may never hand the value on. From the lines of the clause to every line. A collection comes wherever code of the program runs on the way out, and at the assignment: it must not tell.
import sys, warnings, gc, re
warnings.simplefilter('ignore')
def collect(): gc.collect(0)
class E(Exception): pass
class V:
    def __repr__(self): return 'V()'
class M:
    def __enter__(self): return self
    def __exit__(self, *a): collect(); return False
class K:
    def __await__(self): yield 'k'
class AM:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): await K(); collect(); return False
def c(v): collect(); return v
def items():
    try: yield 1; yield 2
    finally: collect()
ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue', 'raise': 'raise E', 'goes on': 'z = 3'}
WAYS = {'with': 'with M():\n    return V()', 'loop': 'for i in items():\n    return V()', 'handler': 'try:\n    raise E\nexcept E as e:\n    return V()',
        'inner clause': 'try:\n    return V()\nfinally:\n    c(0)', 'with in loop': 'for i in items():\n    with M():\n        return V()', 'plain': 'return V()', 'with, value over lines': 'with M():\n    return (V() if c(1) else\n        c(2))',
        'async with': 'async with AM():\n    return V()', 'async with in with': 'with M():\n    async with AM():\n        return V()'}
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
def program(way, end):
    first = 'try:\n' + indent(way) + '\nfinally:\n    x = 1\n' + indent(end)
    if end in ('break', 'continue'): first = 'for k in (1, 2):\n' + indent(first)
    return 'if s:\n' + indent(first) + '\ntry:\n    return V()\nfinally:\n    y = 2'
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
for wn, way in WAYS.items():
    for en, end in ENDS.items():
        name = wn + ', ' + en
        body = program(way, end)
        ns = {'E': E, 'M': M, 'c': c, 'V': V, 'items': items, 'AM': AM}
        exec(compile(('async ' if 'async' in wn else '') + 'def f(s):\n' + indent(body) + '\n', 'p', 'exec'), ns)
        lines = body.split('\n'); count = len(lines) + 1
        clause = lines.index(next(l for l in lines if l.strip() == 'x = 1')) + 2; second = len(lines) - 2
        for source in range(clause, second):
            for target in range(1, count + 2):
                # Not as in CPython yet, from within a loop: the line of the loop, where it goes on with the next item there and begins the loop again here; and where a value waits, for which CPython takes what the loop goes through.
                if en in ('break', 'continue') and (target == 3 or target > second + 1): continue
                if target == 1 and 'async' in wn: continue # CPython dies.
                print('%s | %d to %d | %s' % (name, source, target, run(ns['f'], ns['f'].__code__, source, target)), flush=True)
