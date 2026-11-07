# The last case of a `match` that is the last statement of something: alternatives, captures and guards over several lines, guards that end in a constant. What a tool of
# sys.monitoring and a trace function are told of, and co_branches(). A `return` in a `while` loop in a `with`. An `assert` that never fails in front of a handler.
import sys, warnings
warnings.simplefilter('ignore')
def c(v): return v
class E(Exception): pass
class AI:
    def __init__(self, n): self.n = n
    def __aiter__(self): return self
    async def __anext__(self):
        if self.n <= 0: raise StopAsyncIteration
        self.n -= 1
        return self.n
class W:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
def put(template, what):
    return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == 'S' else l for l in template.split('\n'))
HEADS = ['(1 |\n      2) if 0', '(1 | 2\n      ) if b', '[1 |\n      2, x] if (b and\n      0)', '(1 |\n      2) as y if (b or\n      0)', 'x if (0 and\n      b)', 'x if (\n      0)',
         '{1: 1 |\n      2} if (b and\n      0)', '(1 |\n      2) if (b and\n      0)', '(1 |\n      2 |\n      3) if (\n      b)', '(1 |\n      2) if (0 or\n      b)', '[1 |\n      2, x] if b',
         '(1 |\n      2) as y if (b and\n      c(1))']
TESTS = []
for head in HEADS:
    TESTS.append('match a:\n    case 5:\n        x = 1\n    case %s:\n        return 5' % head)
    TESTS.append('match a:\n    case %s:\n        x = 2' % head)
ONE = {'if': 'if c(1):\n    S', 'arm': 'if c(1):\n    S\nelse:\n    x = 1', 'elif': 'if c(0):\n    x = 1\nelif c(1):\n    S\nelse:\n    x = 1', 'try': 'try:\n    S\nexcept E:\n    x = 1',
       'else of a try': 'try:\n    x = 0\nexcept E:\n    x = 1\nelse:\n    S', 'finally': 'try:\n    x = 0\nfinally:\n    S', 'with': 'with W():\n    S',
       'handler': 'try:\n    raise E\nexcept E:\n    S', 'handler with a name': 'try:\n    raise E\nexcept E as e:\n    S',
       'default': 'match 1:\n    case 0:\n        x = 1\n    case _:\n        S', 'guarded default': 'match 1:\n    case 0:\n        x = 1\n    case _ if c(1):\n        S',
       'while, break': 'while c(1):\n    S\n    break'}
TAILS = {'much': '\nx = c(7)\ny = c(8)\nz = c(9)\nreturn y + z', 'x = 7': '\nx = 7', 'end': ''}
def place(name):
    *inner, tail = name.replace(' < ', '|').replace(', much', '|much').replace(', x = 7', '|x = 7').replace(', end', '|end').split('|')
    text = 'S'
    for part in reversed(inner): text = put(text, ONE[part])
    return text + TAILS[tail]
PLACES = ['arm, much', 'elif < with, x = 7', 'arm < with, end', 'arm < guarded default, much', 'try, much', 'finally < try, much', 'try < else of a try, much', 'try < with, end',
          'else of a try < finally, much', 'else of a try < default, much']
# The branch of an `if` without an `else` leads where the last case fails to.
IN_AN_IF = ['if < arm < arm, much', 'if < if < arm < arm, much', 'if < arm < else of a try, much']
events = []
def trace(frame, event, arg):
    if frame.f_code.co_filename != 'p': return None
    events.append(event[0].upper() + str(frame.f_lineno)); return trace
mon = sys.monitoring; ev = mon.events; TOOL = 3
def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end: return line
def on(name, places):
    def callback(code, *a):
        if code.co_filename != 'p': return mon.DISABLE
        events.append(name + ','.join(str(a[0] if name == 'L' else line_of(code, a[i])) for i in range(places)))
    return callback
WHAT = {ev.LINE: on('L', 1), ev.PY_RETURN: on('R', 1), ev.JUMP: on('J', 2), ev.BRANCH_LEFT: on('<', 2), ev.BRANCH_RIGHT: on('>', 2)}
def same(rows): return ' ; '.join('=' if i and r == rows[i - 1] else r for i, r in enumerate(rows))
def run(f, args):
    try:
        r = f(*args)
        if hasattr(r, 'send'):
            try: r.send(None)
            except StopIteration as e: r = e.value
        events.append('-> %r' % (r,))
    except BaseException as e: events.append(type(e).__name__)
ARGS = ((0, 0), (0, 1), (1, 0), (1, 1), (2, 1), ([2, 0], 1), ({1: 2}, 0), ({1: 2}, 1))
def rows(name, source, arguments=ARGS, onlyTrace=False):
    g = {'c': c, 'E': E, 'W': W, 'AI': AI}; exec(compile(('async ' if 'async ' in source else '') + 'def f(a, b):\n' + indent(source) + '\n', 'p', 'exec'), g)
    f = g['f']; told = []
    for args in arguments:
        del events[:]; sys.settrace(trace)
        try: run(f, args)
        finally: sys.settrace(None)
        told.append(' '.join(events))
    print(name, '| trace |', same(told))
    if onlyTrace: return
    told = []
    mon.use_tool_id(TOOL, 't')
    for e, cb in WHAT.items(): mon.register_callback(TOOL, e, cb)
    mon.set_events(TOOL, sum(WHAT))
    for args in arguments:
        del events[:]; run(f, args); told.append(' '.join(events))
    mon.set_events(TOOL, 0); mon.free_tool_id(TOOL)
    print(name, '| tool |', same(told))
    code = f.__code__
    print(name, '| branches |', sorted(((line_of(code, s), line_of(code, l), line_of(code, r)) for s, l, r in code.co_branches()), key=str))
