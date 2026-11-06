# How deep blocks may be nested: CPython's compiler has room for so many in one code object and refuses a program that has more.
# For each kind of block, with something in the innermost: the first depth that is refused, and where the one too many is said to be.
# (Not here: programs in which two statements are each one too many, behind a `return` that runs a `finally` clause.)
import warnings
warnings.simplefilter('ignore', SyntaxWarning)

KINDS = {
    'for': ('for a in b:', None), 'while': ('while a:', None), 'with': ('with a:', None), 'with as': ('with a as b:', None), 'with two': ('with a, b:', None),
    'body of try finally': ('try:', 'finally:\n    pass'), 'body of try except': ('try:', 'except E:\n    pass'), 'body of try except*': ('try:', 'except* E:\n    pass'),
    'body of try except finally': ('try:', 'except E:\n    pass\nfinally:\n    pass'),
    'handler': ('try:\n    pass\nexcept E:', None), 'bare handler': ('try:\n    pass\nexcept:', None), 'named handler': ('try:\n    pass\nexcept E as e:', None),
    'handler of groups': ('try:\n    pass\nexcept* E:', None), 'named handler of groups': ('try:\n    pass\nexcept* E as e:', None),
    'handler, with finally': ('try:\n    pass\nexcept E:', 'finally:\n    pass'),
    'else of try': ('try:\n    pass\nexcept E:\n    pass\nelse:', None), 'else of for': ('for a in b:\n    pass\nelse:', None), 'else of while': ('while a:\n    pass\nelse:', None),
    'if': ('if a:', None), 'case': ('match a:\n  case 1:', None),
    'async for': ('async for a in b:', None), 'async with': ('async with a:', None), 'async with two': ('async with a, b:', None),
}
FOR = 'for a in b:\n    pass'
def indent(text, by=4):
    return '\n'.join(' ' * by + line for line in text.split('\n'))
INNER = {
    'pass': 'pass', 'return': 'return 1', 'break': 'break', 'continue': 'continue', 'assert': 'assert x, y', 'lambda': 'lambda: 0', 'yield': 'yield', 'yield from': 'yield from x', 'await': 'await x',
    'def with for': 'def g():\n' + indent(FOR), 'class with for': 'class D:\n' + indent(FOR), 'with in with': 'with c:\n    with d:\n        pass',
    'for in finally': 'try:\n    pass\nfinally:\n' + indent(FOR),
    'for in finally of return of a value': 'try:\n    return x\nfinally:\n' + indent(FOR),
    'for in finally of return of a sum': 'try:\n    return 1 + 1\nfinally:\n' + indent(FOR),
    'for in finally of return of a constant': 'try:\n    return 1\nfinally:\n' + indent(FOR),
    'for in finally of return': 'try:\n    return\nfinally:\n' + indent(FOR),
    'for in finally of break': 'try:\n    break\nfinally:\n' + indent(FOR),
    'for in finally of continue': 'try:\n    continue\nfinally:\n' + indent(FOR),
    'for in finally around return in finally of return': 'try:\n    try:\n        return x\n    finally:\n        return y\nfinally:\n' + indent(FOR),
    'for in finally around break in finally of return': 'try:\n    try:\n        return x\n    finally:\n        break\nfinally:\n' + indent(FOR),
    'for in finally of return in with': 'with c:\n    try:\n        return x\n    finally:\n' + indent(FOR, 8),
    'for in handler': 'try:\n    pass\nexcept E:\n' + indent(FOR), 'for in named handler': 'try:\n    pass\nexcept E as e:\n' + indent(FOR), 'for in handler of groups': 'try:\n    pass\nexcept* E:\n' + indent(FOR),
    'for in else of try': 'try:\n    pass\nexcept E:\n    pass\nelse:\n' + indent(FOR), 'for in case': 'match a:\n    case [1, 2]:\n' + indent(FOR, 8),
    'list comprehension': '[x for x in y]', 'dict comprehension': '{x: x for x in y}', 'generator expression': '(x for x in y)', 'two for clauses': '[x for x in y for z in x]',
    'comprehension in comprehension': '[[x for x in y] for y in z]', 'async comprehension': '[x async for x in y]', 'two async for clauses': '[x async for x in y async for z in x]',
    'async comprehension in comprehension': '[[x async for x in y] for y in z]', 'async comprehension in async comprehension': '[[x async for x in y] async for y in z]',
    'async generator expression': '(x async for x in y)',
}
WHERE = {
    'function': 'def f():\n%s', 'async function': 'async def f():\n%s', 'module': None, 'generator': 'def f():\n    yield\n%s', 'async generator': 'async def f():\n    yield\n%s',
    'class': 'class C:\n%s', 'method': 'class C:\n    def f(self):\n%s',
}
FEW = ('pass', 'list comprehension', 'for in finally')

