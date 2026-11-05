# break, continue and return through finally clauses in finally clauses. Each clause runs once on the way out, the value is returned on the line
# that ran last, and the code grows with the depth of the nest, not with the number of ways through all the clauses.
import sys


def source(depth, inner, final):
    lines = ['def f(c, out):', '    for i in c:']
    indent = 2
    for d in range(depth):
        lines.append('    ' * indent + 'try:')
        indent += 1
    lines += ['    ' * indent + line for line in inner]
    for d in range(depth):
        indent -= 1
        lines.append('    ' * indent + 'finally:')
        lines += ['    ' * (indent + 1) + line.replace('D', str(d)) for line in final]
    lines.append('    return "end"')
    return '\n'.join(lines) + '\n'


class Manager:
    def __enter__(self):
        return self

    def __exit__(self, *arguments):
        return False


def make(depth, inner, final):
    namespace = {'Manager': Manager}
    exec(compile(source(depth, inner, final), '<nest>', 'exec'), namespace)
    return namespace['f']


def traced(function, *arguments):
    events = []

    def trace(frame, event, argument):
        if frame.f_code.co_filename == '<nest>':
            events.append((event[0], frame.f_lineno))
            return trace

    sys.settrace(trace)
    try:
        result = function(*arguments)
    finally:
        sys.settrace(None)
    return result, events


INNER = {
    'break': ['if i: break'],
    'continue': ['if i: continue'],
    'return': ['if i: return i'],
    'all three': ['if i == 1: continue', 'if i == 2: break', 'if i == 3: return i'],
    'nothing': ['out.append(i)'],
}
FINAL = {
    'one way': ['out.append(D)'],
    'two ways': ['if i % 2: out.append(D)', 'else: out.append(-D)'],
    'three ways': ['if i == 1: out.append(D)', 'elif i == 2: out.append(-D)', 'else: out.append("D")'],
    'a loop': ['for k in (1, 2): out.append((D, k))'],
    'a with': ['with Manager(): out.append(D)'],
    'a handler': ['try: out.append(D); [][i]', 'except IndexError: out.append(-D)'],
}
for how, inner in INNER.items():
    for ways, final in FINAL.items():
        for values in ((0, 1), (0, 2, 1), (3,), (0, 0)):
            out = []
            result, events = traced(make(3, inner, final), values, out)
            print(how, '|', ways, '|', values, '|', result, out, events)
        sizes = [len(make(depth, inner, final).__code__.co_code) for depth in (2, 4, 8, 12)]
        # Were it one copy for each way through all the clauses, twelve deep would be a thousand times four deep.
        print(how, '|', ways, '| grows with the depth:', sizes[3] < 6 * sizes[1], sizes[2] < 6 * sizes[0])
