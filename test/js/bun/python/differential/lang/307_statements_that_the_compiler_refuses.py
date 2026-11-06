# Statements that the compiler refuses, in all sorts of places. It goes on behind the first error, with what it has, and throws the code away: what it takes for granted about code
# that is whole does not hold then. What comes out is the SyntaxError of CPython, and its line.
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
ERRORS = ['break', 'continue', 'return 1', 'yield 1', 'await x', 'nonlocal x', 'x = yield', 'del f()', 'f() = 1', 'x: int = yield', '(yield)', 'return', 'import *', 'from m import *', 'global a; a = 1; global a',
          'def g(a, a): pass', 'lambda a, a: 1', '[x async for x in y]', 'async with a: pass', 'async for a in b: pass', 'class K: return', 'x = *a', 'print(*a for a in b)', 'f(a=1, a=2)', '__debug__ = 1', 'del __debug__', 'None = 1',
          'match 1:\n    case a:\n        pass\n    case b:\n        pass', 'match 1:\n    case [a, a]:\n        pass', 'match 1:\n    case a | 1:\n        pass', 'try:\n    pass\nexcept:\n    pass\nexcept E:\n    pass',
          'try:\n    pass\nexcept* E:\n    return', 'try:\n    pass\nexcept* E:\n    break', 'for i in a:\n    try:\n        pass\n    except* E:\n        continue']
PLACES = {
    'alone': 'S', 'with more behind': 'S\nx = 1', 'if': 'if a:\n    S', 'else': 'if a:\n    x = 1\nelse:\n    S', 'if 1': 'if 1:\n    S', 'if 0': 'if 0:\n    S', 'while': 'while a:\n    x = 1\nelse:\n    S',
    'try': 'try:\n    S\nexcept E:\n    pass', 'handler': 'try:\n    pass\nexcept E:\n    S', 'handler as': 'try:\n    pass\nexcept E as e:\n    S', 'else of try': 'try:\n    pass\nexcept E:\n    pass\nelse:\n    S',
    'finally': 'try:\n    pass\nfinally:\n    S', 'try, finally': 'try:\n    S\nfinally:\n    pass', 'except*': 'try:\n    S\nexcept* E:\n    pass', 'with': 'with a:\n    S', 'case': 'match 1:\n    case 1:\n        S',
    'case _': 'match 1:\n    case 0:\n        pass\n    case _:\n        S', 'case _ if 1, case _': 'match 1:\n    case _ if 1:\n        S\n    case _:\n        pass',
    'case _ if 1, case _, in try': 'try:\n    match 1:\n        case _ if 1:\n            S\n        case _:\n            pass\nexcept E:\n    pass',
    'case _ if a, in try': 'try:\n    match 1:\n        case _ if a:\n            S\nexcept E:\n    pass', 'case 1, case _, in try, finally': 'try:\n    match 1:\n        case 1:\n            S\n        case _:\n            pass\nfinally:\n    pass',
    'if, else, in try': 'try:\n    if a:\n        S\n    else:\n        pass\nexcept E:\n    pass', 'if 1, in try': 'try:\n    if 1:\n        S\nexcept E:\n    pass', 'with in try': 'try:\n    with a:\n        S\nexcept E:\n    pass',
    'try in try': 'try:\n    try:\n        S\n    except E:\n        pass\nexcept E:\n    pass', 'handler in try': 'try:\n    try:\n        pass\n    except E:\n        S\nexcept E:\n    pass',
    'finally in try': 'try:\n    try:\n        pass\n    finally:\n        S\nexcept E:\n    pass', 'while 1 in try': 'try:\n    while 1:\n        pass\n    else:\n        S\nexcept E:\n    pass',
    'comprehension next': 'S\n[z for x in a for y in [x] if y for z in b]', 'class': 'class K:\n    S', 'lambda next': 'S\nf = lambda: (yield)',
}
HEADS = {'module': None, 'def': 'def f():', 'async def': 'async def f():', 'generator': 'def f():\n    yield 0', 'loop in def': 'def f():\n    for i in a:'}
def put(place, statement):
    return '\n'.join(indent(statement, len(l) - 1) if l.strip() == 'S' else l for l in place.split('\n'))
def outcome(source):
    try: compile(source, 'p', 'exec')
    except SyntaxError as e: return '%s at %s' % (e.msg, e.lineno)
    return 'compiles'
def rows():
    for pn, place in PLACES.items():
        for error in ERRORS:
            body = put(place, error)
            yield '%s | %s | %s' % (pn, error.replace('\n', ' / '), ' ; '.join(outcome(body + '\n' if head is None else head + '\n' + indent(body, 4 * (1 + head.count(':\n'))  if 'loop' in hn else 4) + '\n') for hn, head in HEADS.items()))
import warnings; warnings.simplefilter('ignore')
print('\n'.join(rows()))
