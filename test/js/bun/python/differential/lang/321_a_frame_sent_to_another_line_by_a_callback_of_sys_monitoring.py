# frame.f_lineno = n in a callback of sys.monitoring, for LINE and for JUMP: at each event in turn, to each line. A frame that a jump has taken out of a block is in the block no longer when
# the tool is told of the jump.
import sys, warnings, gc
warnings.simplefilter('ignore')
class E(Exception): pass
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def c(v): return v
MON = sys.monitoring; EV = MON.events
PROGRAMS = {
    'continue, with': 'for i in (1, 2):\n    with M():\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, with as': 'for i in (1, 2):\n    with M() as m:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, with in with': 'for i in (1, 2):\n    with M():\n        with M():\n            if i == 1:\n                continue\n            z = 3\nw = 4',
    'continue, handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, named handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E as e:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, handler in handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        try:\n            raise E\n        except E:\n            if i == 1:\n                continue\n        z = 3\nw = 4',
    'continue, try finally': 'for i in (1, 2):\n    try:\n        y = 2\n        if i == 1:\n            continue\n        z = 3\n    finally:\n        v = 5\nw = 4',
    'continue, clause': 'for i in (1, 2):\n    try:\n        y = 2\n    finally:\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, case': 'for i in (1, 2):\n    match i:\n        case 1:\n            continue\n        case 2:\n            z = 3\nw = 4',
}
NOT_AS_IN_CPYTHON = set()
def these(name, *rows):
    for r in rows: NOT_AS_IN_CPYTHON.add((name,) + r)
# To the line of a `for` loop from a block in it: what the block holds stands for what the iterator gives last, and the loop has ended.
these('continue, with', (2, 2), (3, 2), (4, 2), (9, 2), (10, 2), (11, 2))
these('continue, with as', (2, 2), (3, 2), (4, 2), (9, 2), (10, 2), (11, 2))
these('continue, with in with', (2, 2), (3, 2), (4, 2), (11, 2), (12, 2))
these('continue, handler', (3, 2), (4, 2), (5, 2), (6, 2), (11, 2), (12, 2), (13, 2), (14, 2))
these('continue, named handler', (3, 2), (4, 2), (5, 2), (6, 2), (11, 2), (12, 2), (13, 2), (14, 2))
these('continue, handler in handler', (3, 2), (4, 2), (5, 2), (6, 2), (7, 2), (8, 2), (13, 2), (14, 2), (15, 2), (16, 2), (17, 2), (18, 2), (19, 2))
these('continue, case', (2, 2), (3, 2), (7, 2), (8, 2))
# To the line of a `with` from its body: to the call of __exit__ at the end of the body.
these('continue, with', (2, 3), (3, 3), (4, 3), (9, 3), (10, 3), (11, 3))
these('continue, with as', (2, 3), (3, 3), (4, 3), (9, 3), (10, 3), (11, 3))
these('continue, with in with', (2, 3), (3, 3), (3, 4), (4, 3), (4, 4), (11, 3), (11, 4), (12, 3), (12, 4))
# From the line of a `with` when the tool is told of it again, at the call of __exit__: what the `with` holds is on the stack there, so the frame can go into the body.
these('continue, with', (5, 2), (5, 3), (5, 4), (5, 5), (5, 6), (5, 7), (12, 2), (12, 3), (12, 4), (12, 5), (12, 6), (12, 7))
these('continue, with as', (5, 2), (5, 3), (5, 4), (5, 5), (5, 6), (5, 7), (12, 2), (12, 3), (12, 4), (12, 5), (12, 6), (12, 7))
these('continue, with in with', (5, 2), (5, 3), (5, 4), (5, 5), (5, 6), (5, 7), (6, 2), (6, 3), (6, 4), (10, 2), (10, 3), (13, 2), (13, 3), (13, 4), (13, 5), (13, 6), (13, 7), (14, 2), (14, 3), (14, 4))
# `match`: from the line of a `case` to that of another; to the first line of the body of a case that is not the last.
these('continue, case', (0, 5), (1, 5), (2, 6), (3, 4), (3, 6), (5, 5), (6, 5), (7, 6), (8, 4), (9, 5), (11, 5), (12, 5))
# At the jump that ends a handler, which is still in the block of the handler here.
these('continue, handler in handler', (18, 5), (18, 9), (18, 10))
these('continue, clause', (5, 7))
these('continue, case', (4, 5), (10, 5))
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
def run(f, code, index, target, collects):
    ev = []; count = [0]
    def told(what):
        frame = sys._getframe(2)
        ev.append(what)
        count[0] += 1
        if count[0] - 1 == index:
            if collects == 'before': gc.collect(0)
            try: frame.f_lineno = target
            except ValueError as e: ev.append('(%s)' % e)
            else: ev.append('>%d' % target)
            if collects == 'behind': gc.collect(0)
        if len(ev) > 70: raise E('too long')
    def line(co, n):
        if co is code: told(str(n))
    def jump(co, a, b):
        if co is code: told('j')
    MON.use_tool_id(3, 't'); MON.register_callback(3, EV.LINE, line); MON.register_callback(3, EV.JUMP, jump)
    MON.set_local_events(3, code, EV.LINE | EV.JUMP)
    try: r = repr(f())
    except BaseException as e: r = '%s: %s' % (type(e).__name__, e)
    finally:
        MON.set_local_events(3, code, 0); MON.register_callback(3, EV.LINE, None); MON.register_callback(3, EV.JUMP, None); MON.free_tool_id(3)
    return ' '.join(ev) + ' => ' + r, count[0]
def rows():
    for name, body in PROGRAMS.items():
        ns = {'E': E, 'M': M, 'c': c}
        exec(compile('def f():\n' + indent(body) + '\n', 'p', 'exec'), ns)
        f = ns['f']; lines = body.count('\n') + 2
        events = run(f, f.__code__, -1, 0, '')[1]
        for index in range(events):
            for target in range(1, lines + 2):
                if (name, index, target) in NOT_AS_IN_CPYTHON: continue
                got = [run(f, f.__code__, index, target, '')[0]]
                if ' >' in got[0]: got += [run(f, f.__code__, index, target, collects)[0] for collects in ('before', 'behind')]
                yield '%s | %d to %d | %s' % (name, index, target, got[0] if len(set(got)) == 1 else got)
for row in rows(): print(row)