def nest(kind, depth, inner):
    head, tail = KINDS[kind]
    text = inner
    for i in range(depth):
        text = head + '\n' + indent(text) + ('\n' + tail if tail else '')
    return text

def refusal(where, text):
    frame = WHERE[where]
    if frame:
        text = frame % indent(text, 8 if where == 'method' else 4)
    try:
        compile(text + '\n', 'n', 'exec')
    except SyntaxError as e:
        return e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset

def rows():
    # Each kind of block; each thing in the innermost; each kind of code.
    for kind in KINDS:
        yield 'async function' if kind.startswith('async') else 'function', kind, 'pass'
    for name in INNER:
        yield 'async function' if 'async' in name or name == 'await' else 'function', 'for', name
    for where in WHERE:
        for name in FEW:
            yield where, 'with', name

for where, kind, name in rows():
    # The least depth that is refused.
    allowed, refused = 0, 24
    if not refusal(where, nest(kind, refused, INNER[name])):
        print('%s | %s | %s | any depth' % (where, kind, name))
        continue
    while refused - allowed > 1:
        middle = (allowed + refused) // 2
        if refusal(where, nest(kind, middle, INNER[name])):
            refused = middle
        else:
            allowed = middle
    print('%s | %s | %s | %d: %r' % (where, kind, name, refused, refusal(where, nest(kind, refused, INNER[name]))))

# The items of one `with` are blocks in blocks.
for count in (20, 21, 22, 23, 1000, 30000):
    print('with, %d items | %r' % (count, refusal('function', 'with ' + ', '.join(['a'] * count) + ':\n    pass')))
    print('async with, %d items | %r' % (count, refusal('async function', 'async with ' + ', '.join(['a'] * count) + ':\n    pass')))

# What turns a StopIteration that leaves a generator or a coroutine into a RuntimeError takes a block in the body of a `def`, and nowhere else.
import ast
def comprehensions(depth):
    text = 'z'
    for i in range(depth):
        text = '[%s for v%d in a]' % (text, i)
    return text
def least(make, flags=0):
    for depth in range(30):
        try:
            compile(make(depth), 'n', 'exec', flags)
        except SyntaxError as e:
            return depth, e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset
for name, frame, flags in (
        ('function', 'def f():\n x = %s\n', 0), ('generator', 'def f():\n yield\n x = %s\n', 0), ('coroutine', 'async def f():\n x = %s\n', 0), ('module', 'x = %s\n', 0), ('class', 'class C:\n x = %s\n', 0),
        ('lambda', 'x = lambda: %s\n', 0), ('lambda with yield', 'x = lambda: ((yield), %s)\n', 0), ('generator expression', 'x = (%s for q in a)\n', 0),
        ('generator expression in a function', 'def f():\n x = (%s for q in a)\n', 0), ('generator expression in a coroutine', 'async def f():\n x = (%s for q in a)\n', 0),
        ('asynchronous generator expression', 'async def f():\n x = (%s async for q in a)\n', 0), ('generator expression that awaits', 'async def f():\n x = ((await q, %s) for q in a)\n', 0),
        ('class in a generator', 'def f():\n yield\n class C:\n  x = %s\n', 0), ('module that awaits', 'await q\nx = %s\n', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
        ('module that may await', 'x = %s\n', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT), ('module with an asynchronous comprehension', 'y = [i async for i in q]\nx = %s\n', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
        ('module with async with', 'async with q:\n x = %s\n', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)):
    print('comprehensions in comprehensions | %s | %r' % (name, least(lambda depth: frame % comprehensions(depth), flags)))
print('while in a module that awaits | %r' % (least(lambda depth: '\n'.join(' ' * i + 'while a:' for i in range(depth)) + '\n' + ' ' * depth + 'await x\n', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),))
for opening, closing in ('()', '[]'):
    print('async for clauses in %s%s | %r' % (opening, closing, least(lambda depth: 'async def f():\n x = ' + opening + 'i ' + ' '.join('async for i%d in a' % k for k in range(depth + 1)) + closing + '\n'),))
