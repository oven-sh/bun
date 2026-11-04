# The body of a class returns on the line that was run last, whatever kind of statement that was: what sys.setprofile(),
# sys.settrace() and sys.monitoring say.
import sys, contextlib

BODIES = {
    'assignment': 'x = 1',
    'pass': 'x = 1\npass',
    'expression': 'x = 1\nx',
    'docstring only': '"doc"',
    'augmented': 'x = 1\nx += 1',
    'annotated': 'x: int = 1',
    'annotation then if': 'x: int = 1\nif x:\n    y = 2',
    'del': 'x = 1\ndel x',
    'def': 'def f(self): pass',
    'decorated def': '@staticmethod\ndef f(): pass',
    'method with super': 'def f(self):\n    return super().f()',
    'method with super, then if': 'def f(self):\n    return super().f()\nif f:\n    y = 2',
    'class': 'class D:\n    pass',
    'import': 'import sys',
    'assert': 'assert True',
    'lambda': 'f = lambda: 0',
    'comprehension': 'x = [i for i in range(2)]',
    'several lines': 'x = [1,\n     2,\n     3]',
    'if taken': 'x = 1\nif x:\n    y = 2',
    'if not taken': 'x = 0\nif x:\n    y = 2',
    'if else, if': 'x = 1\nif x:\n    y = 2\nelse:\n    y = 3',
    'if else, else': 'x = 0\nif x:\n    y = 2\nelse:\n    y = 3',
    'elif': 'x = 0\nif x:\n    y = 2\nelif not x:\n    y = 3',
    'elif, none': 'x = 0\nif x:\n    y = 2\nelif x:\n    y = 3',
    'if in if': 'x = 1\nif x:\n    if x:\n        y = 2',
    'if in if, inner not taken': 'x = 1\nif x:\n    if not x:\n        y = 2',
    'test over lines': 'x = 0\nif (x or\n        x or\n        x):\n    y = 2',
    'for': 'for i in range(2):\n    y = i',
    'for over nothing': 'for i in ():\n    y = i',
    'for else': 'for i in range(2):\n    y = i\nelse:\n    y = 3',
    'for break': 'for i in range(2):\n    y = i\n    break',
    'for break in if': 'for i in range(3):\n    if i:\n        break\n    y = i',
    'for continue': 'for i in range(2):\n    if i:\n        continue\n    y = i',
    'while': 'i = 0\nwhile i < 2:\n    i += 1',
    'while else': 'i = 0\nwhile i < 2:\n    i += 1\nelse:\n    y = 3',
    'while break': 'i = 0\nwhile True:\n    i += 1\n    if i > 1:\n        break',
    'try': 'try:\n    y = 1\nexcept KeyError:\n    y = 2',
    'try, caught': 'try:\n    y = {}[1]\nexcept KeyError:\n    y = 2',
    'try, caught as': 'try:\n    y = {}[1]\nexcept KeyError as e:\n    y = 2',
    'try else': 'try:\n    y = 1\nexcept KeyError:\n    y = 2\nelse:\n    y = 3',
    'try finally': 'try:\n    y = 1\nfinally:\n    y = 2',
    'try except finally': 'try:\n    y = {}[1]\nexcept KeyError:\n    y = 2\nfinally:\n    y = 3',
    'try in try': 'try:\n    try:\n        y = {}[1]\n    finally:\n        y = 2\nexcept KeyError:\n    y = 3',
    'try star': 'try:\n    raise ExceptionGroup("g", [KeyError(1)])\nexcept* KeyError:\n    y = 2',
    'with': 'with nullcontext():\n    y = 1',
    'with two': 'with nullcontext(), nullcontext():\n    y = 1',
    'with that swallows': 'with suppress(KeyError):\n    y = {}[1]',
    'with if': 'with nullcontext():\n    if 1 + 1:\n        y = 1',
    'match': 'match 1:\n    case 1:\n        y = 1',
    'match, second': 'match 2:\n    case 1:\n        y = 1\n    case 2:\n        y = 2',
    'match, none': 'match 3:\n    case 1:\n        y = 1\n    case 2:\n        y = 2',
    'match, default': 'match 3:\n    case 1:\n        y = 1\n    case _:\n        y = 2',
    'if in for': 'for i in range(2):\n    if i:\n        y = i',
    'for in if': 'x = 1\nif x:\n    for i in range(2):\n        y = i',
    'while in try': 'i = 0\ntry:\n    while i < 2:\n        i += 1\nfinally:\n    pass',
}


def indent(text):
    return ''.join('    ' + line + '\n' for line in text.split('\n'))


E = sys.monitoring.events
for name, body in BODIES.items():
    code = compile('class C:\n' + indent(body), '<body>', 'exec')
    namespace = lambda: {'nullcontext': contextlib.nullcontext, 'suppress': contextlib.suppress}
    of_class = lambda frame: frame.f_code.co_name == 'C' and frame.f_code.co_filename == '<body>'

    profiled = []
    sys.setprofile(lambda frame, event, argument: profiled.append((event, frame.f_lineno)) if of_class(frame) and event in ('call', 'return') else None)
    try:
        exec(code, namespace())
    finally:
        sys.setprofile(None)

    traced = []

    def trace(frame, event, argument):
        if of_class(frame):
            traced.append((event, frame.f_lineno))
            return trace

    sys.settrace(trace)
    try:
        exec(code, namespace())
    finally:
        sys.settrace(None)

    monitored = []
    sys.monitoring.use_tool_id(3, 'bodies')
    sys.monitoring.register_callback(3, E.PY_RETURN, lambda code, offset, value: monitored.append(('return', sys._getframe(1).f_lineno, type(value).__name__)) if code.co_name == 'C' else None)
    sys.monitoring.register_callback(3, E.LINE, lambda code, line: monitored.append(line) if code.co_name == 'C' else None)
    sys.monitoring.set_events(3, E.PY_RETURN | E.LINE)
    try:
        exec(code, namespace())
    finally:
        sys.monitoring.set_events(3, 0)
        sys.monitoring.free_tool_id(3)

    body_code = next(c for c in code.co_consts if hasattr(c, 'co_code'))
    print(name, profiled)
    print('   ', traced)
    print('   ', monitored)
    print('   ', sorted({line for _, _, line in body_code.co_lines() if line is not None}))
