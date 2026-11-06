# `try` with `except*`: what tools are told of, by what the statements of the `try`, of a clause and of the `else` end with, and by where the statement is.
#
# What ends the statements of the `try` or of a clause is in front of a jump, over the clauses or to the next clause. The `else` comes behind the clauses in CPython's code. What a
# clause catches comes before anything of the line of the `except*`, but in the first clause.
import sys, traceback, warnings
warnings.simplefilter('ignore', SyntaxWarning) # `return` in a `finally` clause
M = sys.monitoring; EV = M.events
class E(Exception): pass
class F(Exception): pass
class CM:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def EG(*xs): return ExceptionGroup('g', list(xs))
def indent(t, n): return ''.join(' ' * n + l + '\n' for l in t.split('\n'))

def star(body, *clauses, orelse=None):
    t = 'try:\n' + indent(body, 4)
    for what, statements in clauses:
        t += 'except* %s:\n' % what + indent(statements, 4)
    if orelse:
        t += 'else:\n' + indent(orelse, 4)
    return t[:-1]
ENDS = {'assign': 'x = 2', 'if': 'if a:\n    x = 2', 'if else': 'if a:\n    x = 2\nelse:\n    x = 3', 'while': 'while a:\n    a -= 1', 'for': 'for i in (1, 2):\n    x = i',
        'try': 'try:\n    x = 1 // a\nexcept ZeroDivisionError:\n    x = 3', 'with': 'with CM():\n    x = 3', 'match': 'match a:\n    case 1:\n        x = 1\n    case 0:\n        x = 2',
        'while True': 'while True:\n    if a:\n        break\n    a = 1', 'if raise': 'if a:\n    raise KeyError'}
STATEMENTS = {}
for name, end in ENDS.items():
    STATEMENTS['clause ' + name] = star('raise E', ('E', end))
    STATEMENTS['clause as ' + name] = star('raise E', ('E as e', end))
    STATEMENTS['first clause ' + name] = star('raise EG(E(), F())', ('E', end), ('F', 'x = 4'))
    if name != 'if raise':
        STATEMENTS['body ' + name] = star(end, ('E', 'x = 4'))
        # Where the branch that leaves the loop is said to lead: DEFERRED.md.
        if name != 'for':
            STATEMENTS['else ' + name] = star('x = 1 // b', ('ZeroDivisionError', 'x = 4'), orelse=end)
STATEMENTS.update({
    'three': star('raise EG(E(), F()) if a else EG(F())', ('KeyError', 'x = 0'), ('E', 'x = 1'), ('F', 'x = 2')),
    'three as': star('raise EG(E(), F()) if a else EG(F())', ('KeyError as e', 'x = 0'), ('E as e', 'x = 1'), ('F as e', 'x = 2')),
    'raises': star(star('raise E', ('E', 'raise KeyError')), ('KeyError', 'x = 2')),
    'raises as': star(star('raise E', ('E as e', 'raise KeyError')), ('KeyError', 'x = 2')),
    'raises again': star(star('raise E', ('E', 'raise')), ('E', 'x = 2')),
    'part': star(star('raise EG(E(), F())', ('F', 'x = 1')), ('E', 'x = 2')),
    'in a clause': star('raise E', ('E', star('raise (F if a else E)', ('F', 'x = 3'), ('E', 'x = 4')))),
    'in an else': star('x = 1', ('E', 'x = 4'), orelse=star('raise (F if a else E)', ('F', 'x = 3'), ('E', 'x = 5'))),
    'types on other lines': star('raise (E if a else F)', ('(E,\n         KeyError)', 'x = 1'), ('(\n         F)', 'x = 2')),
    'first type on another line': star('raise E', ('(\n         E)', 'x = 1')),
    'returns': star('if a:\n    return 7\nraise E', ('E', 'x = 1')),
    'never gets to the else': star('raise E', ('E', 'x = 1'), orelse='x = 2'),
    'else returns': star('x = 1 // a', ('ZeroDivisionError', 'x = 2'), orelse='return 3'),
})
BEHIND = {'nothing': '', 'return': 'return 1', 'long': 'y = x + a + x + a\nz = y'}
# What is in front of the statement, how far in it is, and what closes the place.
PLACES = {
    'function': ('', 0, ''), 'if with else': ('if c:\n', 4, 'else:\n    x = 9\n'),
    'try': ('try:\n', 4, 'except KeyError:\n    raise\n'), 'handler': ('try:\n    raise E\nexcept E:\n', 4, ''),
    'finally': ('try:\n    x = 8\nfinally:\n', 4, ''), 'case': ('match c:\n    case 1:\n', 8, '    case 2:\n        x = 7\n'),
    'clause': ('try:\n    raise E\nexcept* E:\n', 4, ''), 'else of loop': ('for j in (1,):\n    x = 8\nelse:\n', 4, ''),
}

