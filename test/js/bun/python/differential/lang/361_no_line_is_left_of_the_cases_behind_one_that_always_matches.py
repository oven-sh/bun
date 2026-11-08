# Behind a case that always matches (`case y if 1:`) no other case can be reached. CPython's compiler drops what cannot be reached: the code has no such lines, and
# `frame.f_lineno = n` goes to the next line that there is, or nowhere. The lines of the code, and every jump from every line, under a trace function.
import sys, warnings
warnings.simplefilter('ignore')
def o(n=0): return n
class E(Exception): pass
def indent(text, by=4): return '\n'.join(' ' * by + line for line in text.split('\n'))
def put(template, what):
    return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == 'S' else l for l in template.split('\n'))
PATTERNS = ['y', '_']
GUARDS = ['1', 'not 0']
BODIES = ['x = 7', 'return 7', 'pass']
DEAD = ['case _:\n    o(2)', 'case 2:\n    o(2)\ncase _:\n    o(3)', 'case [a, b] if o(1):\n    o(2)']
PLACES = {
    'the end of the function': 'S', 'something behind': 'S\nx = 8', 'in a while': 'while o(1):\n    S\n    break', 'in a for': 'for i in (1, 2):\n    S', 'in an if': 'if o(1):\n    S\nelse:\n    x = 1',
    'in a try': 'try:\n    S\nexcept E:\n    x = 1', 'in a try with a finally': 'try:\n    S\nfinally:\n    x = 1', 'in a finally clause': 'try:\n    x = 1\nfinally:\n    S', 'in a handler': 'try:\n    raise E\nexcept E:\n    S',
    'in the else of a while': 'while o(0):\n    x = 1\nelse:\n    S', 'in the else of a try': 'try:\n    x = 1\nexcept E:\n    x = 2\nelse:\n    S\nfinally:\n    x = 3',
    'in a case': 'match o(1):\n    case 1:\n        S\n    case _ if o(1):\n        x = 1', 'in the last case': 'match o(1):\n    case 1:\n        S',
}
def run(f, at, to):
    seen = []; state = {'visit': 0}
    def tracer(frame, event, arg):
        if frame.f_code is not f.__code__: return None
        seen.append('%s%d' % (event[0].upper(), frame.f_lineno))
        if event == 'line' and frame.f_lineno == at and not state['visit']:
            state['visit'] = 1
            try: frame.f_lineno = to; seen.append('went')
            except ValueError as e: seen.append('(%s)' % e)
        if len(seen) > 60: raise E
        return tracer
    sys.settrace(tracer)
    try:
        try: r = f(0)
        finally: sys.settrace(None)
    except BaseException as e: r = type(e).__name__
    return '%s => %s' % (' '.join(seen), r)
def main():
    for place, template in PLACES.items():
        for pattern in PATTERNS:
            for guard in GUARDS:
                for body in BODIES:
                    for dead in DEAD:
                        statement = 'match s:\n    case %s if %s:\n%s\n%s' % (pattern, guard, indent(body, 8), indent(dead))
                        source = 'def f(s):\n' + indent(put(template, statement)) + '\n'
                        g = {'o': o, 'E': E}; exec(compile(source, 'p', 'exec'), g); f = g['f']
                        name = '%s | case %s if %s: %s | %s' % (place, pattern, guard, body, ' '.join(dead.replace('\n', ' /').split()))
                        lines = sorted({line for _, _, line in f.__code__.co_lines() if line is not None})
                        print('%s | lines %s' % (name, lines))
                        first = source[:source.index(dead.split('\n')[0])].count('\n') + 1
                        dead_lines = range(first, first + dead.count('\n') + 1)
                        for at in lines[1:]:
                            rows = [run(f, at, to) for to in dead_lines]
                            print('%s | from %d | %s' % (name, at, ' ; '.join('=' if i and row == rows[i - 1] else row for i, row in enumerate(rows))))
main()
