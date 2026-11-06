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
    'continue, while, with': 'i = 0\nwhile i < 2:\n    i += 1\n    with M():\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'continue, while, handler': 'i = 0\nwhile i < 2:\n    i += 1\n    try:\n        raise E\n    except E:\n        if i == 1:\n            continue\n        z = 3\nw = 4',
    'break, with': 'for i in (1, 2):\n    with M():\n        y = 2\n        if i == 1:\n            break\n        z = 3\nw = 4',
    'break, handler': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        y = 2\n        if i == 1:\n            break\n        z = 3\nw = 4',
    'break, for in for': 'for i in (1, 2):\n    for j in (3, 4):\n        y = 2\n        if j == 3:\n            break\n        z = 3\nw = 4',
    'break, for in for, with': 'for i in (1, 2):\n    for j in (3, 4):\n        with M():\n            if j == 3:\n                break\n        z = 3\nw = 4',
    'the end of a with ends the body': 'for i in (1, 2):\n    y = 2\n    with M():\n        z = 3\nw = 4',
    'the end of a handler ends the body': 'for i in (1, 2):\n    try:\n        raise E\n    except E:\n        z = 3\nw = 4',
    'the end of a loop ends the body': 'for i in (1, 2):\n    for j in (3, 4):\n        z = 3\nw = 4',
}
NOT_AS_IN_CPYTHON = set()
def these(name, *rows):
    for r in rows: NOT_AS_IN_CPYTHON.add((name,) + r)
# To the line of a `for` loop from a block in it: what the block holds stands for what the iterator gives last, and the loop has ended.
these('break, with', (2, 2), (3, 2), (4, 2))
these('break, handler', (3, 2), (4, 2), (5, 2), (6, 2))
these('break, for in for', (2, 2), (3, 2), (4, 2), (8, 2), (9, 2), (10, 2))
these('break, for in for, with', (2, 2), (3, 2), (3, 3), (4, 2), (4, 3), (9, 2), (10, 2), (10, 3), (11, 2), (11, 3))
these('the end of a with ends the body', (3, 2), (9, 2))
these('the end of a handler ends the body', (3, 2), (4, 2), (9, 2), (10, 2))
these('the end of a loop ends the body', (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (7, 2), (11, 2), (12, 2), (13, 2), (14, 2), (15, 2), (16, 2))
# To the line of a `with` from its body: to the call of __exit__ at the end of the body.
these('continue, while, with', (4, 5), (5, 5), (11, 5), (12, 5))
these('break, with', (2, 3), (3, 3), (4, 3))
these('break, for in for, with', (3, 4), (4, 4), (10, 4), (11, 4))
these('the end of a with ends the body', (3, 4), (9, 4))
# From the line of a `with` when the tool is told of it again, at the call of __exit__: what the `with` holds is on the stack there, so the frame can go into the body.
these('continue, while, with', (6, 5), (6, 6), (6, 7), (6, 8), (13, 5), (13, 6), (13, 7), (13, 8))
these('break, with', (5, 2), (5, 3), (5, 4), (5, 5), (5, 6), (5, 7))
these('break, for in for, with', (5, 2), (5, 3), (5, 4), (5, 5), (5, 6), (12, 2), (12, 3), (12, 4), (12, 5), (12, 6))
these('the end of a with ends the body', (4, 2), (4, 4), (4, 5), (10, 2), (10, 4), (10, 5))
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
