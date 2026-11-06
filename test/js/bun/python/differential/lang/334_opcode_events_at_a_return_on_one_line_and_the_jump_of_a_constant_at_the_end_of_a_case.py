# A trace function that asks for opcode events raises at the k-th of a frame, for every k. What can come of it when that event is at the line of a `return` on one line: there are
# other instructions here than in CPython, but each is in the same `try` and `with` statements.
import sys
class E(Exception): pass
class V:
    def __init__(self, n): self.n = n
    def __repr__(self): return 'V(%d)' % self.n
class CM:
    def __init__(self, o): self.o = o
    def __enter__(self): self.o('enter')
    def __exit__(self, t, v, tb): self.o('exit:%s' % (t and t.__name__))
SOURCES = {'two clauses': '''def f(o, a):
    try:
        try:
            o(4)
            return V(5)
        finally: o('inner')
    finally: o('outer')
''', 'a clause in a try with a handler': '''def f(o, a):
    try:
        try:
            o(4)
            return V(5)
        finally: o('inner')
    except E: o('caught'); return 'handled'
''', 'a clause in a with': '''def f(o, a):
    with CM(o):
        try:
            o(4)
            return V(5)
        finally: o('inner')
''', 'a clause': '''def f(o, a):
    try:
        o(3)
        return V(5)
    finally: o('inner')
''', 'two ways through the value': '''def f(o, a):
    try:
        try:
            o(4)
            return V(5) if a else V(6)
        finally: o('inner')
    finally: o('outer')
''', 'a while loop in a clause': '''def f(o, a):
    try:
        while a:
            o(4)
            return V(5) if a else V(6)
    finally: o('outer')
'''}
for name, value in {'a call': 'V(5)', 'a method call': 'a.bit_length()', 'a conditional': 'V(5) if a else V(6)', 'or': 'a or V(6)', 'and': 'a and V(6)', 'a chain of comparisons': '0 < a < 2', 'a comprehension': '[V(i) for i in (1, 2)]', 'a conditional that is assigned': '(x := V(5) if a else V(6))', 'not': 'not (a if a else 0)', 'a conditional in a tuple': '(1, a if a else 0)', 'a conditional in a call': 'V(5 if a else 6)', 'an attribute': 'a.real', 'a conditional in a conditional': '(1 if a else 2) if a else 3', 'a dict comprehension': '{i: i for i in (1, 2)}', 'a name': 'a', 'a sum': 'a + (1 if a else 2)'}.items():
    SOURCES[name] = "def f(o, a):\n    try:\n        try:\n            o(4)\n            return %s  # return V\n        finally: o('inner')\n    finally: o('outer')\n" % value
def main():
    for name, source in SOURCES.items():
        g = dict(E=E, V=V, CM=CM); exec(compile(source, 'p', 'exec'), g)
        code = g['f'].__code__
        target = [i + 1 for i, l in enumerate(source.split('\n')) if 'return V' in l][0]
        outcomes = set()
        for k in range(1, 400):
            log = []; count = [0]; at = []
            def trace(frame, event, arg):
                if frame.f_code is not code: return None
                frame.f_trace_opcodes = True
                if event == 'opcode':
                    count[0] += 1
                    if count[0] == k:
                        at.append(frame.f_lineno)
                        raise E
                return trace
            sys.settrace(trace)
            try: r = 'returned %r' % (g['f'](log.append, 1),)
            except E: r = 'raised E'
            finally: sys.settrace(None)
            if not at: break
            if at[0] == target: outcomes.add(' '.join(map(str, log)) + ' | ' + r)
        print(name, '|', ' ;; '.join(sorted(outcomes)))
main()

# The jump that came of a constant, at the end of a case that is not the default, in a `match` that ends the else of a `try` or a `finally` clause.
def c(v): return v
MUCH = '    x = c(7)\n    y = c(8)\n    z = c(9)\n    return y + z\n'
PLACES = {'else': 'def f(a, b):\n    try:\n        x = 1\n    except E:\n        x = 2\n    else:\n        match 1:\n            case 1:\n', 'finally': 'def f(a, b):\n    try:\n        x = 1\n    finally:\n        match 1:\n            case 1:\n'}
TESTS = {'guard': 'match a:\n    case x if (b and\n            0):\n        x = 2\n', 'if': 'if (b and\n        0):\n    x = 2\n', 'while': 'while (b and\n        0):\n    x = 2\n'}
def jumps():
    mon = sys.monitoring; ev = mon.events
    for place, before in PLACES.items():
        for test, text in TESTS.items():
            source = before + ''.join(' ' * 16 + l + '\n' for l in text.splitlines()) + MUCH
            g = dict(c=c, E=E); exec(compile(source, 'p', 'exec'), g); code = g['f'].__code__; events = []
            def line_of(offset):
                for s, e, l in code.co_lines():
                    if s <= offset < e: return l
            mon.use_tool_id(3, 't')
            mon.register_callback(3, ev.LINE, lambda co, n: events.append('L%d' % n))
            mon.register_callback(3, ev.JUMP, lambda co, s, d: events.append('J%s>%s' % (line_of(s), line_of(d))))
            mon.set_local_events(3, code, ev.LINE | ev.JUMP)
            g['f'](1, 1)
            mon.free_tool_id(3)
            print(place, test, '|', *events)
jumps()
