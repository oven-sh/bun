# Tests with very many operands and chains of very many arms, where each branch has a way of its own out of the statement:
# they are compiled in time that grows with their length, they do what they say, and tools are told of as much as in CPython.
import sys
M = sys.monitoring
E = M.events

def shapes(n):
    operands = ['a'] * n
    yield 'and, the last of an arm in a loop', 'def f(a, b):\n    for i in range(2):\n        if b:\n            if ' + ' and '.join(operands) + ':\n                b = 0\n        else:\n            b = 1\n    return b\n'
    yield 'or in assert, the last of an arm in a loop', 'def f(a, b):\n    for i in range(2):\n        if b:\n            assert ' + ' or '.join(operands) + '\n        else:\n            b = 1\n    return b\n'
    yield 'and over lines, the last of the function', 'def f(a, b):\n    if (' + ' and\n        '.join(operands) + '):\n        b = 0\n'
    yield 'and over lines, the last of a case', 'def f(a, b):\n    match b:\n        case 1:\n            if (' + ' and\n        '.join(operands) + '):\n                b = 0\n        case 2:\n            b = 5\n    return b\n'
    yield 'while, the last of an arm', 'def f(a, b):\n    if b:\n        while ' + ' and '.join(operands) + ':\n            a = 0\n    else:\n        b = 1\n    return b\n'

def chains(n):
    yield 'elif', 'def f(a, b):\n    if a == -1:\n        x = -1\n' + ''.join('    elif a == %d:\n        x = %d\n' % (i, i) for i in range(n)) + '    return x\n'
    yield 'elif and else, the last of the function', 'def f(a, b):\n    if a == -1:\n        x = -1\n' + ''.join('    elif a == %d:\n        x = %d\n' % (i, i) for i in range(n)) + '    else:\n        x = 0\n'
    yield 'elif in a loop', 'def f(a, b):\n    for i in range(2):\n        if a == -1:\n            x = -1\n' + ''.join('        elif a == %d:\n            x = %d\n' % (i, i) for i in range(n)) + '    return x\n'
    yield 'class that ends with elif', 'def f(a, b):\n    class C:\n        if a == -1:\n            x = -1\n' + ''.join('        elif a == %d:\n            x = %d\n' % (i, i) for i in range(n)) + '    return C.x\n'

def run(name, source, arguments):
    namespace = {}
    exec(compile(source, 'long', 'exec'), namespace)
    f = namespace['f']
    for a, b in arguments:
        counts = {}
        M.use_tool_id(1, 't')
        for event, short in ((E.BRANCH_LEFT, 'left'), (E.BRANCH_RIGHT, 'right'), (E.JUMP, 'jump'), (E.LINE, 'line')):
            M.register_callback(1, event, lambda *args, short=short: counts.__setitem__(short, counts.get(short, 0) + 1))
        M.set_local_events(1, f.__code__, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP | E.LINE)
        try:
            result = f(a, b)
        except AssertionError:
            result = 'AssertionError'
        M.set_local_events(1, f.__code__, 0)
        M.free_tool_id(1)
        print('%s | f(%r, %r) = %r | %s' % (name, a, b, result, sorted(counts.items())))

for name, source in shapes(12000):
    run(name, source, ((1, 1), (0, 1), (1, 0)))
for name, source in chains(500):
    run(name, source, ((0, 0), (250, 0), (499, 0)))
