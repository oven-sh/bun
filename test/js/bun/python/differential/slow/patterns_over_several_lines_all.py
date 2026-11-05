# All of lang/251_patterns_over_several_lines.py, which shows one in 61: 1,278 patterns in 8 places. A digest for each hundred; to see what is behind one, run that
# test with another STEP and OFFSET.
import hashlib, itertools, sys

STEP, OFFSET = 1, 0

class K:
    a = 1
    b = 'b'
class P:
    __match_args__ = ('x', 'y')
    def __init__(self, x, y): self.x, self.y = x, y

# A pattern is a list of lines. N stands for a name that is not used twice.
def sequence(items, tight=False):
    lines = []
    for item in items:
        lines += item[:-1] + [item[-1] + ',']
    if not tight:
        return ['['] + lines + [']']
    return ['[' + lines[0]] + lines[1:-1] + [lines[-1] + ']'] if len(lines) > 1 else ['[' + lines[0] + ']']
def mapping(keys, items, rest=None, tight=False):
    lines = []
    for key, item in zip(keys, items):
        lines += ([key + ': ' + item[0]] if tight else [key + ':', item[0]]) + item[1:]
        lines[-1] += ','
    if rest:
        lines.append('**' + rest)
    if not tight:
        return ['{'] + lines + ['}']
    return ['{' + lines[0]] + lines[1:-1] + [lines[-1] + '}']
def instance(positional, keywords):
    lines = ['P(']
    for item in positional:
        lines += item[:-1] + [item[-1] + ',']
    for name, item in keywords:
        lines += [name + '=' + item[0]] + item[1:]
        lines[-1] += ','
    return lines + [')']
def alternatives(items, tight=False):
    lines = []
    for item in items:
        lines += item[:-1] + [item[-1] + ' |']
    lines[-1] = lines[-1][:-2]
    if not tight:
        return ['('] + lines + [')']
    return ['(' + lines[0]] + lines[1:-1] + [lines[-1] + ')']
def named(item, tight=False):
    return ['(' + item[0]] + item[1:] + ['as N)'] if tight else ['('] + item + ['as N', ')']

def patterns():
    atoms = [[a] for a in ('1', 'None', 'N', '_', 'K.a', 'int()', "'b'")]
    refutable = [a for a in atoms if a not in (['_'], ['N'])]
    for a, b in itertools.product(atoms, atoms):
        yield sequence([a, b]); yield sequence([a, b], True)
        yield mapping(["'a'", "'b'"], [a, b]); yield mapping(["'a'", "'b'"], [a, b], None, True); yield mapping(['K.b', "'a'"], [a, b])
        yield instance([a], [('y', b)]); yield instance([a, b], [])
    for a in atoms:
        yield sequence([a, ['*N'], a]); yield sequence([a, ['*_'], a]); yield sequence([['*_'], a]); yield sequence([['*N'], a]); yield sequence([a, ['*_']])
        yield mapping(["'a'"], [a], 'N'); yield instance([], [('x', a)])
    for a in refutable:
        yield named(a); yield named(a, True)
    for a, b in itertools.product(refutable, refutable):
        yield alternatives([a, b]); yield alternatives([a, b], True)
    yield sequence([]); yield mapping([], []); yield mapping([], [], 'N'); yield instance([], []); yield sequence([['_'], ['_']]); yield sequence([['*_']])
    inner = [sequence([['1'], ['N']]), sequence([['N'], ['1']], True), mapping(["'a'"], [['N']]), mapping(["'a'", "'b'"], [['1'], ['_']], None, True), instance([['N']], [('y', ['1'])]),
             alternatives([['1'], ['None']]), alternatives([["'b'"], ['int()']], True), named(['1']), named(sequence([['_'], ['1']]), True), sequence([['1'], ['*_'], ['N']]),
             sequence([['N'], ['*N']]), ['1'], ['N'], ['_']]
    for a, b in itertools.product(inner, inner):
        yield sequence([a, b]); yield mapping(["'a'", "'b'"], [a, b]); yield instance([a], [('y', b)]); yield sequence([a, ['*_'], b])
    for a in inner:
        if a not in (['_'], ['N']):
            yield named(a)
        yield mapping(["'a'"], [a], 'N')
    # Alternatives bind the same names, not always in the same order.
    either = alternatives([sequence([['p'], ['q']]), mapping(["'a'", "'b'"], [['q'], ['p']])])
    yield either
    yield alternatives([sequence([['p'], ['q'], ['1']]), sequence([['q'], ['p'], ['None']]), instance([['p'], ['q']], [])])
    yield sequence([['w'], either, ['z']])
    yield sequence([alternatives([['1'], sequence([['1'], ['None']])]), alternatives([['None'], ['int()']], True)])

