# Comparisons with and without a jump behind them, unary operators, floor division and stores to cells, in functions with a few
# variables, with hundreds and with tens of thousands, over short and longer distances; run plainly, traced by line and by
# instruction, monitored, and after a round trip through marshal. (slow/ has the same with more values, sizes and distances.)
import sys, marshal, hashlib, types

VALUES = [(1, 2), (2, 1), (2, 2), (float('nan'), 1), (None, None)]


def source(variables, distance):
    # The variables that come first only take up room: nothing is ever assigned to them.
    lines = ['def f(p, q):', '    if p is ...:', '        ' + ' = '.join('v%d' % i for i in range(variables)) + ' = 0']
    lines += ['    a = p', '    b = q', '    out = []', '    add = out.append']
    lines += ['    c = 0', '    def get(): return c, d', '    d = 1']
    for operator in ('<', '<=', '==', '!=', '>', '>='):
        lines += ['    try:', '        r = a %s b' % operator, '        add(r)', '    except TypeError as e:', '        add(str(e))']
    filler = ['            c += 1'] * distance
    for operator in ('<', '<=', '==', '!=', '>', '>='):
        lines += ['    try:', '        if a %s b:' % operator] + filler + ['            add(%r)' % operator, '        else:'] + filler + ['            add("not " + %r)' % operator]
        lines += ['        if a %s b or c < 0:' % operator] + filler + ['            add(1)']
        lines += ['        if not (a %s b and c >= 0):' % operator] + filler + ['            add(2)']
        lines += ['        n = 0', '        while n %s 1 and n != 3:' % operator] + filler + ['            n += 1', '        add(n)']
        lines += ['        add("yes" if b %s a else "no")' % operator]
        lines += ['    except TypeError as e:', '        add(str(e))']
    for expression in ('-a', '+a', '~a', 'not a', 'a // b', 'b // a', '-(a // b)', 'not -a'):
        lines += ['    try:', '        r = %s' % expression, '        add(r)', '    except (TypeError, ZeroDivisionError) as e:', '        add(str(e))']
    lines += ['    c = a', '    d = b', '    add(get())', '    c = d = out', '    add(get()[0] is get()[1] is out)']
    lines += ['    c = None', '    return out + [%d]' % (variables - 1)]
    return '\n'.join(lines) + '\n'


def digest(value):
    return hashlib.sha1(repr(value).encode()).hexdigest()[:10]


# (As text: a NaN is not equal to itself.)
def run(function):
    return [repr(function(p, q)[:-1]) for p, q in VALUES]


def traced(function, by_instruction):
    events = []

    def trace(frame, event, argument):
        if frame.f_code.co_filename != '<sizes>':
            return None
        frame.f_trace_opcodes = by_instruction
        if event != 'opcode':
            events.append((event, frame.f_lineno))
        return trace

    sys.settrace(trace)
    try:
        result = run(function)
    finally:
        sys.settrace(None)
    return result, events


def monitored(function):
    E = sys.monitoring.events
    seen = []
    code = function.__code__
    lines = {}
    for start, end, line in code.co_lines():
        lines[start] = line
    starts = sorted(lines)

    def line_of(offset):
        low, high = 0, len(starts)
        while high - low > 1:
            middle = (low + high) // 2
            if starts[middle] <= offset:
                low = middle
            else:
                high = middle
        return lines[starts[low]]

    sys.monitoring.use_tool_id(4, 'sizes')
    for event, label in ((E.BRANCH_LEFT, 'left'), (E.BRANCH_RIGHT, 'right')):
        sys.monitoring.register_callback(4, event, lambda code, origin, destination, label=label: seen.append((label, line_of(origin), line_of(destination))))
    sys.monitoring.set_local_events(4, code, E.BRANCH_LEFT | E.BRANCH_RIGHT)
    try:
        result = run(function)
    finally:
        sys.monitoring.set_local_events(4, code, 0)
        sys.monitoring.free_tool_id(4)
    return result, seen


first = None
for variables, distance in ((1, 1), (300, 40), (33000, 1)):
    code = compile(source(variables, distance), '<sizes>', 'exec')
    namespace = {}
    exec(code, namespace)
    f = namespace['f']
    plain = run(f)
    if first is None:
        first = plain
        for values, result in zip(VALUES, plain):
            print(values, result)
    print(variables, distance, 'as in the smallest:', plain == first, f(1, 2)[-1])
    small = variables < 1000
    by_line = traced(f, False)
    print('    by line:', by_line[0] == plain, len(by_line[1]), digest(by_line[1]))
    if small:
        by_instruction = traced(f, True)
        print('    by instruction:', by_instruction[0] == plain, by_instruction[1] == by_line[1])
    branches = monitored(f)
    print('    monitored:', branches[0] == plain, len(branches[1]), digest(branches[1]))
    print('    afterwards:', run(f) == plain)
    namespace = {}
    exec(marshal.loads(marshal.dumps(code)), namespace)
    print('    after marshal:', run(namespace['f']) == plain)
    # While it is traced, too.
    sys.settrace(lambda *a: None)
    copy = marshal.loads(marshal.dumps(f.__code__))
    sys.settrace(None)
    print('    a copy made while tracing:', run(types.FunctionType(copy, {})) == plain if not copy.co_freevars else None)
