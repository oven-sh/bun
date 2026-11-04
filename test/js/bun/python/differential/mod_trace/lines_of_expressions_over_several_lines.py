# The lines that a trace function is told of where a statement takes several: displays with * and **, long displays,
# augmented assignment, a `return` in a `with`, and handlers of several `with` items on the line that raises.
import sys


class C:
    def __enter__(self): return 1
    def __exit__(self, *a): return False


class S:
    def __enter__(self): return 1
    def __exit__(self, *a): return True


class O:
    v = 1
    def m(self, a): return self


def note(v): return v
def bad(): raise ValueError


SOURCES = [
    'x = [\n *[note(0)],\n note(1)]',
    'x = [\n note(0),\n note(1),\n *[note(2)],\n note(3),\n *[note(4)]]',
    'x = (\n note(0),\n *[note(2)],\n note(3))',
    'x = {\n note(0),\n note(1),\n *[note(2)],\n note(3)}',
    'x = {\n *[note(2)],\n note(3)}',
    'x = {\n **{1: note(0)},\n 3: note(1)}',
    'x = {\n 1: note(0),\n 2:\n note(1),\n **{3: note(0)},\n 4: note(1),\n 5: note(2),\n **{},\n **{}}',
    'x = {\n 1: note(0),\n 2: note(1)}',
    'x = note(\n *[note(0)],\n )',
    'x = dict(\n a=note(0),\n **{"b": note(1)},\n c=note(2))',
    'x = dict(\n a=note(0),\n b=note(1),\n **{"c": note(1)},\n d=note(2),\n e=note(3))',
    'x = dict(\n **{"c": note(1)},\n **{"d": note(1)})',
    'x = dict(\n *[],\n a=note(0),\n b=note(1))',
    'x = dict(\n [],\n *[],\n a=note(0),\n b=\n note(1))',
    'x = dict(\n a=note(0),\n b=note(1))',
    'x = [\n' + ''.join(' note(%d),\n' % i for i in range(31)) + ']',
    'x = [\n' + ''.join(' note(%d),\n' % i for i in range(30)) + ']',
    'x = [\n' + ''.join(' note(%d),\n' % i for i in range(31)) + ' *[1]]',
    'x = {\n' + ''.join(' note(%d),\n' % i for i in range(31)) + '}',
] + [
    'x = {\n' + ''.join(' %d: note(%d),\n' % (i, i) for i in range(n)) + '}' for n in (15, 16, 17, 18, 32, 33, 34, 35, 40)
] + [
    'x = {\n' + ''.join(' %d: note(%d),\n' % (i, i) for i in range(n)) + ' **{},\n' + ''.join(' %d: note(%d),\n' % (i, i) for i in range(m)) + '}' for n, m in ((2, 16), (16, 2), (17, 17), (18, 1))
] + [
    'x = 1\nx += (\n note(1))',
    'x = 1\nx |= (note(1)\n if note(2)\n else note(3))',
    'o = O()\no.v += (\n note(1))',
    'd = {0: 0}\nd[\n note(0)\n ] += (\n note(1))',
    'global g\ng = 1\ng += (\n note(1))',
    'x = 1\ndef inner(): return x\nx += (\n note(1))',
    'o = O()\nwith C():\n    return (o .m(\n     note(1))\n     .v)',
    'o = O()\nwith C():\n    return (\n     o .m(\n     note(1))\n     .v)',
    'o = O()\nwith C(), C():\n    return o.m(\n     1)',
    'o = O()\nwith C():\n    return',
    'o = O()\nwith C():\n    return 5',
    'o = O()\nwith C():\n    return (\n     5)',
    'o = O()\nfor i in range(2):\n    return (o .m(\n     note(1))\n     .v)',
    'o = O()\ntry:\n    return (o .m(\n     note(1))\n     .v)\nfinally:\n    x = 1',
    'o = O()\nwith C():\n    try:\n        return (o .m(\n         note(1))\n         .v)\n    finally:\n        x = 1',
    'o = O()\ntry:\n    with C():\n        return (o .m(\n         note(1))\n         .v)\nfinally:\n    x = 1',
    'o = O()\nwith C():\n    for i in range(2):\n        return (o .m(\n         note(1))\n         .v)',
    'x = (lambda: (note(1)\n if note(0)\n else note(2)))()',
    'x = (lambda:\n (note(1)\n if note(1)\n else note(2)))()',
    'x = (lambda:\n note(\n 1))()',
    'x = list((lambda:\n (yield\n note(1)))())',
    'try:\n    pass\nexcept* ValueError:\n    pass\nelse:\n    pass',
    'try:\n    pass\nexcept* ValueError:\n    pass\nelse:\n    if note(1):\n        x = 1',
    'try:\n    bad()\nexcept* ValueError:\n    pass\nelse:\n    pass',
    'try:\n    pass\nexcept* ValueError:\n    pass',
    'with S(), bad():\n    x = 1\nx = 2',
    'with S(), C(), bad():\n    x = 1\nx = 2',
    'with S(), C(), C(), bad():\n    x = 1\nx = 2',
    'with S(), C(), C():\n    bad()\nx = 2',
    'with S(), C(): bad()\nx = 2',
    'with S():\n    with C(), bad():\n        x = 1\nx = 2',
    'with (S(),\n      C(), bad()):\n    x = 1\nx = 2',
    'with (S(), C(),\n      bad()):\n    x = 1\nx = 2',
]

for number, body in enumerate(SOURCES):
    source = 'def f():\n' + ''.join('    ' + line + '\n' for line in body.split('\n'))
    namespace = {'C': C, 'S': S, 'O': O, 'note': note, 'bad': bad}
    exec(compile(source, '<%d>' % number, 'exec'), namespace)
    f = namespace['f']
    events = []

    def trace(frame, event, argument):
        if frame.f_code.co_filename != f.__code__.co_filename:
            return None
        events.append(frame.f_lineno if event == 'line' else (event, frame.f_lineno))
        return trace

    sys.settrace(trace)
    try:
        f()
    finally:
        sys.settrace(None)
    print(number, repr(body if len(body) < 70 else body[:50] + '...' + str(len(body))))
    print('   ', events)
    print('   ', [line for _, _, line in f.__code__.co_lines()] == [line for _, _, line in f.__code__.co_lines()], sorted({line for _, _, line in f.__code__.co_lines() if line}))