# {0}: the first line of the pattern, {1}: the others.
SHAPES = {
'the last statement': 'def f(s):\n    match s:\n        case {0}{1}:\n            pass\n',
'another case': 'def f(s):\n    match s:\n        case {0}{1}:\n            x = 1\n        case 77:\n            x = 2\n    return 3\n',
'case _': 'def f(s):\n    match s:\n        case {0}{1}:\n            x = 1\n        case _:\n            x = 2\n    return 3\n',
'a guard': 'def f(s):\n    match s:\n        case {0}{1} if (s is not\n                None):\n            x = 1\n    return 3\n',
'a guard, the last statement': "def f(s):\n    match s:\n        case {0}{1} if (s != (1, 1) and\n                s != {{'a': 1, 'b': 1}}\n                and s != P(1, 1)):\n            x = 1\n",
'a guard on the last line': 'def f(s):\n    match s:\n        case {0}{1} if s != (1, 1):\n            x = 1\n',
'in a loop': 'def f(s):\n    for i in (1, 2):\n        match s:\n            case {0}{1}:\n                x = 1\n    return 3\n',
'before an else': 'def f(s):\n    if s is not Ellipsis:\n        match s:\n            case {0}{1}:\n                x = 1\n    else:\n        x = 2\n    return 3\n',
}
SUBJECTS = [1, None, 'b', 2, (1, 1), (1, None), (None, 1), ('b', 'b'), (1, 2, 1), (2, 1), [1], [], {'a': 1, 'b': 1}, {'a': None, 'b': 'b'}, {'a': 1}, {'b': 1, 'a': 'b'}, {}, P(1, 1), P(None, 'b'),
    P('b', None), P(1, 2), ((1, 1), (1, 1)), ((1, 2), {'a': 1}), ({'a': 1, 'b': 2}, P(1, 1)), (P(1, 1), 1), {'a': (1, 1), 'b': (1, 1)}, {'a': {'a': 1}, 'b': 1}, {'a': P(2, 1), 'b': None},
    P((1, 1), (1, 1)), P({'a': 1}, 1), P(1, {'a': 1, 'b': 1}), P(P(1, 1), P(1, 1)), (1, (1, None)), ((1, None), 1), (5, (1, 2), 6), (5, {'a': 1, 'b': 2}, 6), (1, 2, None), (1, 2, 1)]

def main():
    events = []
    def trace(frame, event, argument):
        if frame.f_code.co_filename == '<shape>':
            if event in ('line', 'return'):
                events.append('%s%d' % (event[0], frame.f_lineno))
            return trace
    number = -1
    digest = hashlib.sha1()
    for (shape, form), lines in itertools.product(SHAPES.items(), patterns()):
        number += 1
        if number % STEP != OFFSET:
            continue
        names = itertools.count()
        lines = [''.join('v%d' % next(names) if piece == 'N' else piece for piece in line.replace('None', '\0').replace('N', '\1N\1').replace('\0', 'None').split('\1')) for line in lines]
        namespace = {'K': K, 'P': P}
        exec(compile(form.format(lines[0], ''.join('\n                ' + line for line in lines[1:])), '<shape>', 'exec'), namespace)
        f = namespace['f']
        seen = []
        for subject in SUBJECTS:
            del events[:]
            sys.settrace(trace)
            try:
                f(subject)
            finally:
                sys.settrace(None)
            if (found := ' '.join(events)) not in seen:
                seen.append(found)
        digest.update(repr((shape, lines, sorted({line for _, _, line in f.__code__.co_lines() if line}), seen)).encode())
        if number % 100 == 99:
            print(number - 99, digest.hexdigest()[:16])
            digest = hashlib.sha1()
    print('the rest', digest.hexdigest()[:16])
main()