log = []
def rows():
    line_at = {}
    def two(name):
        return lambda code, a, b: log.append('%s%s>%s' % (name, line_at[a], line_at[b])) if code.co_filename == 'g' else None
    def one(name):
        return lambda code, a, *r: log.append('%s%s' % (name, line_at[a])) if code.co_filename == 'g' else None
    M.use_tool_id(1, 't')
    for event, told in ((EV.BRANCH_LEFT, two('BL')), (EV.BRANCH_RIGHT, two('BR')), (EV.JUMP, two('J')), (EV.PY_RETURN, one('RET')), (EV.RAISE, one('RAISE')), (EV.RERAISE, one('RERAISE')),
                        (EV.EXCEPTION_HANDLED, one('H')), (EV.PY_UNWIND, one('UNW')), (EV.LINE, lambda code, line: log.append('L%d' % line) if code.co_filename == 'g' else None)):
        M.register_callback(1, event, told)
    mask = EV.BRANCH_LEFT | EV.BRANCH_RIGHT | EV.JUMP | EV.LINE | EV.PY_RETURN | EV.RAISE | EV.RERAISE | EV.EXCEPTION_HANDLED | EV.PY_UNWIND
    for place, (before, depth, closing) in PLACES.items():
        for name, statement in STATEMENTS.items():
            if place == 'clause' and 'return' in statement: continue
            for behind, rest in BEHIND.items():
                source = 'def f(a, b, c):\n    x = 0\n' + indent((before + indent(statement, depth) + closing + rest).rstrip('\n'), 4)
                namespace = {'E': E, 'F': F, 'CM': CM, 'EG': EG}
                exec(compile(source, 'g', 'exec'), namespace)
                code = namespace['f'].__code__
                line_at.clear()
                for start, end, line in code.co_lines():
                    for offset in range(start, end): line_at[offset] = line
                for a, b in ((0, 1), (1, 0)):
                    del log[:]
                    M.set_local_events(1, code, mask)
                    try:
                        log.append('=%r' % (namespace['f'](a, b, 1),))
                    except BaseException as e:
                        log.append(type(e).__name__)
                    M.set_local_events(1, code, 0)
                    yield '%s | %s | %s | %d %d | %s' % (place, name, behind, a, b, ' '.join(log))
                yield '%s | %s | %s | lines %s' % (place, name, behind, sorted({line for _, _, line in code.co_lines() if line}))
    M.free_tool_id(1)
print('\n'.join(rows()))

# The part that matched is being handled before it gets its name, and until the next clause has matched.
class Namespace(dict):
    def __setitem__(self, key, value):
        if key == 'e': print('set', repr(value), 'while', repr(sys.exception()), 'is handled')
        super().__setitem__(key, value)
    def __delitem__(self, key):
        if key == 'e': print('del while', repr(sys.exception()), 'is handled')
        super().__delitem__(key)
class Meta(type):
    @classmethod
    def __prepare__(meta, name, bases): return Namespace()
class C(metaclass=Meta):
    try:
        raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
    except* ValueError as e:
        pass
    except* TypeError as e:
        pass
try:
    class D(metaclass=Meta):
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
        except* ValueError as e:
            raise KeyError(3)
        except* TypeError as e:
            pass
except* KeyError as k:
    print(repr(k))

# Leaving a clause is refused behind the copy of a `finally` clause: at no place, where that ends with a statement with more than one way to its end.
for leaves, loop in (('return 7', 'def f():\n'), ('break', 'for i in y:\n'), ('continue', 'for i in y:\n')):
    for end in ('x = 1', 'if a:\n    x = 1', star('x = 1', ('K', 'pass')), star('raise F()', ('K', 'pass')), 'with a:\n    x = 1', 'for j in a:\n    x = 1'):
        source = loop + indent(star('pass', ('E', 'try:\n    %s\nfinally:\n%s' % (leaves, indent(end, 4)[:-1]))), 4)
        try:
            compile(source, '<s>', 'exec')
        except SyntaxError as e:
            print(leaves, '|', end.split('\n')[0], '|', e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset, repr(e.text), traceback.format_exception_only(e)[0].strip())

# A trace function, and the type of a clause of `except` on another line.
def plain(body, *clauses):
    return star(body, *clauses).replace('except*', 'except')
for name, statement in (('first', plain('raise E', ('(\n        E)', 'x = 1'))), ('second', plain('raise F', ('E', 'x = 1'), ('(\n        F)', 'x = 2'))),
                        ('second as', plain('raise F', ('E', 'x = 1'), ('(\n        F) as e', 'x = 2'))), ('no match', plain('raise F', ('(\n        E)', 'x = 1'), ('F', 'x = 2'))),
                        ('tuple', plain('raise F', ('(E,\n        F)', 'x = 1'))), ('star first', star('raise E', ('(\n        E)', 'x = 1'))),
                        ('star second', star('raise F', ('E', 'x = 1'), ('(\n        F)', 'x = 2'))), ('star second as', star('raise F', ('E', 'x = 1'), ('(\n        F) as e', 'x = 2'))),
                        ('star third', star('raise F', ('E', 'x = 1'), ('(\n        KeyError)', 'x = 2'), ('(\n        F)', 'x = 3')))):
    namespace = {'E': E, 'F': F}
    exec(compile('def f():\n' + indent(statement, 4), 'g', 'exec'), namespace)
    del log[:]
    def trace(frame, event, arg):
        if frame.f_code.co_filename == 'g':
            log.append('%s%s' % (event[0], frame.f_lineno))
            return trace
    sys.settrace(trace); namespace['f'](); sys.settrace(None)
    print(name, ' '.join(log))