def flat(s): return ' '.join(s.replace('\n', ' /').split())

def main():
    for name in PLACES + IN_AN_IF:
        for test in TESTS:
            # (A jump that came of a constant, over what is dropped, to a jump: CPython tells of the two, one after the other.)
            if name in IN_AN_IF and any('case %s:' % HEADS[i] in test for i in (2, 3, 6)): continue
            rows(name + ' | ' + flat(test), put(place(name), test))
    # The exit of the `with` is of the line of the `with`, and so is what comes in front of where the guard fails to.
    for name in ('handler < with', 'handler with a name < with'):
        for tail in TAILS:
            test = 'match a:\n    case x if (a or (b and\n          0)):\n        return 5'
            rows(name + ', ' + tail + ' | ' + flat(test), put(place(name + ', ' + tail), test), ARGS[:4])
    # Cases with alternatives and guards in the `else` of a `try` with a `finally` clause.
    rows('else, finally', 'try:\n    c(100)\nexcept E:\n    (c(101)\n        if a else b)\nelse:\n    match (True and True\n        and c(a)):\n        case (\n        0 | 1) \\\n         if (\nc(0)\n            ):\n'
         '            return c(90)\n        case (1 | 2\n                ) if c(b):\n            (\nc(4))\nfinally:\n    c(102)', ARGS[:5])
    # A `while` loop leaves nothing on the way out.
    for name, source in {'clause, with, while True': 'try:\n    c(1)\nfinally:\n    with W():\n        while True:\n            return (c(a) or\n                c(1))',
                         'with, while, conditional': 'with W():\n    while c(1):\n        return b if a else \\\n            3', 'with, while': 'with W():\n    while c(1):\n        return (c(a) or\n            c(1))',
                         'with': 'with W():\n    return (c(a) or\n        c(1))', 'with, while, while': 'with W():\n    while c(1):\n        while c(1):\n            return (c(a) or\n                c(1))',
                         'with, for': 'with W():\n    for i in (1, 2):\n        return (c(a) or\n            c(1))', 'with, while, else': 'with W():\n    while c(b):\n        x = 1\n        break\n    else:\n        return (c(a) or\n            c(1))',
                         'with, for, while': 'with W():\n    for i in (1, 2):\n        while c(1):\n            return (c(a) or\n                c(1))'}.items():
        rows(name, source, ARGS[:4], True)
    # What raises the AssertionError cannot be reached, and a handler comes next.
    PARTS = {'the clause': 'try:\n    c(1)\nfinally:\n    S', 'the clause, handlers': 'try:\n    c(1)\nexcept E:\n    c(2)\nfinally:\n    S', 'the else': 'try:\n    c(1)\nexcept E:\n    c(2)\nelse:\n    S',
             'the else, finally': 'try:\n    c(1)\nexcept E:\n    c(2)\nelse:\n    S\nfinally:\n    c(3)', 'the body': 'try:\n    S\nexcept E:\n    c(2)', 'the handler': 'try:\n    raise E\nexcept E:\n    S',
             'the handler with a name': 'try:\n    raise E\nexcept E as e:\n    S', 'the with': 'with W():\n    S'}
    INNER = {'': 'S', ', if True': 'if True:\n    S', ', the else of a for': 'for i in ():\n    pass\nelse:\n    S', ', in the body of a try': 'try:\n    S\nfinally:\n    c(6)'}
    for part, outer in PARTS.items():
        for into, inner in INNER.items():
            for test in ('assert 1', "assert 'x', c(9)", 'assert (1 or\n    c(0))'):
                for behind in ('', '\nc(7)'):
                    source = put(inner, put(outer, test)) if into == ', in the body of a try' else put(outer, put(inner, test))
                    rows(part + into + ' | ' + flat(test) + ' | ' + flat(behind), source + behind, ARGS[:1], True)
    # The same at the end of the body of an `async for`, and of its `else` at the end of a case.
    for name, source in {'the body': 'async for i in AI(2):\n    S', 'the else, in a case': 'match 1:\n    case 1:\n        async for i in AI(1):\n            y = 1\n        else:\n            S'}.items():
        for test in ('assert 1', "assert 'x', c(9)", 'assert (c(0) or\n    1)', 'assert i or 1'):
            for tail in TAILS:
                rows('async for, ' + name + ' | ' + flat(test) + ', ' + tail, 'i = 0\n' + put(source, test) + TAILS[tail], ARGS[:1], True)
    # The loop is left by an exception alone.
    for part, outer in PARTS.items():
        rows(part + ', while True', put(outer, 'while True:\n    assert 1\n    if c(a): raise E\n    a = 1'), ARGS[:1], True)
main()
