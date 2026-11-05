# A condition may be written over several lines, with constants among its operands. Whoever is told of lines hears of the line of each operand the frame
# gets to, a constant's too; of nothing that a constant rules out; and of the line of the whole where CPython's code has something left to do there.
import itertools, sys, warnings

STEP, OFFSET = 13, 0

OPERANDS = ['a', 'b', '0', '1', 'None', "'x'"]
def conditions():
    for x, y in itertools.product(OPERANDS, OPERANDS):
        for operator in ('and', 'or'):
            yield '(%s\n %s %s)' % (x, operator, y)
            yield '(%s %s\n %s)' % (x, operator, y)
    for x, y, z in itertools.product(OPERANDS[:4], OPERANDS[:4], OPERANDS[:4]):
        for first, second in itertools.product(('and', 'or'), ('and', 'or')):
            yield '(%s\n %s %s\n %s %s)' % (x, first, y, second, z)
            yield '((%s\n %s %s)\n %s %s)' % (x, first, y, second, z)
            yield '(%s\n %s (%s\n %s %s))' % (x, first, y, second, z)
    for x, y in itertools.product(OPERANDS[:4], OPERANDS[:4]):
        yield '(not\n %s\n and %s)' % (x, y)
        yield '(not (%s\n or %s))' % (x, y)
        yield '(%s\n if %s\n else b)' % (x, y)
        yield '(a\n if %s\n else %s)' % (x, y)
    for x in OPERANDS[:4]:
        yield '(not\n not\n %s)' % x
        yield '(not\n %s) == b' % x

PLACES = {
    'if': 'def f(a, b):\n    x = 0\n    if {}:\n        x = 1\n    return x\n',
    'if, else': 'def f(a, b):\n    if {}:\n        x = 1\n    else:\n        x = 2\n    return x\n',
    'if, last': 'def f(a, b):\n    if {}:\n        x = 1\n',
    'if, in a loop': 'def f(a, b):\n    x = 0\n    for i in (1, 2):\n        if {}:\n            x += 1\n    return x\n',
    'while': 'def f(a, b):\n    x = 0\n    while {}:\n        x = 1\n        break\n    return x\n',
    'assert': 'def f(a, b):\n    assert {}, message()\n    return 2\n',
    'assigned': 'def f(a, b):\n    x = {}\n    return x\n',
    'returned': 'def f(a, b):\n    return {}\n',
    'conditional expression': 'def f(a, b):\n    return (1 if {}\n        else 2)\n',
    'comprehension': 'def f(a, b):\n    return [x for x in (1, 2) if {}]\n',
    'comprehension over lines': 'def f(a, b):\n    return [x\n        for x in (1, 2)\n        if {}]\n',
    'generator expression': 'def f(a, b):\n    return list(x\n        for x in (1, 2)\n        if {})\n',
    'guard': 'def f(a, b):\n    match a:\n        case _ if {}:\n            return 1\n    return 2\n',
}

def main():
    warnings.simplefilter('ignore')
    events = []
    def trace(frame, event, argument):
        if frame.f_code.co_filename == '<shape>':
            if event in ('line', 'return'):
                events.append('%s%d' % (event[0], frame.f_lineno))
            return trace
    number = -1
    for (place, form), condition in itertools.product(PLACES.items(), conditions()):
        number += 1
        if number % STEP != OFFSET:
            continue
        start = form[:form.index('{}')].rsplit('\n', 1)[1]
        source = form.format(condition.replace('\n', '\n' + ' ' * (len(start) - len(start.lstrip()) + 8)))
        namespace = {'message': lambda: 'message'}
        exec(compile(source, '<shape>', 'exec'), namespace)
        f = namespace['f']
        found = []
        for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)):
            del events[:]
            sys.settrace(trace)
            try:
                f(a, b)
            except AssertionError:
                events.append('AssertionError')
            finally:
                sys.settrace(None)
            found.append(' '.join(events))
        codes = [f.__code__] + [constant for constant in f.__code__.co_consts if hasattr(constant, 'co_lines')]
        print(place + ': ' + condition.replace('\n', ' /'))
        print('    lines of the code:', [sorted({line for _, _, line in code.co_lines() if line}) for code in codes])
        for events_of_call in dict.fromkeys(found):
            print('   ', events_of_call)
main()
